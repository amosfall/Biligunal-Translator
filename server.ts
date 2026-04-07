import dotenv from 'dotenv';
import express from 'express';
import { verifyToken } from '@clerk/backend';
import { resolveOwnerDisplayNames } from './lib/clerkUserDisplay.ts';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import JSON5 from 'json5';
import multer from 'multer';
import { OfficeParser as officeParser } from 'officeparser';

// ── 翻译结果内存缓存（基于内容哈希，最多缓存 100 条，30 分钟过期） ──
const CACHE_MAX = 100;
const CACHE_TTL_MS = 30 * 60 * 1000;
const translationCache = new Map<string, { data: Record<string, unknown>; ts: number }>();

function getCacheKey(text: string, sourceLang: string): string {
  return crypto.createHash('md5').update(`${sourceLang}:${text}`).digest('hex');
}

function getFromCache(key: string): Record<string, unknown> | null {
  const entry = translationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    translationCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: Record<string, unknown>): void {
  // LRU 简易实现：超出上限时删除最早的
  if (translationCache.size >= CACHE_MAX) {
    const oldest = translationCache.keys().next().value;
    if (oldest) translationCache.delete(oldest);
  }
  translationCache.set(key, { data, ts: Date.now() });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname);
const cwd = process.cwd();
// 从多个可能位置加载 .env.local（npm 启动时 cwd 为 bilingual-editorial）
// 先加载 example 作为默认，再加载 .env.local 覆盖（后者优先）
dotenv.config({ path: path.join(root, '.env.example') });
dotenv.config({ path: path.join(root, '.env'), override: true });
dotenv.config({ path: path.join(root, '.env.local'), override: true });
dotenv.config({ path: path.join(cwd, '.env.local'), override: true });
dotenv.config({ path: path.join(cwd, '..', '.env.local'), override: true });

const app = express();
app.use(express.json());

// CORS：允许 localhost、127.0.0.1、局域网 IP，避免用不同地址访问时翻译失败
const allowOrigin = (origin: string | undefined): string => {
  if (!origin) return 'http://localhost:3000';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origin)) return origin;
  return 'http://localhost:3000';
};
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', allowOrigin(req.headers.origin));
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

const PORT = process.env.PORT || 8787;

/** 规则兜底：从译文前几段中提取标题和作者 */
function extractTitleAuthorFromTranslation(
  translation: { en: string; zh: string }[]
): { title?: { en: string; zh: string }; author?: { en: string; zh: string } } {
  const result: { title?: { en: string; zh: string }; author?: { en: string; zh: string } } = {};
  const firstFew = translation.slice(0, 4).map(p => ({ en: (p.en || '').trim(), zh: (p.zh || '').trim() }));

  // 标题：首段（或首行）若较短且非作者行，视为标题
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
    if (!isAuthorLine && (enShort || zhShort)) {
      result.title = { en: firstLineEn, zh: firstLineZh };
    }
  }

  // 作者：匹配 "作者：XXX" / "Author: XXX" / "by XXX"
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

// 每块最多发送给 DeepSeek 的字符数 — 增大到 ~10000 以减少 API 调用次数
// DeepSeek deepseek-chat 上下文窗口 64K，8192 output tokens 足够处理更大输入块
const CHUNK_SIZE = 10000;

function splitIntoChunks(paragraphs: string[], maxChars: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paragraphs) {
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

const sanitizeJson = (s: string) => s.replace(/,(\s*[\]}])/g, '$1');

function parseDeepSeekJson(content: string): Record<string, unknown> {
  try { return JSON.parse(content || '{}'); } catch {}
  try { return JSON.parse(sanitizeJson(content)); } catch {}
  try { return JSON5.parse(content); } catch {}
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
  const extracted = m ? (m[1] ?? m[0]) : '{}';
  try { return JSON5.parse(extracted); } catch { return {}; }
}

async function callDeepSeekCached(prompt: string, apiKey: string): Promise<Record<string, unknown>> {
  const key = getCacheKey(prompt, 'prompt');
  const cached = getFromCache(key);
  if (cached) return cached;
  const result = await callDeepSeek(prompt, apiKey);
  setCache(key, result);
  return result;
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
    console.error('DeepSeek API error:', response.status, text);
    let userMsg = 'DeepSeek API 调用失败';
    try {
      const errJson = JSON.parse(text);
      const apiErr = errJson?.error?.message || errJson?.message || errJson?.error;
      if (apiErr) userMsg = typeof apiErr === 'string' ? apiErr : String(apiErr);
      if (response.status === 401) userMsg = 'API Key 无效或已过期，请检查 .env.local 中的 DEEPSEEK_API_KEY';
      else if (response.status === 429) userMsg = '请求过于频繁，请稍后再试';
    } catch {}
    throw new Error(userMsg);
  }

  const data = await response.json();
  return parseDeepSeekJson(data.choices?.[0]?.message?.content ?? '');
}

