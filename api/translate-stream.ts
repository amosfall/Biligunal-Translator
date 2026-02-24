import type { VercelRequest, VercelResponse } from '@vercel/node';
import JSON5 from 'json5';

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

function mergeZhWithParagraphs(paragraphs: string[], raw: unknown[]): { en: string; zh: string }[] {
  return paragraphs.map((en, i) => {
    const v = raw[i];
    if (typeof v === 'string') return { en, zh: v };
    if (v && typeof v === 'object' && 'zh' in (v as object)) return { en, zh: String((v as { zh?: string }).zh ?? '') };
    if (v && typeof v === 'object' && 'en' in (v as object)) return { en: String((v as { en?: string }).en ?? en), zh: String((v as { zh?: string }).zh ?? '') };
    return { en, zh: '' };
  });
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
    const { paragraphs } = (req.body || {}) as { paragraphs?: string[] };
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === 'function') {
      (res as unknown as { flushHeaders: () => void }).flushHeaders();
    }

    const chunks = splitIntoChunks(paragraphs, CHUNK_SIZE);
    const total = chunks.length;
    const allTranslations: { en: string; zh: string }[] = [];
    let firstJson: Record<string, unknown> = { title: { en: '', zh: '' }, author: { en: '', zh: '' }, analysis: null };

    write({ type: 'progress', chunk: 0, total, percent: 0, step: `准备翻译共 ${total} 段...` });

    const fj = await callDeepSeek(buildFullPrompt(chunks[0]), DEEPSEEK_API_KEY);
    if (!Array.isArray(fj?.translation)) {
      write({ type: 'error', message: '模型返回格式异常，请重试' });
      return res.end();
    }
    firstJson = fj;
    allTranslations.push(...mergeZhWithParagraphs(chunks[0], fj.translation as unknown[]));
    write({ type: 'progress', chunk: 1, total, percent: Math.round((1 / total) * 100), step: `翻译第 1/${total} 段` });

    for (let i = 1; i < chunks.length; i++) {
      const chunkJson = await callDeepSeek(buildTranslationOnlyPrompt(chunks[i]), DEEPSEEK_API_KEY);
      if (Array.isArray(chunkJson?.translation)) {
        allTranslations.push(...mergeZhWithParagraphs(chunks[i], chunkJson.translation as unknown[]));
      }
      const pct = Math.round(((i + 1) / total) * 100);
      write({ type: 'progress', chunk: i + 1, total, percent: pct, step: `翻译第 ${i + 1}/${total} 段` });
    }

    if (!firstJson.title) firstJson.title = { en: '', zh: '' };
    if (!firstJson.author) firstJson.author = { en: '', zh: '' };

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

    write({ type: 'done', result: { ...firstJson, translation: allTranslations } });
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    write({ type: 'error', message: msg });
    res.end();
  }
}
