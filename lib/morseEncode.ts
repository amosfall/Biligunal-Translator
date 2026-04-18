/**
 * ITU 国际摩斯电码（拉丁字母、数字与常用标点），单词间用「 / 」分隔。
 * 仅对可映射字符编码；无法映射的字符跳过。
 */
const CHAR_TO_MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "'": ".----.",
  "!": "-.-.--",
  "/": "-..-.",
  "(": "-.--.",
  ")": "-.--.-",
  "&": ".-...",
  ":": "---...",
  ";": "-.-.-.",
  "=": "-...-",
  "+": ".-.-.",
  "-": "-....-",
  _: "..--.-",
  '"': ".-..-.",
  $: "...-..-",
  "@": ".--.-.",
};

export function encodeInternationalMorse(text: string): string {
  const s = text.replace(/\r\n/g, "\n").trim();
  if (!s) return "";

  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];

  for (const word of words) {
    const parts: string[] = [];
    for (const ch of word.toUpperCase()) {
      const code = CHAR_TO_MORSE[ch];
      if (code) parts.push(code);
    }
    if (parts.length > 0) out.push(parts.join(" "));
  }

  return out.join(" / ");
}

/** 将「右栏为英文」的段落对转为右栏摩斯码；若无法编码则置为「—」（避免回退成中文） */
export function applyMorseEncodingToPairs(pairs: { en: string; zh: string }[]): { en: string; zh: string }[] {
  return pairs.map((p) => {
    const morse = encodeInternationalMorse(p.zh);
    return { en: p.en, zh: morse !== "" ? morse : "—" };
  });
}
