import type { VercelRequest, VercelResponse } from '@vercel/node';
import JSON5 from 'json5';
import { applyMorseEncodingToPairs, encodeInternationalMorse } from '../lib/morseEncode.js';
import { encodeAki, wrapAkiDisplayIfFirst } from '../lib/customCipher.js';
import { applyAkiEncodingToPairsAsync } from '../lib/akiTranslatedColumn.js';
import { fetchAkiMemePairDeepseek } from '../lib/akiMemeDeepseek.js';

const CHUNK_SIZE = 10000;

function splitIntoChunks(paragraphs: string[], maxChars: number): string[][] {
  // 先将超长单段落在句子边界处拆分，避免单段超出 token 限制
  const normalized: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      normalized.push(p);
    } else {
      const sentences = p.match(/[^.!?]+[.!?]+\s*/g) ?? [p];
      let piece = '';
      for (const s of sentences) {
        if (piece.length + s.length > maxChars && piece) {
          normalized.push(piece.trim());
          piece = s;
        } else {
          piece += s;
        }
      }
      if (piece.trim()) normalized.push(piece.trim());
    }
  }

  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of normalized) {
    if (size + p.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = [p];
      size = p.length;
    } else {
      current.push(p);
      size += p.length;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function extractTitleAuthorFromTranslation(
  translation: { en: string; zh: string }[]
): { title?: { en: string; zh: string }; author?: { en: string; zh: string } } {
  const result: { title?: { en: string; zh: string }; author?: { en: string; zh: string } } = {};
  const firstFew = translation.slice(0, 4).map(p => ({ en: (p.en || '').trim(), zh: (p.zh || '').trim() }));
  const first = firstFew[0];
  if (first && (first.en || first.zh)) {
    const enLines = (first.en || '').split(/\n/).map(s => s.trim()).filter(Boolean);
    const zhLines = (first.zh || '').split(/\n/).map(s => s.trim()).filter(Boolean);
    const firstLineEn = enLines[0] || '';
    const firstLineZh = zhLines[0] || '';
    const isAuthorLine = /^作者[：:]|^Author[：:\s]|^[Bb]y\s+\w+/.test(firstLineEn) || /^作者[：:]/.test(firstLineZh);
    const maxLen = 60;
    const enShort = firstLineEn.length <= maxLen && !/\.\s*$|!\s*$|\?\s*$/.test(firstLineEn);
    const zhShort = firstLineZh.length <= maxLen && !/[。！？]\s*$/.test(firstLineZh);
    if (!isAuthorLine && (enShort || zhShort)) result.title = { en: firstLineEn, zh: firstLineZh };
  }
  const authorPatterns = [
    { zh: /作者[：:]\s*([^\n。，]+)/, en: /Author[：:\s]+([^\n.,]+)/i },
    { zh: /作者[：:]?\s*([^\n。，]+)/, en: /[Bb]y\s+([^\n.,]+(?:\s+[A-Z][a-z]+)?)/ },
  ];
  for (const pair of firstFew) {
    const mZh = pair.zh.match(authorPatterns[0].zh) || pair.zh.match(authorPatterns[1].zh);
    const mEn = pair.en.match(authorPatterns[0].en) || pair.en.match(authorPatterns[1].en);
    const nameZh = mZh?.[1]?.trim();
    const nameEn = mEn?.[1]?.trim();
    if (nameZh || nameEn) {
      result.author = { zh: nameZh || '', en: nameEn || '' };
      break;
    }
  }
  return result;
}

type BilingualStr = { en: string; zh: string };
type CharacterInfo = { name: BilingualStr; description: BilingualStr };
type BilingualAnalysis = { summary: BilingualStr; narrativeDetail: BilingualStr; themes: BilingualStr[]; pros: BilingualStr[]; cons: BilingualStr[]; plotSynopsis?: BilingualStr; characters?: CharacterInfo[] };

function normalizeAnalysis(raw: unknown): BilingualAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const toBilingual = (v: unknown): BilingualStr => {
    if (v && typeof v === 'object') {
      const b = v as Record<string, unknown>;
      if ('en' in b || 'zh' in b) {
        return { en: typeof b.en === 'string' ? b.en.trim() : '', zh: typeof b.zh === 'string' ? b.zh.trim() : '' };
      }
    }
    const s = typeof v === 'string' ? v.trim() : '';
    return { en: '', zh: s };
  };

  const toArr = (v: unknown): BilingualStr[] => {
    if (!Array.isArray(v)) return [];
    return v.map(item => toBilingual(item));
  };

  const summary = toBilingual(o.summary ?? o.Summary);
  const narrativeDetail = toBilingual(o.narrativeDetail ?? o.narrative_detail);
  const themes = toArr(o.themes ?? o.Themes);
  const pros = toArr(o.pros ?? o.Pros);
  const cons = toArr(o.cons ?? o.Cons);
  const plotSynopsis = toBilingual(o.plotSynopsis ?? o.plot_synopsis ?? o.PlotSynopsis);
  const characters: CharacterInfo[] = (() => {
    const raw = o.characters ?? o.Characters;
    if (!Array.isArray(raw)) return [];
    return raw.map((c: unknown) => {
      if (!c || typeof c !== 'object') return { name: { en: '', zh: '' }, description: { en: '', zh: '' } };
      const ch = c as Record<string, unknown>;
      return { name: toBilingual(ch.name ?? ch.Name), description: toBilingual(ch.description ?? ch.Description) };
    }).filter((c: CharacterInfo) => c.name.en || c.name.zh);
  })();

  const hasContent = summary.en || summary.zh || narrativeDetail.en || narrativeDetail.zh ||
    themes.length > 0 || pros.length > 0 || cons.length > 0 ||
    plotSynopsis.en || plotSynopsis.zh || characters.length > 0;
  if (!hasContent) return null;

  const ph: BilingualStr = { en: '—', zh: '—' };
  return {
    summary: (summary.en || summary.zh) ? summary : ph,
    narrativeDetail: (narrativeDetail.en || narrativeDetail.zh) ? narrativeDetail : ph,
    themes: themes.length ? themes : [ph],
    pros: pros.length ? pros : [ph],
    cons: cons.length ? cons : [ph],
    plotSynopsis: (plotSynopsis.en || plotSynopsis.zh) ? plotSynopsis : undefined,
    characters: characters.length > 0 ? characters : undefined,
  };
}

/** 将模型可能返回的各种 translation 格式统一为数组，兼容字符串数组、对象数组、数字键对象等 */
function normalizeTranslationToArray(raw: unknown, expectedLen: number): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const arr: unknown[] = [];
    for (let i = 0; i < expectedLen; i++) {
      const v = o[String(i)] ?? o[i];
      if (v !== undefined && v !== null) arr.push(v);
    }
    if (arr.length > 0) return arr;
    const values = Object.values(o);
    if (values.length > 0) return values;
  }
  if (typeof raw === 'string') {
    return raw.split(/\n\s*\n/).filter(Boolean);
  }
  return [];
}

