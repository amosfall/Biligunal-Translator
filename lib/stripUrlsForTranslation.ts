/**
 * 翻译 / AKI 解码前移除 http(s) 网址。
 * 从本站复制 AKI 时会在末尾附带站点链接，粘贴进输入框时不应参与解码或送模型。
 */
export function stripUrlsForTranslation(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  t = t.replace(/https?:\/\/\S+/gi, "");
  t = t
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return t.trim();
}
