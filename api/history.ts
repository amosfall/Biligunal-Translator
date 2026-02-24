import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

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

async function withHistoryDb<T>(fn: (sql: Awaited<ReturnType<typeof neon>>) => Promise<T>): Promise<T | null> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const result = await withHistoryDb(async (sql) => {
      const rows = await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis
        FROM translations ORDER BY created_at_ms DESC LIMIT 100`;
      return rows as Record<string, unknown>[];
    });
    if (result === null) {
      return res.status(503).json({ error: '历史同步未配置。在 Vercel Storage 连接 Neon 或添加 DATABASE_URL。' });
    }
    const items = result.map((r) => ({
      id: String(r.id),
      createdAt: Number(r.created_at_ms),
      title: { zh: String(r.title_zh ?? ''), en: String(r.title_en ?? '') },
      author: { zh: String(r.author_zh ?? ''), en: String(r.author_en ?? '') },
      content: (r.content as { en: string; zh: string }[]) ?? [],
      analysis: (r.analysis as Record<string, unknown>) ?? null,
    }));
    return res.json(items);
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as {
      id?: string;
      createdAt?: number;
      title?: { zh: string; en: string };
      author?: { zh: string; en: string };
      content?: { en: string; zh: string }[];
      analysis?: Record<string, unknown> | null;
    };
    const id = (body?.id || crypto.randomUUID()) as string;
    const createdAt = typeof body?.createdAt === 'number' ? body.createdAt : Date.now();
    const title = body?.title ?? { zh: '', en: '' };
    const author = body?.author ?? { zh: '', en: '' };
    const content = Array.isArray(body?.content) ? body.content : [];
    const analysis = body?.analysis ?? null;
    if (content.length === 0) return res.status(400).json({ error: 'content 不能为空' });

    const ok = await withHistoryDb(async (sql) => {
      // 使用 JSON.stringify + 无显式 cast，由列类型隐式转换为 JSONB
      const contentStr = JSON.stringify(content);
      const analysisStr = analysis ? JSON.stringify(analysis) : null;
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
  }

  if (req.method === 'DELETE') {
    const id = (req.query?.id ?? (req.body as { id?: string })?.id) as string | undefined;
    if (!id) return res.status(400).json({ error: '缺少 id' });
    const ok = await withHistoryDb(async (sql) => {
      await sql`DELETE FROM translations WHERE id = ${id}`;
      return true;
    });
    if (ok === null) return res.status(503).json({ error: '历史同步未配置。' });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
