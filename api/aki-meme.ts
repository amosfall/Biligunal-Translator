import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchAkiMemePairDeepseek } from "../lib/akiMemeDeepseek.js";

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
    const { text } = (req.body || {}) as { text?: string };
    const pair = await fetchAkiMemePairDeepseek(String(text ?? ""), DEEPSEEK_API_KEY);
    if (!pair) {
      return res.status(200).json({ eligible: false, zh: "", en: "" });
    }
    return res.status(200).json({ eligible: true, zh: pair.zh, en: pair.en });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal error";
    return res.status(500).json({ error: msg });
  }
}
