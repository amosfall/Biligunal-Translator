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

function mergeTranslation(
  sourceParagraphs: string[],
  raw: unknown[],
  sourceLang: 'en' | 'zh'
): { en: string; zh: string }[] {
  return sourceParagraphs.map((src, i) => {
    const v = raw[i];
    let translated = '';
    if (typeof v === 'string') {
      translated = v;
    } else if (v && typeof v === 'object') {
      const key = sourceLang === 'zh' ? 'en' : 'zh';
      translated = String((v as Record<string, unknown>)[key] ?? '');
    }
    return sourceLang === 'zh'
      ? { en: translated, zh: src }
      : { en: src, zh: translated };
  });
}

function buildZhToEnPrompt(paragraphs: string[]): string {
  return `你是一个专业的中英双语文学编辑。

请你将下面的中文段落翻译为流畅的英文，并给出结构化的写作分析。
同时从正文中识别并提取文章标题和作者。

【字数上限】summary≤60字，narrativeDetail≤200字，其余每项≤40字

输出严格 JSON，translation 仅返回英文翻译数组，顺序与输入一一对应，不要回显中文。analysis 每字段均需提供 en 和 zh 两个版本。
{
  "title": { "en": "...", "zh": "..." },
  "author": { "en": "...", "zh": "..." },
  "translation": ["English 1", "English 2", "..."],
  "analysis": {
    "summary": { "en": "one-sentence summary (≤60 words)", "zh": "一句话概括（≤60字）" },
    "narrativeDetail": { "en": "narrative analysis (≤200 words)", "zh": "叙事分析（≤200字）" },
    "themes": [{ "en": "theme in English", "zh": "中文主题" }],
    "pros": [{ "en": "strength in English", "zh": "中文优点" }],
    "cons": [{ "en": "weakness in English", "zh": "中文不足" }]
  }
}

待翻译的中文段落：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();
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
    const { paragraphs, sourceLang = 'en' } = (req.body || {}) as { paragraphs?: string[]; sourceLang?: 'en' | 'zh' };
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: 'paragraphs is required' });
    }

    const enToZhPrompt = `你是一个专业的中英双语文学编辑。

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

输出必须是严格的 JSON，结构如下（不要多余文字）。translation 仅返回中文翻译数组，顺序与输入段落一一对应，不要回显英文。
【重要】analysis 为必填项，每个字段均需提供 en（英文）和 zh（中文）两个版本。
{
  "title": { "en": "英文标题", "zh": "中文标题" },
  "author": { "en": "英文作者名", "zh": "中文作者名" },
  "translation": ["中文翻译1", "中文翻译2", "..."],
  "analysis": {
    "summary": { "en": "one-sentence summary (≤60 words)", "zh": "一句话概括（≤60字）" },
    "narrativeDetail": { "en": "narrative analysis (≤200 words)", "zh": "叙事分析（≤200字）" },
    "themes": [{ "en": "theme in English", "zh": "中文主题" }],
    "pros": [{ "en": "strength in English", "zh": "中文优点" }],
    "cons": [{ "en": "weakness in English", "zh": "中文不足" }]
  }
}

待翻译的英文段落如下（保持顺序）：
${paragraphs.map((p, i) => `# Paragraph ${i + 1}\n${p}`).join('\n\n')}`.trim();

    const prompt = sourceLang === 'zh' ? buildZhToEnPrompt(paragraphs) : enToZhPrompt;

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

    let json: { translation?: unknown[]; title?: { en: string; zh: string }; author?: { en: string; zh: string }; analysis?: unknown };
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
    const translationRaw = normalizeTranslationToArray(json?.translation, paragraphs.length);
    if (translationRaw.length === 0) {
      return res.status(500).json({ error: '模型返回格式异常，请重试' });
    }
    if (!json.title) json.title = { en: '', zh: '' };
    if (!json.author) json.author = { en: '', zh: '' };

    const translation = mergeTranslation(paragraphs, translationRaw, sourceLang);
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

    const analysis = normalizeAnalysis(json.analysis);
    return res.status(200).json({ ...json, translation, analysis });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: msg });
  }
}
