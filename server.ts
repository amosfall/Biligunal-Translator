import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

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

输出必须是严格的 JSON，结构如下（不要多余文字）：
{
  "title": { "en": "英文标题", "zh": "中文标题" },
  "author": { "en": "英文作者名", "zh": "中文作者名" },
  "translation": [
    { "en": "原英文段落1", "zh": "对应的中文翻译1" },
    ...
  ],
  "analysis": {
    "summary": "一句话中文概括",
    "narrativeDetail": "200-300字中文叙事分析，关注结构、手法与节奏。",
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
      return res.status(500).json({ error: userMsg, detail: text.slice(0, 500) });
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content ?? '';
    let json: { translation?: unknown[]; analysis?: unknown };
    try {
      json = JSON.parse(content || '{}');
    } catch {
      const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
      json = m ? JSON.parse(m[1] ?? m[0]) : {};
    }
    if (!Array.isArray(json?.translation)) {
      return res.status(500).json({ error: '模型返回格式异常，请重试' });
    }
    if (!json.title) json.title = { en: '', zh: '' };
    if (!json.author) json.author = { en: '', zh: '' };

    // 规则兜底：若模型未提取到标题/作者，从前几段译文中用正则提取
    const fallback = extractTitleAuthorFromTranslation(json.translation as { en: string; zh: string }[]);
    const isEmpty = (t: { en?: string; zh?: string }) => {
      const v = (t?.en?.trim() || t?.zh?.trim() || '').replace(/[—\-]/g, '');
      return !v;
    };
    if (isEmpty(json.title as object) && (fallback.title?.en || fallback.title?.zh)) {
      json.title = fallback.title;
    }
    if (isEmpty(json.author as object) && (fallback.author?.en || fallback.author?.zh)) {
      json.author = fallback.author;
    }

    return res.json(json);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    console.error(err);
    return res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  const raw = (process.env.DEEPSEEK_API_KEY || '').trim();
  const hasKey = raw && !['YOUR_DEEPSEEK_API_KEY', '你的DeepSeek密钥', '你的密钥'].some(p => raw.includes(p));
  console.log(`Translator API running at http://localhost:${PORT}`);
  if (!hasKey) {
    console.warn('⚠️  DEEPSEEK_API_KEY 未配置，翻译请求将失败。请创建 bilingual-editorial/.env.local 并填写密钥。');
  }
});
