/**
 * AKI 译文彩蛋：整段原文完全匹配时触发（trim 后比较，英文短语大小写不敏感）。
 * 输出：AKI 码（对官方校名编码）+ 中文梗 + 英文说明行（无标签）。高校多条梗时随机展示一条。
 */

import { UNIVERSITY_ROWS, type UniVariation } from "./uniEasterData";

export type AkiEasterKind = "hku" | "i_love_you" | "aki_name";

/** 匹配结果：旧版关键词或高校彩蛋 */
export type AkiEasterMatch =
  | { type: "legacy"; kind: AkiEasterKind }
  | { type: "uni"; official: string; variations: UniVariation[] };

/** 传给 encodeAki 的原文（决定第一行密文） */
type EasterTriple = {
  cipherSource: string;
  zh: string;
  en: string;
};

const EASTER_TRIPLE: Record<AkiEasterKind, EasterTriple> = {
  hku: {
    cipherSource: "HKU",
    zh: "AKI正在这里读大学，不要再排队了！",
    en: "AKI is studying here—don't want to queue any more!",
  },
  i_love_you: {
    cipherSource: "maki",
    zh: "maki",
    en: "maki",
  },
  aki_name: {
    cipherSource: "aki",
    zh: "祝你快乐",
    en: "Wish you happiness!",
  },
};

export function normalizeEasterInput(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").trim().replace(/\s+/g, " ");
  t = t.replace(/＋/g, "+");
  t = t.replace(/\s*\+\s*/g, " + ");
  return t;
}

/** 含非 ASCII（如中文）则精确匹配；纯英文触发词不区分大小写 */
function isAsciiOnly(s: string): boolean {
  return [...s].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c < 128;
  });
}

function uniRowMatchEquals(normalizedInput: string, matchKey: string): boolean {
  const b = normalizeEasterInput(matchKey);
  if (normalizedInput === b) return true;
  if (isAsciiOnly(normalizedInput) && isAsciiOnly(b)) {
    return normalizedInput.toLowerCase() === b.toLowerCase();
  }
  return false;
}

export function matchAkiEasterEggSource(raw: string): AkiEasterMatch | null {
  const t = normalizeEasterInput(raw);
  if (!t) return null;

  for (const row of UNIVERSITY_ROWS) {
    if (uniRowMatchEquals(t, row.match)) {
      return { type: "uni", official: row.match, variations: row.variations };
    }
  }

  const lower = t.toLowerCase();
  if (lower === "hku") return { type: "legacy", kind: "hku" };
  if (lower === "i love you" || t === "我爱你") return { type: "legacy", kind: "i_love_you" };
  if (lower === "aki") return { type: "legacy", kind: "aki_name" };
  return null;
}

function formatTripleLanguageEgg(
  triple: EasterTriple,
  deps: { encodeAki: (text: string) => string; wrapAkiDisplay: (body: string) => string }
): string {
  const raw = deps.encodeAki(triple.cipherSource);
  const code = deps.wrapAkiDisplay(raw) || "—";
  const zh = triple.zh.trim();
  const en = triple.en.trim();
  if (zh === en) {
    return [code, "", zh].join("\n");
  }
  return [code, "", zh, "", en].join("\n");
}

function pickRandomVariation(vars: UniVariation[]): UniVariation {
  return vars[Math.floor(Math.random() * vars.length)]!;
}

function buildUniversityEgg(
  official: string,
  variations: UniVariation[],
  deps: { encodeAki: (text: string) => string; wrapAkiDisplay: (body: string) => string }
): string {
  const v = pickRandomVariation(variations);
  /** 密文对「校名」编码；下方中英文为彩蛋梗，与密文语义不必一致 */
  return formatTripleLanguageEgg({ cipherSource: official, zh: v.zh, en: v.en }, deps);
}

export function buildAkiEasterEgg(
  match: AkiEasterMatch,
  deps: { encodeAki: (text: string) => string; wrapAkiDisplay: (body: string) => string }
): string {
  if (match.type === "legacy") {
    return formatTripleLanguageEgg(EASTER_TRIPLE[match.kind], deps);
  }
  return buildUniversityEgg(match.official, match.variations, deps);
}
