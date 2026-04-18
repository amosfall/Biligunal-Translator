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
    zh: "AKI正在这里读大学，不要再排队了！毕竟你是QS亚洲第一☝️",
    en: "AKI is studying here—don't want to queue any more! After all, you're QS Asia #1 ☝️",
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

/** 中央戏剧学院：校名、专业名、校名+专业（见 uniEasterData.matchAliases）均触发同一彩蛋 */
function matchesZhongXiEasterInput(normalizedInput: string): boolean {
  const zxRow = UNIVERSITY_ROWS.find((r) => r.match === "中央戏剧学院");
  if (!zxRow) return false;
  const keys = [zxRow.match, ...(zxRow.matchAliases ?? [])];
  return keys.some((k) => uniRowMatchEquals(normalizedInput, k));
}

/** 是否与 legacy HKU 彩蛋同键（hku / 香港大学），用于「首次静态、再次走动态梗」 */
/** 英文爱情触发词：i love you / i love u 等同；已 normalize + toLowerCase */
function matchesLegacyILoveYouPhrase(lower: string, tNormalized: string): boolean {
  if (tNormalized === "我爱你") return true;
  return lower === "i love you" || lower === "i love u";
}

/** 与 i_love_you 彩蛋同键：整段为 maki（大小写不敏感，即 maki=MAKI） */
function matchesLegacyMakiKeyword(lower: string): boolean {
  return lower === "maki";
}

/** 与 aki_name 彩蛋同键：整段为 aki（大小写不敏感，即 aki=AKI） */
function matchesLegacyAkiNameKeyword(lower: string): boolean {
  return lower === "aki";
}

export function isLegacyHkuInput(raw: string): boolean {
  const t = normalizeEasterInput(raw);
  if (!t) return false;
  const lower = t.toLowerCase();
  return lower === "hku" || t === "香港大学";
}

/** 与明治大学静态彩蛋同键（整段为「明治大学」），用于「首次静态、同文档或会话内再次则走动态梗」 */
export function isLegacyMeijiInput(raw: string): boolean {
  const t = normalizeEasterInput(raw);
  if (!t) return false;
  return uniRowMatchEquals(t, "明治大学");
}

/** 与中央戏剧学院静态彩蛋同键（校名 / 专业 / 校名+专业，见 matchAliases），策略同明治 / HKU */
export function isLegacyZhongXiInput(raw: string): boolean {
  const t = normalizeEasterInput(raw);
  if (!t) return false;
  return matchesZhongXiEasterInput(t);
}

export function matchAkiEasterEggSource(
  raw: string,
  options?: { skipLegacyHku?: boolean; skipLegacyMeiji?: boolean; skipLegacyZhongXi?: boolean }
): AkiEasterMatch | null {
  const t = normalizeEasterInput(raw);
  if (!t) return null;

  const lower = t.toLowerCase();
  /** 与 HKU 同彩蛋：英文缩写或「香港大学」整段匹配；skipLegacyHku 时改走与其他高校相同的动态生成 */
  if (!options?.skipLegacyHku && (lower === "hku" || t === "香港大学")) {
    return { type: "legacy", kind: "hku" };
  }
  if (matchesLegacyILoveYouPhrase(lower, t) || matchesLegacyMakiKeyword(lower)) {
    return { type: "legacy", kind: "i_love_you" };
  }
  if (matchesLegacyAkiNameKeyword(lower)) {
    return { type: "legacy", kind: "aki_name" };
  }

  /** 明治大学：与 HKU 相同，skipLegacyMeiji 时改走与其他高校相同的动态生成 */
  if (!options?.skipLegacyMeiji) {
    const meijiRow = UNIVERSITY_ROWS.find((r) => r.match === "明治大学");
    if (meijiRow && uniRowMatchEquals(t, "明治大学")) {
      return { type: "uni", official: meijiRow.match, variations: meijiRow.variations };
    }
  }

  /** 中央戏剧学院：校名、专业、校名+专业均可触发 */
  if (!options?.skipLegacyZhongXi) {
    const zxRow = UNIVERSITY_ROWS.find((r) => r.match === "中央戏剧学院");
    if (zxRow && matchesZhongXiEasterInput(t)) {
      return { type: "uni", official: zxRow.match, variations: zxRow.variations };
    }
  }

  return null;
}

/** 第一行 AKI 密文 + 空行 + 中文 + 空行 + 英文（彩蛋与动态梗共用） */
export function formatTripleLanguageEgg(
  triple: { cipherSource: string; zh: string; en: string },
  deps: {
    encodeAki: (text: string) => string;
    /** 对已编码密文行加展示包装（如 `wrapAkiDisplay` 或按段落索引的 `wrapAkiDisplayIfFirst`） */
    wrapCipherLine: (encodedBody: string) => string;
  }
): string {
  const raw = deps.encodeAki(triple.cipherSource);
  const code = deps.wrapCipherLine(raw) || "—";
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
  deps: { encodeAki: (text: string) => string; wrapCipherLine: (body: string) => string }
): string {
  const v = pickRandomVariation(variations);
  /** 密文对「校名」编码；下方中英文为彩蛋梗，与密文语义不必一致 */
  return formatTripleLanguageEgg({ cipherSource: official, zh: v.zh, en: v.en }, deps);
}

/** 首次静态、再次输入可走动态梗的键：HKU、明治大学、中央戏剧学院 */
export const AKI_SECOND_INPUT_HINT = "（再输一次获取新答案）";

function matchUsesFirstStaticThenDynamicHint(m: AkiEasterMatch): boolean {
  if (m.type === "legacy" && m.kind === "hku") return true;
  if (m.type === "uni" && (m.official === "明治大学" || m.official === "中央戏剧学院")) return true;
  return false;
}

export function buildAkiEasterEgg(
  match: AkiEasterMatch,
  deps: { encodeAki: (text: string) => string; wrapCipherLine: (body: string) => string }
): string {
  let body: string;
  if (match.type === "legacy") {
    body = formatTripleLanguageEgg(EASTER_TRIPLE[match.kind], deps);
  } else {
    body = buildUniversityEgg(match.official, match.variations, deps);
  }
  if (matchUsesFirstStaticThenDynamicHint(match)) {
    return `${body}\n\n${AKI_SECOND_INPUT_HINT}`;
  }
  return body;
}
