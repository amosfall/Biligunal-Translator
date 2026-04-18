/**
 * AKI 解码结果为中文时，经 API 用模型修正同音错字与语序（本地拼音表无法覆盖所有语境）。
 */

/** 解码串是否值得送模型润色（含足够汉字，排除纯英文/符号） */
export function shouldRefineDecodedAkiText(s: string): boolean {
  const t = s.replace(/\r\n/g, "\n").trim();
  if (!t || t === "—") return false;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk >= 2;
}

export function buildRefineAkiZhPrompt(paragraphs: string[]): string {
  const n = paragraphs.length;
  return `以下文本由 AKI 动物码解码后，再经拼音规则还原为汉字；因音节表同音字固定映射，会出现大量错字（例如「辫子姑娘」被还原成「边字古娘」、「鬼」成「贵」）。请结合语境与常识逐段改回正确汉字，校园传说、地名、机构名等尤需核对。不要增删事实，不要加解释。

输出严格 JSON，唯一字段 "paragraphs"，值为字符串数组，长度必须为 ${n}，顺序与下方段落一致：
{ "paragraphs": ["修正后的第1段", "..."] }
若某段主要为英文或数字且无错误，可原样放入数组对应位置。

待处理段落：
${paragraphs.map((p, i) => `【第 ${i + 1} 段】\n${p}`).join("\n\n")}`.trim();
}

export function mergeRefinedParagraphs(original: string[], modelRaw: unknown): string[] {
  if (!Array.isArray(modelRaw)) return original;
  const arr = modelRaw as unknown[];
  return original.map((src, i) => {
    const v = arr[i];
    if (typeof v !== "string") return src;
    const t = v.trim();
    return t ? t : src;
  });
}
