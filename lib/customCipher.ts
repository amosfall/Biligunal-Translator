/**
 * AKI码 — 本站专属可爱动物编码，只有本站能解码。
 * - 英文字母：映射到动物 emoji
 * - 中文字符：先转拼音，再映射到动物 emoji，用 🌸 包围标记拼音边界
 * - 数字/标点：映射到特殊符号
 */

import { pinyin } from "pinyin-pro";
import { applyBracketPinyinToHanzi } from "./akiPinyinToZh";
const CHAR_TO_AKI: Record<string, string> = {
  a: "🐥", b: "🐻", c: "🐱", d: "🐶", e: "🐘", f: "🦊",
  g: "🐸", h: "🐹", i: "🦔", j: "🐙", k: "🦘", l: "🦁",
  m: "🐒", n: "🐝", o: "🦉", p: "🐼", q: "🦄", r: "🐰",
  s: "🐢", t: "🐯", u: "🦌", v: "🦋", w: "🐳", x: "🐿️",
  y: "🐑", z: "🦓",
  "0": "⓪", "1": "①", "2": "②", "3": "③", "4": "④",
  "5": "⑤", "6": "⑥", "7": "⑦", "8": "⑧", "9": "⑨",
  ".": "🔸", ",": "🔹", "?": "❓", "!": "❗",
  "'": "💫", '"': "✨", ":": "🔅", ";": "🔆",
  "-": "➰", "(": "🌙", ")": "🌟",
};

/** 中文标点 → emoji */
const CJK_PUNCT_MAP: Record<string, string> = {
  "\u3002": "🔸", "\uff0c": "🔹", "\uff1f": "❓", "\uff01": "❗",
  "\u2018": "💫", "\u2019": "💫", "\u201c": "✨", "\u201d": "✨",
  "\uff1a": "🔅", "\uff1b": "🔆", "\u3001": "🔹",
  "\uff08": "🌙", "\uff09": "🌟",
};

/** 展示/导出时在密文前附加的标签 */
export const AKI_DISPLAY_PREFIX = "【aki码】";

/** 复制 AKI 译文时在剪贴板末尾附加的网站根地址 */
export const AKI_SITE_URL = "https://translator.poeticsongs.site";

/** 将编码后的密文包上展示前缀（空则返回空串） */
export function wrapAkiDisplay(encodedBody: string): string {
  const t = encodedBody.replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  return `${AKI_DISPLAY_PREFIX}${t}`;
}

/** 同次翻译中仅第一段密文带「【aki码】」，避免每段重复 */
export function wrapAkiDisplayIfFirst(encodedBody: string, isFirstParagraph: boolean): string {
  const t = encodedBody.replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  return isFirstParagraph ? `${AKI_DISPLAY_PREFIX}${t}` : t;
}

/** 解码或识别输入时去掉展示前缀 */
export function stripAkiDisplayPrefix(text: string): string {
  return text.replace(/^\s*【aki码】\s*/u, "").trimStart();
}

/**
 * 去掉整行仅为分隔符的内容（常见于复制时夹带「—」），否则会打断密文扫描与解码。
 */
function normalizeAkiPasteLines(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (t.length === 0) return true;
      return !/^[—–\-‐‑‒―·•‧…=*＊]+$/.test(t);
    })
    .join("\n");
}

/** 粘贴/导入 AKI 密文前的统一清洗：去前缀、去仅分隔符行 */
export function prepareAkiImportText(raw: string): string {
  let s = stripAkiDisplayPrefix(raw.replace(/\r\n/g, "\n")).trim();
  s = normalizeAkiPasteLines(s);
  return s.trim();
}

/**
 * 从一段译文栏正文中只取 AKI 密文（含「【aki码】」若存在）。
 * 彩蛋等多行时，密文为第一个空行之前的块，其后的中文/英文说明不会包含。
 */
export function extractAkiCipherFromTranslatedParagraph(block: string): string {
  const t = block.replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  return t.split(/\n\n+/)[0]?.trim() ?? "";
}

/**
 * 粘贴的 AKI 栏：首段为密文（至第一个空行块），其后为彩蛋中文/英文等；解码时只应对密文段调用 decodeAki。
 */
export function splitAkiPasteIntoCipherAndEgg(block: string): { cipherBlock: string; eggTail: string } {
  const t = block.replace(/\r\n/g, "\n").trim();
  if (!t) return { cipherBlock: "", eggTail: "" };
  const parts = t.split(/\n\n+/);
  const cipherBlock = parts[0]?.trim() ?? "";
  const eggTail = parts.slice(1).join("\n\n").trim();
  return { cipherBlock, eggTail };
}

/** 单词间分隔符 */
const WORD_SEP = "🐾";
/** 汉字拼音包围标记 — 🌸拼音emoji🌸 */
const PINYIN_SEP = "🌸";

