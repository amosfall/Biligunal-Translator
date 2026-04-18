import JSON5 from "json5";
import { buildAkiMemePrompt } from "./akiMemePrompt.js";

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

/**
 * 调用 DeepSeek：仅当 eligible 为 true 时返回梗；否则返回 null（调用方仅展示密文）。
 */
export async function fetchAkiMemePairDeepseek(
  text: string,
  apiKey: string
): Promise<{ zh: string; en: string } | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const prompt = buildAkiMemePrompt(trimmed);

  let data: unknown;
  try {
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
              'Valid JSON only: eligible, zh, en. When eligible true: zh ~100 Chinese chars (90–110), roast tone; topics include uni/geo/music/literature/film/photo/ACG when user phrase names them; en: ~2 sentences matching zh tone.',
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1024,
      }),
    });

    if (!response.ok) return null;
    data = await response.json();
  } catch {
    return null;
  }

  const json = parseDeepSeekJson(
    (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? ""
  );

  const eligibleRaw = json.eligible;
  /** 仅显式拒绝；模型常漏写 eligible 字段，若仍要求 eligible===true 会把合法梗全部丢弃 */
  const eligibleFalse =
    eligibleRaw === false ||
    eligibleRaw === "false" ||
    String(eligibleRaw ?? "").toLowerCase() === "false";
  if (eligibleFalse) return null;

  const zh = String(json.zh ?? "")
    .trim()
    .slice(0, 280);
  const en = String(json.en ?? "")
    .trim()
    .slice(0, 400);

  if (!zh) return null;

  return { zh, en };
}