/** 移除模型可能回显的段落标记（如 # Paragraph 8、# 段落 9） */
function stripParagraphMarkers(s: string): string {
  return s
    .replace(/(?:^|\n)\s*#\s*(?:Paragraph|段落)\s*\d+\s*(?:\n|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** to_cjk：pair.en 为原文，pair.zh 为中文译文；to_en：pair.zh 为原文，pair.en 为英文译文 */
function mergeTranslation(
  sourceParagraphs: string[],
  raw: unknown[],
  layout: 'to_cjk' | 'to_en'
): { en: string; zh: string }[] {
  return sourceParagraphs.map((src, i) => {
    const v = raw[i];
    let translated = '';
    if (typeof v === 'string') {
      translated = stripParagraphMarkers(v);
    } else if (v && typeof v === 'object') {
      const key = layout === 'to_en' ? 'en' : 'zh';
      translated = stripParagraphMarkers(String((v as Record<string, unknown>)[key] ?? ''));
    }
    return layout === 'to_cjk'
      ? { en: src, zh: translated }
      : { en: translated, zh: src };
  });
}


const LANG_NAMES: Record<string, string> = {
  en: '英文',
  fr: '法文',
  ja: '日文',
  de: '德文',
  ar: '阿拉伯文',
  'zh-TW': '繁体中文',
  zh: '中文',
};

function buildTranslationToZhPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为简体中文，仅输出 JSON，格式如下（不要多余文字）。translation 为中文数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["中文1", "中文2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationToZhTwPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为繁体中文（台湾正体），仅输出 JSON，格式如下（不要多余文字）。translation 为繁体中文数组，顺序与输入一一对应，不要回显原文。

【繁体要求】必须使用台湾常用繁体字形（如「臺灣、資訊、匯整」），严禁使用大陆简体字（如「台湾、信息、汇总」）；译文中的汉字不得采用简体中文写法。

{
  "translation": ["繁體1", "繁體2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationToEnPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为英文，仅输出 JSON，格式如下（不要多余文字）。translation 为英文数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["English 1", "English 2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationToJaPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为日文（自然、地道的现代日语），仅输出 JSON，格式如下（不要多余文字）。translation 为日文数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["日文1", "日文2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationToFrPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为法语，仅输出 JSON，格式如下（不要多余文字）。translation 为法语数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["Français 1", "Français 2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationToDePrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为德语，仅输出 JSON，格式如下（不要多余文字）。translation 为德语数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["Deutsch 1", "Deutsch 2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationToArPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为现代标准阿拉伯语，使用阿拉伯字母书写。仅输出 JSON，格式如下（不要多余文字）。translation 为阿拉伯语数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["العربية 1", "العربية 2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildZhToEnTranslationOnlyPrompt(paragraphs: string[]): string {
  return `将以下中文段落翻译为英文，仅输出 JSON，translation 为英文数组，顺序对应，不要回显中文：
{ "translation": ["English 1", "..."] }

段落：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

type TargetLang = 'zh' | 'zh-TW' | 'en' | 'ja' | 'fr' | 'de' | 'ar' | 'morse' | 'aki';

const VALID_TARGET_LANGS = new Set<string>(['zh', 'zh-TW', 'en', 'ja', 'fr', 'de', 'ar', 'morse', 'aki']);

function normalizeTargetLang(raw: string | undefined): TargetLang {
  const r = typeof raw === 'string' ? raw.trim() : '';
  if (VALID_TARGET_LANGS.has(r)) return r as TargetLang;
  return 'zh';
}

function validateSourceTarget(sourceLang: string, targetLang: string): string | null {
  if (!VALID_TARGET_LANGS.has(targetLang)) {
    return '无效的译文语言';
  }
  if (sourceLang === targetLang) {
    return '原文语言与译文语言不能相同';
  }
  return null;
}

function resolveTranslationFlow(
  sourceLang: string,
  targetLang: string
): { error: string } | { analysisLang: string; layout: 'to_cjk' | 'to_en'; transPrompt: (chunk: string[]) => string } {
  const err = validateSourceTarget(sourceLang, targetLang);
  if (err) return { error: err };

  if (sourceLang === 'zh' && targetLang === 'en') {
    return {
      analysisLang: 'zh',
      layout: 'to_en',
      transPrompt: buildZhToEnTranslationOnlyPrompt,
    };
  }

  if (targetLang === 'zh') {
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToZhPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'zh-TW') {
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToZhTwPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'en') {
    return {
      analysisLang: sourceLang,
      layout: 'to_en',
      transPrompt: (chunk: string[]) => buildTranslationToEnPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'ja') {
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToJaPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'fr') {
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToFrPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'de') {
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToDePrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'ar') {
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToArPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'morse') {
    if (sourceLang === 'zh') {
      return {
        analysisLang: 'zh',
        layout: 'to_cjk',
        transPrompt: buildZhToEnTranslationOnlyPrompt,
      };
    }
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToEnPrompt(chunk, sourceLang),
    };
  }

  if (targetLang === 'aki') {
    if (sourceLang === 'zh') {
      return {
        analysisLang: 'zh',
        layout: 'to_cjk',
        transPrompt: buildZhToEnTranslationOnlyPrompt,
      };
    }
    return {
      analysisLang: sourceLang,
      layout: 'to_cjk',
      transPrompt: (chunk: string[]) => buildTranslationToEnPrompt(chunk, sourceLang),
    };
  }

  return { error: '无法解析翻译方向' };
}

function buildAnalysisOnlyPrompt(paragraphs: string[], sourceLang: string, targetLang: string): string {
  const srcLabel = LANG_NAMES[sourceLang] || '外文';
  // morse / aki 的目标栏先用英文产出，后续由服务端做编码
  const effectiveTarget = (targetLang === 'morse' || targetLang === 'aki') ? 'en' : targetLang;
  const tgtLabel = LANG_NAMES[effectiveTarget] || '目标语言';
  return `你是一个专业的中英双语文学编辑。请对以下${srcLabel}文章进行结构化写作分析，并提取标题和作者。

【标题提取规则】
- 标题通常是第一段或第一行，多为短语
- 若首段是短句（≤60 字、无句号结尾），即视为标题

【作者提取规则】
- 常见格式：英文 "Author: XXX"、"By XXX"；中文 "作者：XXX"
- 只提取姓名，去掉前缀

【标题/作者多语种输出】
- title.src：用原文（${srcLabel}）写出的标题
- title.tgt：用译文（${tgtLabel}）写出的标题
- author.src / author.tgt 同理
- 若原文找不到作者，两侧都填 "Unknown"

【字数上限】summary≤60字，narrativeDetail≤200字，plotSynopsis约500字（详细的剧情梗概），其余每项≤40字
【人物提取】characters 数组列出文中主要人物，每个人物包含 name 和 description（简要介绍其身份、性格、在故事中的角色）
【analysis 字段】summary / narrativeDetail / plotSynopsis / characters / themes / pros / cons 始终按 {en, zh}（英文 + 简体中文）双语输出，与目标语无关。

输出严格 JSON：
{
  "title": { "src": "...(${srcLabel})", "tgt": "...(${tgtLabel})" },
  "author": { "src": "...(${srcLabel})", "tgt": "...(${tgtLabel})" },
  "analysis": {
    "summary": { "en": "...", "zh": "..." },
    "narrativeDetail": { "en": "...", "zh": "..." },
    "plotSynopsis": { "en": "...(~500 words plot synopsis)...", "zh": "...(~500字剧情梗概)..." },
    "characters": [{ "name": { "en": "...", "zh": "..." }, "description": { "en": "...", "zh": "..." } }],
    "themes": [{ "en": "...", "zh": "..." }],
    "pros": [{ "en": "...", "zh": "..." }],
    "cons": [{ "en": "...", "zh": "..." }]
  }
}

文章内容：
${paragraphs.slice(0, 15).map((p, i) => `# ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

/**
 * 将模型返回的 title / author 字段映射到「原文栏 / 译文栏」slot。
 * 新版 {src, tgt}：src 是原文语言，tgt 是目标语言；旧版 {en, zh}：向后兼容。
 * - layout=to_cjk：en = 原文栏，zh = 译文栏
 * - layout=to_en： en = 译文栏（英文），zh = 原文栏
 */
function mapTitleAuthorToSlots(
  raw: unknown,
  layout: 'to_cjk' | 'to_en'
): { en: string; zh: string } {
  if (!raw || typeof raw !== 'object') return { en: '', zh: '' };
  const o = raw as Record<string, unknown>;
  const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const src = asStr(o.src ?? o.source);
  const tgt = asStr(o.tgt ?? o.target);
  if (src || tgt) {
    return layout === 'to_cjk' ? { en: src, zh: tgt } : { en: tgt, zh: src };
  }
  return { en: asStr(o.en), zh: asStr(o.zh) };
}

/** 对 title / author 的「译文栏」施加摩斯编码（仅当 targetLang === 'morse'） */
function applyMorseToTitleAuthorSlots(
  t: { en: string; zh: string },
  layout: 'to_cjk' | 'to_en'
): { en: string; zh: string } {
  const tgtKey: 'en' | 'zh' = layout === 'to_en' ? 'en' : 'zh';
  const morse = encodeInternationalMorse(t[tgtKey]);
  return { ...t, [tgtKey]: morse || '—' };
}

/** 对 title / author 的「译文栏」施加 AKI码 编码 */
function applyAkiToTitleAuthorSlots(
  t: { en: string; zh: string },
  layout: 'to_cjk' | 'to_en'
): { en: string; zh: string } {
  const tgtKey: 'en' | 'zh' = layout === 'to_en' ? 'en' : 'zh';
  const aki = wrapAkiDisplayIfFirst(encodeAki(t[tgtKey]), false);
  return { ...t, [tgtKey]: aki || '—' };
}

const sanitizeJson = (s: string) => s.replace(/,(\s*[\]}])/g, '$1');

function parseDeepSeekJson(content: string): Record<string, unknown> {
  try { return JSON.parse(content || '{}'); } catch {}
  try { return JSON.parse(sanitizeJson(content)); } catch {}
  try { return JSON5.parse(content); } catch {}
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
  const extracted = m ? (m[1] ?? m[0]) : '{}';
  try { return JSON5.parse(extracted); } catch { return {}; }
}

async function callDeepSeek(prompt: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a professional bilingual literary editor. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let userMsg = 'DeepSeek API 调用失败';
    try {
      const errJson = JSON.parse(text);
      const apiErr = errJson?.error?.message || errJson?.message || errJson?.error;
      if (apiErr) userMsg = typeof apiErr === 'string' ? apiErr : String(apiErr);
      if (response.status === 401) userMsg = 'API Key 无效或已过期，请在 Vercel 中检查 DEEPSEEK_API_KEY';
      else if (response.status === 429) userMsg = '请求过于频繁，请稍后再试';
    } catch {}
    throw new Error(userMsg);
  }

  const data = await response.json();
  return parseDeepSeekJson(data.choices?.[0]?.message?.content ?? '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
  const placeholders = ['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'];
  if (!DEEPSEEK_API_KEY || placeholders.some(p => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: '请先在 Vercel 项目设置中配置 DEEPSEEK_API_KEY 环境变量',
    });
  }

  const write = (obj: object) => {
    res.write(JSON.stringify(obj) + '\n');
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  try {
    const { paragraphs, sourceLang = 'en', sourceLangFull, targetLang: rawTarget } = (req.body || {}) as { paragraphs?: string[]; sourceLang?: string; sourceLangFull?: string; targetLang?: string };
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    const lang = sourceLangFull || sourceLang || 'en';
    const targetLang = normalizeTargetLang(rawTarget);

    const flow = resolveTranslationFlow(lang, targetLang);
    if ('error' in flow) {
      return res.status(400).json({ error: flow.error });
    }

    const { analysisLang, layout, transPrompt } = flow;

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as unknown as { flushHeaders: () => void }).flushHeaders();
    }

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);
    const total = chunks.length;
    const allTranslations: { en: string; zh: string }[][] = new Array(total);
    const englishPairsForMorseFallback: { en: string; zh: string }[][] | undefined =
      (targetLang === 'morse' || targetLang === 'aki') ? new Array(total) : undefined;
    let completedCount = 0;

    write({ type: 'progress', chunk: 0, total, percent: 0, step: `准备翻译共 ${total} 段...` });

    // analysis 与所有翻译块完全并行
    const analysisPromise = callDeepSeek(buildAnalysisOnlyPrompt(paragraphs, analysisLang, targetLang), DEEPSEEK_API_KEY);

    // 所有翻译块并行发起，每块完成后立即推送进度
    const chunkPromises = chunks.map((chunk, i) =>
      callDeepSeek(transPrompt(chunk), DEEPSEEK_API_KEY).then(async (chunkJson) => {
        const chunkRaw = normalizeTranslationToArray(chunkJson?.translation, chunk.length);
        const chunkPairs = chunkRaw.length > 0 ? mergeTranslation(chunk, chunkRaw, layout) : [];
        if (englishPairsForMorseFallback) englishPairsForMorseFallback[i] = chunkPairs;
        const chunkPairsOut =
          targetLang === 'morse' ? applyMorseEncodingToPairs(chunkPairs)
          : targetLang === 'aki'
            ? await applyAkiEncodingToPairsAsync(chunkPairs, layout, (t) =>
                fetchAkiMemePairDeepseek(t, DEEPSEEK_API_KEY)
              )
            : chunkPairs;
        allTranslations[i] = chunkPairsOut;
        completedCount++;
        const pct = Math.round((completedCount / total) * 100);
        write({ type: 'progress', chunk: completedCount, total, percent: pct, step: `翻译第 ${completedCount}/${total} 段` });
        write({ type: 'chunk_done', chunkIndex: i + 1, pairs: chunkPairsOut });
      })
    );

    const [analysisJson] = await Promise.all([analysisPromise, ...chunkPromises]);

    const flatTranslations = allTranslations.flat();
    if (flatTranslations.length === 0) {
      write({ type: 'error', message: '模型返回格式异常，请重试' });
      return res.end();
    }

    let title = mapTitleAuthorToSlots(analysisJson?.title, layout);
    let author = mapTitleAuthorToSlots(analysisJson?.author, layout);

    const flatForTitleFallback =
      englishPairsForMorseFallback && (targetLang === 'morse' || targetLang === 'aki')
        ? englishPairsForMorseFallback.flat()
        : flatTranslations;
    const fallback = extractTitleAuthorFromTranslation(flatForTitleFallback);
    const isEmpty = (t: { en?: string; zh?: string }) => {
      const v = (t?.en?.trim() || t?.zh?.trim() || '').replace(/[—\-]/g, '');
      return !v;
    };
    if (isEmpty(title) && (fallback.title?.en || fallback.title?.zh)) {
      title = fallback.title!;
    }
    if (isEmpty(author) && (fallback.author?.en || fallback.author?.zh)) {
      author = fallback.author!;
    }

    if (targetLang === 'morse') {
      title = applyMorseToTitleAuthorSlots(title, layout);
      author = applyMorseToTitleAuthorSlots(author, layout);
    }
    if (targetLang === 'aki') {
      title = applyAkiToTitleAuthorSlots(title, layout);
      author = applyAkiToTitleAuthorSlots(author, layout);
    }

    const analysis = normalizeAnalysis(analysisJson?.analysis);
    write({ type: 'done', result: { title, author, translation: flatTranslations, analysis } });
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    write({ type: 'error', message: msg });
    res.end();
  }
}
