import type { VercelRequest, VercelResponse } from '@vercel/node';
import JSON5 from 'json5';

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
    if (!isAuthorLine && (enShort || zhShort)) {
      result.title = { en: firstLineEn, zh: firstLineZh };
    }
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

  try {
    const { paragraphs } = (req.body || {}) as { paragraphs?: string[] };
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    const prompt = `你是一个专业的中英双语文学编辑。

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

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
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
      return res.status(500).json({ error: userMsg, detail: text.slice(0, 500) });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content ?? '';

    /** 修复 LLM 常见 JSON 格式问题（如数组/对象尾逗号） */
    const sanitizeJson = (s: string) => s.replace(/,(\s*[\]}])/g, '$1');

    let json: { translation?: unknown[]; title?: { en: string; zh: string }; author?: { en: string; zh: string } };
    try {
      json = JSON.parse(content || '{}');
    } catch (parseErr) {
      try {
        json = JSON.parse(sanitizeJson(content));
      } catch {
        try {
          json = JSON5.parse(content);
        } catch {
          const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
          const extracted = m ? (m[1] ?? m[0]) : '{}';
          try { json = JSON5.parse(extracted); } catch { json = {}; }
        }
      }
    }
    if (!Array.isArray(json?.translation)) {
      return res.status(500).json({ error: '模型返回格式异常，请重试' });
    }
    if (!json.title) json.title = { en: '', zh: '' };
    if (!json.author) json.author = { en: '', zh: '' };

    const translation = mergeZhWithParagraphs(paragraphs, json.translation);
    const fallback = extractTitleAuthorFromTranslation(translation);
    const isEmpty = (t: { en?: string; zh?: string }) => {
      const v = (t?.en?.trim() || t?.zh?.trim() || '').replace(/[—\-]/g, '');
      return !v;
    };
    if (isEmpty(json.title) && (fallback.title?.en || fallback.title?.zh)) {
      json.title = fallback.title;
    }
    if (isEmpty(json.author) && (fallback.author?.en || fallback.author?.zh)) {
      json.author = fallback.author;
    }

    return res.status(200).json({ ...json, translation });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}
