import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { verifyToken } from '@clerk/backend';
import { resolveOwnerDisplayNames } from '../lib/clerkUserDisplay.ts';

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
  `ALTER TABLE translations ADD COLUMN IF NOT EXISTS target_lang TEXT`,
];

async function withHistoryDb<T>(fn: (sql: Awaited<ReturnType<typeof neon>>) => Promise<T>): Promise<T | null> {
  const url = (process.env.DATABASE_URL || '').trim();
  if (!url) return null;
  try {
    const sql = neon(url);
    await sql.query(TABLE_SQL);
    for (const m of MIGRATE_SQLS) {
      try {
        await sql.query(m);
      } catch {}
    }
    return await fn(sql);
  } catch {
    return null;
  }
}

type ClerkHistoryAuth = 'legacy' | { userId: string } | 'unauthorized';

function getBearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization;
  const h = Array.isArray(raw) ? raw[0] : raw;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

async function resolveClerkHistoryUser(req: VercelRequest): Promise<ClerkHistoryAuth> {
  const secret = (process.env.CLERK_SECRET_KEY || '').trim();
  if (!secret) return 'legacy';
  const token = getBearerToken(req);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const auth = await resolveClerkHistoryUser(req);
    if (auth === 'unauthorized') {
      return res.status(401).json({ error: '未登录或会话无效。请重新登录。' });
    }
    const admin = auth !== 'legacy' && isClerkHistoryAdmin(auth.userId);
    const result = await withHistoryDb(async (sql) => {
      const rows =
        auth === 'legacy'
          ? await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang, target_lang
              FROM translations ORDER BY created_at_ms DESC LIMIT 100`
          : admin
            ? await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang, target_lang
                FROM translations ORDER BY created_at_ms DESC LIMIT 500`
            : await sql`SELECT id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang, target_lang
                FROM translations WHERE username = ${auth.userId} ORDER BY created_at_ms DESC LIMIT 100`;
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
      annotations: (r.annotations as Record<string, unknown>) ?? undefined,
      username: r.username ? String(r.username) : undefined,
      sourceLang: r.source_lang ? String(r.source_lang) : undefined,
      targetLang: r.target_lang ? String(r.target_lang) : undefined,
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
  }

  if (req.method === 'POST') {
    const auth = await resolveClerkHistoryUser(req);
    if (auth === 'unauthorized') {
      return res.status(401).json({ error: '未登录或会话无效。请重新登录。' });
    }
    const body = (req.body || {}) as {
      id?: string;
      createdAt?: number;
      title?: { zh: string; en: string };
      author?: { zh: string; en: string };
      content?: { en: string; zh: string }[];
      analysis?: Record<string, unknown> | null;
      annotations?: Record<string, unknown> | null;
      username?: string;
      sourceLang?: string;
      targetLang?: string;
    };
    const id = (body?.id || crypto.randomUUID()) as string;
    const createdAt = typeof body?.createdAt === 'number' ? body.createdAt : Date.now();
    const title = body?.title ?? { zh: '', en: '' };
    const author = body?.author ?? { zh: '', en: '' };
    const content = Array.isArray(body?.content) ? body.content : [];
    const analysis = body?.analysis ?? null;
    const annotations = body?.annotations ?? null;
    const dbUsername = auth !== 'legacy' ? auth.userId : body?.username || null;
    const dbSourceLang = body?.sourceLang || null;
    const dbTargetLang = body?.targetLang || null;
    if (content.length === 0) return res.status(400).json({ error: 'content 不能为空' });

    const ok = await withHistoryDb(async (sql) => {
      const contentStr = JSON.stringify(content);
      const analysisStr = analysis ? JSON.stringify(analysis) : null;
      const annotationsStr = annotations ? JSON.stringify(annotations) : null;
      await sql.query(
        `INSERT INTO translations (id, created_at_ms, title_zh, title_en, author_zh, author_en, content, analysis, annotations, username, source_lang, target_lang)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET created_at_ms = EXCLUDED.created_at_ms, title_zh = EXCLUDED.title_zh, title_en = EXCLUDED.title_en,
           author_zh = EXCLUDED.author_zh, author_en = EXCLUDED.author_en, content = EXCLUDED.content, analysis = EXCLUDED.analysis,
           annotations = EXCLUDED.annotations, username = EXCLUDED.username, source_lang = EXCLUDED.source_lang, target_lang = EXCLUDED.target_lang`,
        [id, createdAt, title.zh ?? '', title.en ?? '', author.zh ?? '', author.en ?? '', contentStr, analysisStr, annotationsStr, dbUsername, dbSourceLang, dbTargetLang]
      );
      return true;
    });
    if (ok === null) return res.status(503).json({ error: '历史同步未配置。' });
    return res.json({ id, createdAt });
  }

  if (req.method === 'DELETE') {
    const auth = await resolveClerkHistoryUser(req);
    if (auth === 'unauthorized') {
      return res.status(401).json({ error: '未登录或会话无效。请重新登录。' });
    }
    const id = (req.query?.id ?? (req.body as { id?: string })?.id) as string | undefined;
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
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
