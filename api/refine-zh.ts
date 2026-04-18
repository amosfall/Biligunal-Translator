import type { VercelRequest, VercelResponse } from "@vercel/node";
import JSON5 from "json5";
import { buildRefineAkiZhPrompt, mergeRefinedParagraphs } from "../lib/refineAkiZh.js";

const sanitizeJson = (s: string) => s.replace(/,(\s*[\]}])/g, "$1");

function parseDeepSeekJson(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content || "{}");
  } catch {}
  try {
    return JSON.parse(sanitizeJson(content));
  } catch {}
  try {
    return JSON5.parse(content);
  } catch {}
  const m = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/);
  const extracted = m ? (m[1] ?? m[0]) : "{}";
  try {
    return JSON5.parse(extracted);
  } catch {
    return {};
  }
}

async function callDeepSeek(prompt: string, apiKey: string): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "You are a professional Chinese editor. Always respond with valid JSON only. The user needs Simplified Chinese refinement.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8192,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let userMsg = "DeepSeek API 调用失败";
    try {
      const errJson = JSON.parse(text);
      const apiErr = errJson?.error?.message ?? errJson?.message ?? errJson?.error;
      if (apiErr) userMsg = typeof apiErr === "string" ? apiErr : String(apiErr);
      if (response.status === 401) userMsg = "API Key 无效或已过期，请在 Vercel 中检查 DEEPSEEK_API_KEY";
      else if (response.status === 429) userMsg = "请求过于频繁，请稍后再试";
    } catch {
      /* ignore */
    }
    throw new Error(userMsg);
  }

  const data = await response.json();
  return parseDeepSeekJson(data.choices?.[0]?.message?.content ?? "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
  const placeholders = ["YOUR_DEEPSEEK_API_KEY", "你的DeepSeek密钥", "你的密钥"];
  if (!DEEPSEEK_API_KEY || placeholders.some((p) => DEEPSEEK_API_KEY.includes(p))) {
    return res.status(503).json({
      error: "请先在 Vercel 项目设置中配置 DEEPSEEK_API_KEY 环境变量",
    });
  }

  try {
    const { paragraphs } = (req.body || {}) as { paragraphs?: string[] };
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
      return res.status(400).json({ error: "paragraphs is required" });
    }

    const prompt = buildRefineAkiZhPrompt(paragraphs.map((p) => String(p ?? "")));
    const json = await callDeepSeek(prompt, DEEPSEEK_API_KEY);
    const refined = mergeRefinedParagraphs(paragraphs, json.paragraphs);
    return res.status(200).json({ paragraphs: refined });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return res.status(500).json({ error: msg });
  }
}
