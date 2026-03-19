import type { VercelRequest, VercelResponse } from '@vercel/node';
import JSON5 from 'json5';

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
type BilingualAnalysis = { summary: BilingualStr; narrativeDetail: BilingualStr; themes: BilingualStr[]; pros: BilingualStr[]; cons: BilingualStr[] };

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

  const hasContent = summary.en || summary.zh || narrativeDetail.en || narrativeDetail.zh ||
    themes.length > 0 || pros.length > 0 || cons.length > 0;
  if (!hasContent) return null;

  const ph: BilingualStr = { en: '—', zh: '—' };
  return {
    summary: (summary.en || summary.zh) ? summary : ph,
    narrativeDetail: (narrativeDetail.en || narrativeDetail.zh) ? narrativeDetail : ph,
    themes: themes.length ? themes : [ph],
    pros: pros.length ? pros : [ph],
    cons: cons.length ? cons : [ph],
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

function buildTranslationOnlyPrompt(paragraphs: string[]): string {
  return `将以下英文段落翻译为中文，仅输出 JSON，格式如下（不要多余文字）。translation 为中文数组，顺序与输入一一对应，不要回显英文：
{
  "translation": ["中文1", "中文2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildAnalysisOnlyPrompt(paragraphs: string[], sourceLang: 'en' | 'zh'): string {
  const langLabel = sourceLang === 'zh' ? '中文' : '英文';
  return `你是一个专业的中英双语文学编辑。请对以下${langLabel}文章进行结构化写作分析，并提取标题和作者。

【标题提取规则】
- 标题通常是第一段或第一行，多为短语
- 若首段是短句（≤60 字、无句号结尾），即视为标题

【作者提取规则】
- 常见格式：英文 "Author: XXX"、"By XXX"；中文 "作者：XXX"
- 只提取姓名，去掉前缀

【字数上限】summary≤60字，narrativeDetail≤200字，其余每项≤40字

输出严格 JSON：
{
  "title": { "en": "...", "zh": "..." },
  "author": { "en": "...", "zh": "..." },
  "analysis": {
    "summary": { "en": "...", "zh": "..." },
    "narrativeDetail": { "en": "...", "zh": "..." },
    "themes": [{ "en": "...", "zh": "..." }],
    "pros": [{ "en": "...", "zh": "..." }],
    "cons": [{ "en": "...", "zh": "..." }]
  }
}

文章内容：
${paragraphs.slice(0, 15).map((p, i) => `# ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildZhToEnTranslationOnlyPrompt(paragraphs: string[]): string {
  return `将以下中文段落翻译为英文，仅输出 JSON，translation 为英文数组，顺序对应，不要回显中文：
{ "translation": ["English 1", "..."] }

段落：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
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
    const { paragraphs, sourceLang = 'en' } = (req.body || {}) as { paragraphs?: string[]; sourceLang?: 'en' | 'zh' };
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as unknown as { flushHeaders: () => void }).flushHeaders();
    }

    const transOnlyPrompt = sourceLang === 'zh' ? buildZhToEnTranslationOnlyPrompt : buildTranslationOnlyPrompt;

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);
    const total = chunks.length;
    const allTranslations: { en: string; zh: string }[][] = new Array(total);
    let completedCount = 0;

    write({ type: 'progress', chunk: 0, total, percent: 0, step: `准备翻译共 ${total} 段...` });

    // analysis 与所有翻译块完全并行
    const analysisPromise = callDeepSeek(buildAnalysisOnlyPrompt(paragraphs, sourceLang), DEEPSEEK_API_KEY);

    // 所有翻译块并行发起，每块完成后立即推送进度
    const chunkPromises = chunks.map((chunk, i) =>
      callDeepSeek(transOnlyPrompt(chunk), DEEPSEEK_API_KEY).then((chunkJson) => {
        const chunkRaw = normalizeTranslationToArray(chunkJson?.translation, chunk.length);
        const chunkPairs = chunkRaw.length > 0 ? mergeTranslation(chunk, chunkRaw, sourceLang) : [];
        allTranslations[i] = chunkPairs;
        completedCount++;
        const pct = Math.round((completedCount / total) * 100);
        write({ type: 'progress', chunk: completedCount, total, percent: pct, step: `翻译第 ${completedCount}/${total} 段` });
        write({ type: 'chunk_done', chunkIndex: i + 1, pairs: chunkPairs });
      })
    );

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
    write({ type: 'done', result: { title, author, translation: flatTranslations, analysis } });
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    write({ type: 'error', message: msg });
    res.end();
  }
}