// 反向映射表
const AKI_TO_CHAR: Record<string, string> = {};
for (const [ch, sym] of Object.entries(CHAR_TO_AKI)) {
  AKI_TO_CHAR[sym] = ch;
}
/** 部分系统复制动物 emoji 时不带 U+FE0F，与表内键不一致会导致无法识别 */
for (const key of Object.keys(AKI_TO_CHAR)) {
  const bare = key.replace(/\uFE0F/g, "");
  if (bare !== key && !(bare in AKI_TO_CHAR)) AKI_TO_CHAR[bare] = AKI_TO_CHAR[key]!;
}

const isCJK = (code: number): boolean =>
  (code >= 0x4e00 && code <= 0x9fff) ||
  (code >= 0x3400 && code <= 0x4dbf) ||
  (code >= 0x20000 && code <= 0x2a6df);

function encodeLetters(letters: string): string {
  return [...letters].map(ch => CHAR_TO_AKI[ch] ?? "").join("");
}

/** pinyin-pro 对「女」等返回 ü；编码表仅有 a-z，统一为键盘式 v，否则 ü 会被丢弃导致解码出现 [n]。 */
function normalizePinyinForAkiEncoding(py: string): string {
  return py.replace(/ü/g, "v");
}

export function encodeAki(text: string): string {
  const s = text.replace(/\r\n/g, "\n").trim();
  if (!s) return "";

  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (const word of words) {
    const parts: string[] = [];

    for (const ch of word) {
      const lower = ch.toLowerCase();
      if (CHAR_TO_AKI[lower]) {
        parts.push(CHAR_TO_AKI[lower]);
        continue;
      }
      const code = ch.codePointAt(0)!;
      if (isCJK(code)) {
        const py = normalizePinyinForAkiEncoding(
          pinyin(ch, { toneType: "none", type: "string" }).toLowerCase()
        );
        const encoded = encodeLetters(py);
        if (encoded) parts.push(PINYIN_SEP + encoded + PINYIN_SEP);
        continue;
      }
      if (CJK_PUNCT_MAP[ch]) {
        parts.push(CJK_PUNCT_MAP[ch]);
      }
    }

    if (parts.length > 0) out.push(parts.join(""));
  }

  return out.join(` ${WORD_SEP} `);
}

export function decodeAki(cipher: string): string {
  const s = prepareAkiImportText(cipher);
  if (!s) return "";

  const words = s.split(` ${WORD_SEP} `);
  const out: string[] = [];

  for (const word of words) {
    const chars: string[] = [];
    let i = 0;
    const arr = [...word];
    let inPinyin = false;
    let pinyinBuf = "";

    while (i < arr.length) {
      // 🌸 切换拼音模式
      if (arr[i] === "🌸") {
        if (inPinyin) {
          // 结束一个拼音组
          if (pinyinBuf) chars.push(`[${pinyinBuf}]`);
          pinyinBuf = "";
          inPinyin = false;
        } else {
          inPinyin = true;
          pinyinBuf = "";
        }
        i++;
        continue;
      }

      // 尝试匹配 emoji（贪心，最长 3 code points）
      let matched = false;
      for (let len = 3; len >= 1; len--) {
        if (i + len <= arr.length) {
          const candidate = arr.slice(i, i + len).join("");
          const ch = AKI_TO_CHAR[candidate];
          if (ch) {
            if (inPinyin) {
              pinyinBuf += ch;
            } else {
              chars.push(ch);
            }
            i += len;
            matched = true;
            break;
          }
        }
      }

      if (!matched) i++;
    }

    // 如果拼音模式没关闭，刷出剩余
    if (pinyinBuf) chars.push(`[${pinyinBuf}]`);

    if (chars.length > 0) out.push(chars.join(""));
  }

  return applyBracketPinyinToHanzi(out.join(" "));
}

/** 与 encode 的 `join` 一致：空格 + 🐾 + 空格 */
const AKI_INTER_WORD = ` ${WORD_SEP} `;

/**
 * 按 decodeAki 的规则扫描密文，统计成功映射的单元数与无法识别的字符数。
 * 空白字符在单词内忽略（便于用户复制时夹带空格）。
 */
function akiCipherScanMetrics(s: string): { decodableUnits: number; unknown: number } {
  const words = s.split(AKI_INTER_WORD);
  let decodableUnits = 0;
  let unknown = 0;

  for (const word of words) {
    const arr = [...word];
    let i = 0;

    while (i < arr.length) {
      if (arr[i] === "🌸") {
        i++;
        continue;
      }
      if (/\s/u.test(arr[i])) {
        i++;
        continue;
      }

      let matched = false;
      for (let len = 3; len >= 1; len--) {
        if (i + len <= arr.length) {
          const candidate = arr.slice(i, i + len).join("");
          if (AKI_TO_CHAR[candidate]) {
            decodableUnits++;
            i += len;
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        unknown++;
        i++;
      }
    }
  }

  return { decodableUnits, unknown };
}

/**
 * Import 粘贴时判断是否为 AKI 密文。
 * 单词内连续字母不会产生 🐾，旧逻辑强依赖 🐾 会导致「happy」等无法识别。
 */
export function isProbablyAkiCipher(raw: string): boolean {
  const s = prepareAkiImportText(raw);
  if (!s) return false;

  const { decodableUnits, unknown } = akiCipherScanMetrics(s);
  return unknown === 0 && decodableUnits >= 1;
}

