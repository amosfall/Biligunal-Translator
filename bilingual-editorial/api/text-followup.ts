import type { VercelRequest, VercelResponse } from '@vercel/node';
import JSON5 from 'json5';

const FOLLOWUP_CONTEXT_MAX = 28000;
const FOLLOWUP_ANALYSIS_MAX = 12000;

const sanitizeJson = (s: string) => s.replace(/,(\s*[\]}])/g, '$1');

function parseDeepSeekJson(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content || '{}');
  } catch {}
  try {
    return JSON.parse(sanitizeJson(content));
  } catch {}
  try {
    return JSON5.parse(content);
  } catch {}
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
  const extracted = m ? (m[1] ?? m[0]) : '{}';
  try {
    return JSON5.parse(extracted);
  } catch {
    return {};
  }
}

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
      Authorization: `Bearer ${apiKey}`,
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
  const obj = parseDeepSeekJson(data.choices?.[0]?.message?.content ?? '');
  const zh = typeof obj.zh === 'string' ? obj.zh.trim() : '';
  const en = typeof obj.en === 'string' ? obj.en.trim() : '';
  if (!zh && !en) throw new Error('模型未返回有效回答');
  return { zh: zh || en, en: en || zh };
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
  if (!DEEPSEEK_API_KEY || placeholders.some((p) => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: '请先在 Vercel 项目设置中配置 DEEPSEEK_API_KEY 环境变量',
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
    return res.status(200).json({ reply });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}
