import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import JSON5 from 'json5';

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

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  }
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

// 每块最多发送给 DeepSeek 的字符数（约 1000 词），确保响应在 8192 token 以内
const CHUNK_SIZE = 5500;

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

function buildFullPrompt(paragraphs: string[]): string {
  return `你是一个专业的中英双语文学编辑。

请你将下面的英文段落翻译为中文，并给出结构化的写作分析。同时必须从正文中准确识别并提取文章的标题和作者。

【标题提取规则】
- 标题通常是第一段或第一行，多为短语（如 "TOKYO WEEDS"、"东京杂草"）
- 若首段是短句（≤60 字、无句号结尾），即视为标题
- 保持原标题的格式（全大写、大小写等）

【作者提取规则】
- 作者常见格式：英文 "Author: Amos"、"By John Smith"；中文 "作者：阿莫斯"
- 可能出现在标题下方、文首或文末
- 只提取作者姓名，去掉 "作者："、"Author:"、"By" 等前缀

【字数上限】必须严格遵守，宁可精简不可超出：
- summary：≤60 汉字
- narrativeDetail：≤200 汉字
- themes / pros / cons 每项：≤40 汉字
如果内容不足以填满，请精简表述，不要超出上限。

输出必须是严格的 JSON，结构如下（不要多余文字）。translation 仅返回中文翻译数组，顺序与输入段落一一对应，不要回显英文：
{
  "title": { "en": "英文标题", "zh": "中文标题" },
  "author": { "en": "英文作者名", "zh": "中文作者名" },
  "translation": ["中文翻译1", "中文翻译2", "..."],
  "analysis": {
    "summary": "一句话概括（≤60字）",
    "narrativeDetail": "叙事分析（≤200字）",
    "themes": ["主题1", "主题2", "主题3"],
    "pros": ["优点1", "优点2", "优点3"],
    "cons": ["不足1", "不足2", "不足3"]
  }
}

待翻译的英文段落如下（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function buildTranslationOnlyPrompt(paragraphs: string[]): string {
  return `将以下英文段落翻译为中文，仅输出 JSON，格式如下（不要多余文字）。translation 为中文数组，顺序与输入一一对应，不要回显英文：
{
  "translation": ["中文1", "中文2", "..."]
}

待翻译段落（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
}

function mergeZhWithParagraphs(paragraphs: string[], raw: unknown[]): { en: string; zh: string }[] {
  return paragraphs.map((en, i) => {
    const v = raw[i];
    if (typeof v === 'string') return { en, zh: v };
    if (v && typeof v === 'object' && 'zh' in (v as object)) return { en, zh: String((v as { zh?: string }).zh ?? '') };
    if (v && typeof v === 'object' && 'en' in (v as object)) return { en: String((v as { en?: string }).en ?? en), zh: String((v as { zh?: string }).zh ?? '') };
    return { en, zh: '' };
  });
}

app.post('/api/translate', async (req, res) => {
  const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
  const placeholders = ['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'];
  if (!DEEPSEEK_API_KEY || placeholders.some(p => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: '请先配置 DeepSeek API Key。在 bilingual-editorial 目录下创建 .env.local，填写：DEEPSEEK_API_KEY=你的密钥'
    });
  }

  try {
    const { paragraphs } = req.body as { paragraphs: string[] };

    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);

    // 第一块：完整 prompt（含标题/作者/分析）
    const firstJson = await callDeepSeek(buildFullPrompt(chunks[0]), DEEPSEEK_API_KEY);
    if (!Array.isArray(firstJson?.translation)) {
      return res.status(500).json({ error: '模型返回格式异常，请重试' });
    }

    const allTranslations = mergeZhWithParagraphs(chunks[0], firstJson.translation as unknown[]);

    // 后续块：仅翻译，并行调用以缩短总等待时间
    const restChunks = chunks.slice(1);
    if (restChunks.length > 0) {
      const restResults = await Promise.all(
        restChunks.map((chunk) => callDeepSeek(buildTranslationOnlyPrompt(chunk), DEEPSEEK_API_KEY))
      );
      for (let i = 0; i < restChunks.length; i++) {
        const chunkJson = restResults[i];
        if (Array.isArray(chunkJson?.translation)) {
          allTranslations.push(...mergeZhWithParagraphs(restChunks[i], chunkJson.translation as unknown[]));
        }
      }
    }

    if (!firstJson.title) firstJson.title = { en: '', zh: '' };
    if (!firstJson.author) firstJson.author = { en: '', zh: '' };

    // 规则兜底：若模型未提取到标题/作者，从前几段译文中用正则提取
    const fallback = extractTitleAuthorFromTranslation(allTranslations);
    const isEmpty = (t: { en?: string; zh?: string }) => {
      const v = (t?.en?.trim() || t?.zh?.trim() || '').replace(/[—\-]/g, '');
      return !v;
    };
    if (isEmpty(firstJson.title as object) && (fallback.title?.en || fallback.title?.zh)) {
      firstJson.title = fallback.title;
    }
    if (isEmpty(firstJson.author as object) && (fallback.author?.en || fallback.author?.zh)) {
      firstJson.author = fallback.author;
    }

    return res.json({ ...firstJson, translation: allTranslations });
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