const LANG_NAMES: Record<string, string> = { en: '英文', fr: '法文', ja: '日文', 'zh-TW': '繁体中文', zh: '中文' };

function buildTranslationToZhPrompt(paragraphs: string[], fromLang = 'en'): string {
  const langName = LANG_NAMES[fromLang] || '外文';
  return `将以下${langName}段落翻译为简体中文，仅输出 JSON，格式如下（不要多余文字）。translation 为简体中文数组，顺序与输入一一对应，不要回显原文：
{
  "translation": ["中文1", "中文2", "..."]
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

function buildAnalysisOnlyPrompt(paragraphs: string[], sourceLang: string): string {
  const langLabel = LANG_NAMES[sourceLang] || '英文';
  return `你是一个专业的中英双语文学编辑。请对以下${langLabel}文章进行结构化写作分析，并提取标题和作者。

【标题提取规则】
- 标题通常是第一段或第一行，多为短语
- 若首段是短句（≤60 字、无句号结尾），即视为标题

【作者提取规则】
- 常见格式：英文 "Author: XXX"、"By XXX"；中文 "作者：XXX"
- 只提取姓名，去掉前缀

【字数上限】summary≤60字，narrativeDetail≤200字，plotSynopsis约500字（详细的剧情梗概），其余每项≤40字
【人物提取】characters 数组列出文中主要人物，每个人物包含 name 和 description（简要介绍其身份、性格、在故事中的角色）

输出严格 JSON：
{
  "title": { "en": "...", "zh": "..." },
  "author": { "en": "...", "zh": "..." },
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

type BilingualStr = { en: string; zh: string };
type CharacterInfo = { name: BilingualStr; description: BilingualStr };
type BilingualAnalysis = { summary: BilingualStr; narrativeDetail: BilingualStr; themes: BilingualStr[]; pros: BilingualStr[]; cons: BilingualStr[]; plotSynopsis?: BilingualStr; characters?: CharacterInfo[] };

/** 规范化模型返回的 analysis，支持双语对象和旧版纯字符串 */
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

/** 将模型可能返回的各种 translation 格式统一为数组 */
function normalizeTranslationToArray(raw: unknown, expectedLen: number): unknown[] {
  if (Array.isArray(raw)) return raw;
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
  if (typeof raw === 'string') return raw.split(/\n\s*\n/).filter(Boolean);
  return [];
}

/** 移除模型可能回显的段落标记（如 # Paragraph 8、# 段落 9） */
function stripParagraphMarkers(s: string): string {
  return s
    .replace(/(?:^|\n)\s*#\s*(?:Paragraph|段落)\s*\d+\s*(?:\n|$)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mergeTranslation(
  sourceParagraphs: string[],
  raw: unknown[],
  sourceLang: 'en' | 'zh'
): { en: string; zh: string }[] {
  return sourceParagraphs.map((src, i) => {
    const v = raw[i];
    let translated = '';
    if (typeof v === 'string') {
      translated = stripParagraphMarkers(v);
    } else if (v && typeof v === 'object') {
      const key = sourceLang === 'zh' ? 'en' : 'zh';
      translated = stripParagraphMarkers(String((v as Record<string, unknown>)[key] ?? ''));
    }
    return sourceLang === 'zh'
      ? { en: translated, zh: src }
      : { en: src, zh: translated };
  });
}

const FOLLOWUP_CONTEXT_MAX = 28000;
const FOLLOWUP_ANALYSIS_MAX = 12000;

function truncateFollowupContext(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[... 内容已截断 ...]`;
}

function buildFollowupArticleContext(
  content: { en: string; zh: string }[],
  title: { en: string; zh: string } | undefined,
  author: { en: string; zh: string } | undefined,
  analysis: unknown
): string {
  const parts: string[] = [];
  if (title && (title.en || title.zh)) {
    parts.push(`标题 / Title\nZH: ${title.zh || '—'}\nEN: ${title.en || '—'}`);
  }
  if (author && (author.en || author.zh)) {
    parts.push(`作者 / Author\nZH: ${author.zh || '—'}\nEN: ${author.en || '—'}`);
  }
  const paras = content
    .map((p, i) => `--- 段落 ${i + 1} ---\n[EN]\n${p.en || ''}\n\n[ZH]\n${p.zh || ''}`)
    .join('\n\n');
  parts.push(`正文 / Body\n${paras}`);
  if (analysis != null && analysis !== '') {
    try {
      const raw = typeof analysis === 'string' ? analysis : JSON.stringify(analysis);
      parts.push(`已有结构化分析（供参考）\n${truncateFollowupContext(raw, FOLLOWUP_ANALYSIS_MAX)}`);
    } catch {
      /* ignore */
    }
  }
  return truncateFollowupContext(parts.join('\n\n'), FOLLOWUP_CONTEXT_MAX);
}

type FollowupHistoryItem =
  | { role: 'user'; content: string }
  | { role: 'assistant'; zh?: string; en?: string; content?: string };

function buildFollowupHistoryText(history: FollowupHistoryItem[] | undefined): string {
  if (!Array.isArray(history) || history.length === 0) return '';
  const lines: string[] = [];
  for (const h of history.slice(-12)) {
    if (h.role === 'user' && typeof h.content === 'string' && h.content.trim()) {
      lines.push(`用户：${h.content.trim()}`);
    } else if (h.role === 'assistant') {
      const zh = (h.zh || '').trim();
      const en = (h.en || '').trim();
      const fallback = (h.content || '').trim();
      if (zh || en) lines.push(`助手：\n中文：${zh || '—'}\nEnglish：${en || '—'}`);
      else if (fallback) lines.push(`助手：${fallback}`);
    }
  }
  return lines.join('\n\n');
}

async function callDeepSeekTextFollowup(userPrompt: string, apiKey: string): Promise<{ zh: string; en: string }> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content:
            '你是专业的中英双语文学编辑助手。用户会提供文章正文（含英中对照）、可选的结构化分析摘要、以及此前的对话摘录。你必须仅依据这些内容回答用户关于文本的深度追问，不要编造文中不存在的情节或引用。若问题与文本明显无关，请礼貌说明并引导回到文本。\n请始终只输出一个 JSON 对象，且必须包含键 "zh"（简体中文）与 "en"（英文），两者语义一致，风格为文学评论。',
        },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('DeepSeek follow-up error:', response.status, text);
    let userMsg = 'DeepSeek API 调用失败';
    try {
      const errJson = JSON.parse(text);
      const apiErr = errJson?.error?.message || errJson?.message || errJson?.error;
      if (apiErr) userMsg = typeof apiErr === 'string' ? apiErr : String(apiErr);
      if (response.status === 401) userMsg = 'API Key 无效或已过期，请检查 .env.local 中的 DEEPSEEK_API_KEY';
      else if (response.status === 429) userMsg = '请求过于频繁，请稍后再试';
    } catch {}
    throw new Error(userMsg);
  }

  const data = await response.json();
  const obj = parseDeepSeekJson(data.choices?.[0]?.message?.content ?? '');
  const zh = typeof obj.zh === 'string' ? obj.zh.trim() : '';
  const en = typeof obj.en === 'string' ? obj.en.trim() : '';
  if (!zh && !en) throw new Error('模型未返回有效回答');
  return { zh: zh || en, en: en || zh };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/extract-text', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到文件' });
  try {
    const ast = await officeParser.parseOffice(req.file!.buffer);
    const text = ast.toText();
    return res.json({ text });
  } catch (e) {
    return res.status(500).json({ error: '文件解析失败，请确认文件完整' });
  }
});

app.post('/api/translate', async (req, res) => {
  const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
  const placeholders = ['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'];
  if (!DEEPSEEK_API_KEY || placeholders.some(p => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: '请先配置 DeepSeek API Key。在 bilingual-editorial 目录下创建 .env.local，填写：DEEPSEEK_API_KEY=你的密钥'
    });
  }

  try {
    const { paragraphs, sourceLang = 'en', sourceLangFull } = req.body as { paragraphs: string[]; sourceLang?: string; sourceLangFull?: string };
    const lang = sourceLangFull || sourceLang;
    const mergeLang: 'en' | 'zh' = lang === 'zh' ? 'zh' : 'en';

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    const transOnlyPrompt = (chunk: string[]) => buildTranslationToZhPrompt(chunk, lang);

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);

    const [analysisJson, ...translationResults] = await Promise.all([
      callDeepSeekCached(buildAnalysisOnlyPrompt(paragraphs, lang), DEEPSEEK_API_KEY),
      ...chunks.map((chunk) => callDeepSeekCached(transOnlyPrompt(chunk), DEEPSEEK_API_KEY)),
    ]);

    const allTranslations: { en: string; zh: string }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkRaw = normalizeTranslationToArray(translationResults[i]?.translation, chunks[i].length);
      if (chunkRaw.length > 0) {
        allTranslations.push(...mergeTranslation(chunks[i], chunkRaw, mergeLang));
      }
    }

    if (allTranslations.length === 0) {
      return res.status(500).json({ error: '模型返回格式异常，请重试' });
    }

    let title = (analysisJson?.title as { en: string; zh: string }) ?? { en: '', zh: '' };
    let author = (analysisJson?.author as { en: string; zh: string }) ?? { en: '', zh: '' };

    // 规则兜底：若模型未提取到标题/作者，从前几段译文中用正则提取
    const fallback = extractTitleAuthorFromTranslation(allTranslations);
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

    const analysis = normalizeAnalysis(analysisJson?.analysis);
    return res.json({ title, author, translation: allTranslations, analysis });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error(err);
    return res.status(500).json({ error: msg });
  }
});

app.post('/api/translate-stream', async (req, res) => {
  const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
  const placeholders = ['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'];
  if (!DEEPSEEK_API_KEY || placeholders.some(p => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: '请先配置 DeepSeek API Key。在 bilingual-editorial 目录下创建 .env.local，填写：DEEPSEEK_API_KEY=你的密钥'
    });
  }

  const write = (obj: object) => {
    res.write(JSON.stringify(obj) + '\n');
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  try {
    const { paragraphs, sourceLang = 'en', sourceLangFull } = req.body as { paragraphs: string[]; sourceLang?: string; sourceLangFull?: string };
    const lang = sourceLangFull || sourceLang;
    const mergeLang: 'en' | 'zh' = lang === 'zh' ? 'zh' : 'en';

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const transOnlyPrompt = (chunk: string[]) => buildTranslationToZhPrompt(chunk, lang);

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);
    const total = chunks.length;
    const allTranslations: { en: string; zh: string }[][] = new Array(total);
    let completedCount = 0;

    write({ type: 'progress', chunk: 0, total, percent: 0, step: `准备翻译共 ${total} 段...` });

    const analysisPromise = callDeepSeekCached(buildAnalysisOnlyPrompt(paragraphs, lang), DEEPSEEK_API_KEY);

    // 所有翻译块并行发起，每块完成后立即推送进度
    const chunkPromises = chunks.map((chunk, i) =>
      callDeepSeekCached(transOnlyPrompt(chunk), DEEPSEEK_API_KEY).then((chunkJson) => {
        const chunkRaw = normalizeTranslationToArray(chunkJson?.translation, chunk.length);
        const chunkPairs = chunkRaw.length > 0 ? mergeTranslation(chunk, chunkRaw, mergeLang) : [];
        allTranslations[i] = chunkPairs;
        completedCount++;
        const pct = Math.round((completedCount / total) * 100);
        write({ type: 'progress', chunk: completedCount, total, percent: pct, step: `翻译第 ${completedCount}/${total} 段` });
        // 推送第一块时附带 analysis（如果已完成）
        write({ type: 'chunk_done', chunkIndex: i + 1, pairs: chunkPairs });
      })
    );

    // 等待所有翻译和 analysis 完成
    const [analysisJson] = await Promise.all([analysisPromise, ...chunkPromises]);

    const flatTranslations = allTranslations.flat();
    if (flatTranslations.length === 0) {
      write({ type: 'error', message: '模型返回格式异常，请重试' });
      return res.end();
    }

    let title = (analysisJson?.title as { en: string; zh: string }) ?? { en: '', zh: '' };
    let author = (analysisJson?.author as { en: string; zh: string }) ?? { en: '', zh: '' };

    const fallback = extractTitleAuthorFromTranslation(flatTranslations);
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

    const analysis = normalizeAnalysis(analysisJson?.analysis);
    write({
      type: 'done',
      result: { title, author, translation: flatTranslations, analysis }
    });
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error(err);
    write({ type: 'error', message: msg });
    res.end();
  }
});

app.post('/api/text-followup', async (req, res) => {
  const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
  const placeholders = ['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'];
  if (!DEEPSEEK_API_KEY || placeholders.some(p => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: '请先配置 DeepSeek API Key。在 bilingual-editorial 目录下创建 .env.local，填写：DEEPSEEK_API_KEY=你的密钥',
    });
  }

  try {
    const body = req.body as {
      question?: string;
      content?: { en: string; zh: string }[];
      title?: { en: string; zh: string };
      author?: { en: string; zh: string };
      analysis?: unknown;
      history?: FollowupHistoryItem[];
    };
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question) return res.status(400).json({ error: 'question 不能为空' });
    const content = Array.isArray(body?.content) ? body.content : [];
    if (content.length === 0) return res.status(400).json({ error: 'content 不能为空' });

    const articleCtx = buildFollowupArticleContext(
      content,
      body.title,
      body.author,
      body.analysis ?? null
    );
    const histText = buildFollowupHistoryText(body.history);
    const userPrompt = ['【文章与背景】', articleCtx, histText ? `【此前对话】\n${histText}` : '', '【当前问题】', question]
      .filter(Boolean)
      .join('\n\n');

    const reply = await callDeepSeekTextFollowup(userPrompt, DEEPSEEK_API_KEY);
    return res.json({ reply });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error(err);
    return res.status(500).json({ error: msg });
  }
});

// 历史记录（多设备同步，需 DATABASE_URL）
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  created_at_ms BIGINT NOT NULL,
  title_zh TEXT,
  title_en TEXT,
  author_zh TEXT,
  author_en TEXT,
  content JSONB NOT NULL,
  analysis JSONB,
  annotations JSONB,
  username TEXT,
  source_lang TEXT
)`;

const MIGRATE_SQLS = [
  `ALTER TABLE translations ADD COLUMN IF NOT EXISTS annotations JSONB`,
  `ALTER TABLE translations ADD COLUMN IF NOT EXISTS username TEXT`,
  `ALTER TABLE translations ADD COLUMN IF NOT EXISTS source_lang TEXT`,
];

async function withHistoryDb<T>(fn: (sql: ReturnType<typeof neon>) => Promise<T>): Promise<T | null> {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  try {
    const sql = neon(url);
    await sql.query(TABLE_SQL);
    for (const m of MIGRATE_SQLS) { try { await sql.query(m); } catch {} }
    return await fn(sql);
  } catch {
    return null;
  }
}

type ClerkHistoryAuth = 'legacy' | { userId: string } | 'unauthorized';

async function resolveClerkHistoryUser(req: express.Request): Promise<ClerkHistoryAuth> {
  const secret = (process.env.CLERK_SECRET_KEY || '').trim();
  if (!secret) return 'legacy';
  const raw = req.headers.authorization;
  const token = raw?.startsWith('Bearer ') ? raw.slice(7) : null;
  if (!token) return 'unauthorized';
  try {
    const payload = await verifyToken(token, { secretKey: secret });
    const sub = payload.sub;
    if (typeof sub !== 'string' || !sub) return 'unauthorized';
    return { userId: sub };
  } catch {
    return 'unauthorized';
  }
}

function getClerkHistoryAdminIds(): Set<string> {
  const raw = (process.env.CLERK_ADMIN_USER_IDS || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function isClerkHistoryAdmin(userId: string): boolean {
  return getClerkHistoryAdminIds().has(userId);
}

app.get('/api/history', async (req, res) => {
  const auth = await resolveClerkHistoryUser(req);
  if (auth === 'unauthorized') {
    return res.status(401).json({ error: '未登录或会话无效。请重新登录。' });
  }
  const admin = auth !== 'legacy' && isClerkHistoryAdmin(auth.userId);
  const result = await withHistoryDb(async (sql) => {
    const rows =
      auth === 'legacy'
        ? await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang
            FROM translations ORDER BY created_at_ms DESC LIMIT 100`
        : admin
          ? await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang
              FROM translations ORDER BY created_at_ms DESC LIMIT 500`
          : await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang
              FROM translations WHERE username = ${auth.userId} ORDER BY created_at_ms DESC LIMIT 100`;
    return rows as Record<string, unknown>[];
  });
  if (result === null) return res.status(503).json({ error: '历史同步未配置。在 .env.local 添加 DATABASE_URL 或在 Vercel 连接 Neon。' });
  const items = result.map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at_ms),
    title: { zh: String(r.title_zh ?? ''), en: String(r.title_en ?? '') },
    author: { zh: String(r.author_zh ?? ''), en: String(r.author_en ?? '') },
    content: (r.content as { en: string; zh: string }[]) ?? [],
    analysis: (r.analysis as Record<string, unknown>) ?? null,
    annotations: (r.annotations as Record<string, unknown>) ?? undefined,
    username: r.username ? String(r.username) : undefined,
    sourceLang: r.source_lang ? String(r.source_lang) : undefined,
  }));
  const labelMap = await resolveOwnerDisplayNames(
    items.map((i) => i.username),
    (process.env.CLERK_SECRET_KEY || '').trim()
  );
  const enriched = items.map((it) => ({
    ...it,
    ownerDisplayName: it.username ? (labelMap.get(it.username) ?? it.username) : undefined,
  }));
  res.setHeader('Access-Control-Expose-Headers', 'X-History-Admin');
  res.setHeader('X-History-Admin', admin ? '1' : '0');
  return res.json(enriched);
});

app.post('/api/history', async (req, res) => {
  const auth = await resolveClerkHistoryUser(req);
  if (auth === 'unauthorized') {
    return res.status(401).json({ error: '未登录或会话无效。请重新登录。' });
  }
  const body = req.body as {
    id?: string; createdAt?: number;
    title?: { zh: string; en: string }; author?: { zh: string; en: string };
    content?: { en: string; zh: string }[];
    analysis?: Record<string, unknown> | null;
    annotations?: Record<string, unknown> | null;
    username?: string; sourceLang?: string;
  };
  const id = (body?.id || crypto.randomUUID()) as string;
  const createdAt = typeof body?.createdAt === 'number' ? body.createdAt : Date.now();
  const title = body?.title ?? { zh: '', en: '' };
  const author = body?.author ?? { zh: '', en: '' };
  const content = Array.isArray(body?.content) ? body.content : [];
  const analysis = body?.analysis ?? null;
  const annotations = body?.annotations ?? null;
  const dbUsername = auth !== 'legacy' ? auth.userId : (body?.username || null);
  const dbSourceLang = body?.sourceLang || null;
  if (content.length === 0) return res.status(400).json({ error: 'content 不能为空' });

  const contentStr = JSON.stringify(content);
  const analysisStr = analysis ? JSON.stringify(analysis) : null;
  const annotationsStr = annotations ? JSON.stringify(annotations) : null;
  const ok = await withHistoryDb(async (sql) => {
    await sql.query(
      `INSERT INTO translations (id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET created_at_ms = EXCLUDED.created_at_ms, title_zh = EXCLUDED.title_zh, title_en = EXCLUDED.title_en,
         author_zh = EXCLUDED.author_zh, author_en = EXCLUDED.author_en, content = EXCLUDED.content, analysis = EXCLUDED.analysis,
         annotations = EXCLUDED.annotations, username = EXCLUDED.username, source_lang = EXCLUDED.source_lang`,
      [id, createdAt, title.zh ?? '', title.en ?? '', author.zh ?? '', author.en ?? '', contentStr, analysisStr, annotationsStr, dbUsername, dbSourceLang]
    );
    return true;
  });
  if (ok === null) return res.status(503).json({ error: '历史同步未配置。' });
  return res.json({ id, createdAt });
});

app.delete('/api/history', async (req, res) => {
  const auth = await resolveClerkHistoryUser(req);
  if (auth === 'unauthorized') {
    return res.status(401).json({ error: '未登录或会话无效。请重新登录。' });
  }
  const id = (req.query?.id ?? req.body?.id) as string | undefined;
  if (!id) return res.status(400).json({ error: '缺少 id' });
  const ok = await withHistoryDb(async (sql) => {
    if (auth === 'legacy') {
      await sql`DELETE FROM translations WHERE id = ${id}`;
    } else if (isClerkHistoryAdmin(auth.userId)) {
      await sql`DELETE FROM translations WHERE id = ${id}`;
    } else {
      await sql`DELETE FROM translations WHERE id = ${id} AND username = ${auth.userId}`;
    }
    return true;
  });
  if (ok === null) return res.status(503).json({ error: '历史同步未配置。' });
  return res.status(204).end();
});

app.listen(PORT, () => {
  const raw = (process.env.DEEPSEEK_API_KEY || '').trim();
  const hasKey = raw && !['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'].some(p => raw.includes(p));
  console.log(`Translator API running at http://localhost:${PORT}`);
  if (!hasKey) {
    console.warn('⚠️  DEEPSEEK_API_KEY 未配置，翻译请求将失败。请创建 bilingual-editorial/.env.local 并填写密钥。');
  }
  const clerkSecret = (process.env.CLERK_SECRET_KEY || '').trim();
  if (clerkSecret) {
    console.log('✓ CLERK_SECRET_KEY 已配置：/api/history 将校验会话并按用户隔离数据。');
  }
});
