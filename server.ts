import dotenv from 'dotenv';
import express from 'express';
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
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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

function buildTranslationOnlyPrompt(paragraphs: string[]): string {
  return `将以下英文段落翻译为中文，仅输出 JSON，格式如下（不要多余文字）。translation 为中文数组，顺序与输入一一对应，不要回显英文：
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

type BilingualStr = { en: string; zh: string };
type BilingualAnalysis = { summary: BilingualStr; narrativeDetail: BilingualStr; themes: BilingualStr[]; pros: BilingualStr[]; cons: BilingualStr[] };

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
    const { paragraphs, sourceLang = 'en' } = req.body as { paragraphs: string[]; sourceLang?: 'en' | 'zh' };

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    const transOnlyPrompt = sourceLang === 'zh' ? buildZhToEnTranslationOnlyPrompt : buildTranslationOnlyPrompt;

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);

    // 所有块全部用 translation-only prompt，与 analysis 完全并行
    const [analysisJson, ...translationResults] = await Promise.all([
      callDeepSeekCached(buildAnalysisOnlyPrompt(paragraphs, sourceLang), DEEPSEEK_API_KEY),
      ...chunks.map((chunk) => callDeepSeekCached(transOnlyPrompt(chunk), DEEPSEEK_API_KEY)),
    ]);

    const allTranslations: { en: string; zh: string }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkRaw = normalizeTranslationToArray(translationResults[i]?.translation, chunks[i].length);
      if (chunkRaw.length > 0) {
        allTranslations.push(...mergeTranslation(chunks[i], chunkRaw, sourceLang));
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
    const { paragraphs, sourceLang = 'en' } = req.body as { paragraphs: string[]; sourceLang?: 'en' | 'zh' };

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const transOnlyPrompt = sourceLang === 'zh' ? buildZhToEnTranslationOnlyPrompt : buildTranslationOnlyPrompt;

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);
    const total = chunks.length;
    const allTranslations: { en: string; zh: string }[][] = new Array(total);
    let completedCount = 0;

    write({ type: 'progress', chunk: 0, total, percent: 0, step: `准备翻译共 ${total} 段...` });

    // analysis 与所有翻译块完全并行
    const analysisPromise = callDeepSeekCached(buildAnalysisOnlyPrompt(paragraphs, sourceLang), DEEPSEEK_API_KEY);

    // 所有翻译块并行发起，每块完成后立即推送进度
    const chunkPromises = chunks.map((chunk, i) =>
      callDeepSeekCached(transOnlyPrompt(chunk), DEEPSEEK_API_KEY).then((chunkJson) => {
        const chunkRaw = normalizeTranslationToArray(chunkJson?.translation, chunk.length);
        const chunkPairs = chunkRaw.length > 0 ? mergeTranslation(chunk, chunkRaw, sourceLang) : [];
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

// 历史记录（多设备同步，需 DATABASE_URL）
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  created_at_ms BIGINT NOT NULL,
  title_zh TEXT,
  title_en TEXT,
  author_zh TEXT,
  author_en TEXT,
  content JSONB NOT NULL,
  analysis JSONB
)`;

async function withHistoryDb<T>(fn: (sql: ReturnType<typeof neon>) => Promise<T>): Promise<T | null> {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  try {
    const sql = neon(url);
    await sql.query(TABLE_SQL);
    return await fn(sql);
  } catch {
    return null;
  }
}

app.get('/api/history', async (_req, res) => {
  const result = await withHistoryDb(async (sql) => {
    const rows = await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis
      FROM translations ORDER BY created_at_ms DESC LIMIT 100`;
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
  }));
  return res.json(items);
});

app.post('/api/history', async (req, res) => {
  const body = req.body as { id?: string; createdAt?: number; title?: { zh: string; en: string }; author?: { zh: string; en: string }; content?: { en: string; zh: string }[]; analysis?: Record<string, unknown> | null };
  const id = (body?.id || crypto.randomUUID()) as string;
  const createdAt = typeof body?.createdAt === 'number' ? body.createdAt : Date.now();
  const title = body?.title ?? { zh: '', en: '' };
  const author = body?.author ?? { zh: '', en: '' };
  const content = Array.isArray(body?.content) ? body.content : [];
  const analysis = body?.analysis ?? null;
  if (content.length === 0) return res.status(400).json({ error: 'content 不能为空' });

  const contentStr = JSON.stringify(content);
  const analysisStr = analysis ? JSON.stringify(analysis) : null;
  const ok = await withHistoryDb(async (sql) => {
    // 使用 JSON.stringify + 无显式 cast，由列类型隐式转换为 JSONB（node-pg 推荐做法）
    await sql.query(
      `INSERT INTO translations (id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET created_at_ms = EXCLUDED.created_at_ms, title_zh = EXCLUDED.title_zh, title_en = EXCLUDED.title_en,
         author_zh = EXCLUDED.author_zh, author_en = EXCLUDED.author_en, content = EXCLUDED.content, analysis = EXCLUDED.analysis`,
      [id, createdAt, title.zh ?? '', title.en ?? '', author.zh ?? '', author.en ?? '', contentStr, analysisStr]
    );
    return true;
  });
  if (ok === null) return res.status(503).json({ error: '历史同步未配置。' });
  return res.json({ id, createdAt });
});

app.delete('/api/history', async (req, res) => {
  const id = (req.query?.id ?? req.body?.id) as string | undefined;
  if (!id) return res.status(400).json({ error: '缺少 id' });
  const ok = await withHistoryDb(async (sql) => {
    await sql`DELETE FROM translations WHERE id = ${id}`;
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
});
