/**
 * AKI 译文栏：静态白名单彩蛋 + 动态 LLM 梗；密文始终对「该段原文」encodeAki。
 */

import {
  buildAkiEasterEgg,
  formatTripleLanguageEgg,
  isLegacyHkuInput,
  matchAkiEasterEggSource,
} from "./akiEasterEggs";
import { encodeAki, wrapAkiDisplay, wrapAkiDisplayIfFirst } from "./customCipher";

export async function buildAkiTranslatedColumnAsync(
  sourceParagraph: string,
  paragraphIndex: number,
  fetchMeme: (text: string) => Promise<{ zh: string; en: string } | null>,
  options?: { skipLegacyHku?: boolean }
): Promise<string> {
  const egg = matchAkiEasterEggSource(sourceParagraph, options);
  if (egg !== null) {
    return buildAkiEasterEgg(egg, { encodeAki, wrapCipherLine: wrapAkiDisplay });
  }

  let meme: { zh: string; en: string } | null = null;
  try {
    meme = await fetchMeme(sourceParagraph);
  } catch {
    meme = null;
  }

  const raw = encodeAki(sourceParagraph);
  const cipherOnly = wrapAkiDisplayIfFirst(raw, paragraphIndex === 0);
  if (!meme?.zh?.trim()) {
    return cipherOnly !== "" ? cipherOnly : "—";
  }

  return formatTripleLanguageEgg(
    { cipherSource: sourceParagraph, zh: meme.zh, en: meme.en },
    {
      encodeAki,
      wrapCipherLine: (body) => wrapAkiDisplayIfFirst(body, paragraphIndex === 0),
    }
  );
}

export async function applyAkiEncodingToPairsAsync(
  pairs: { en: string; zh: string }[],
  layout: "to_cjk" | "to_en" = "to_cjk",
  fetchMeme: (text: string) => Promise<{ zh: string; en: string } | null>
): Promise<{ en: string; zh: string }[]> {
  const out: { en: string; zh: string }[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    const sourceText = layout === "to_cjk" ? p.en : p.zh;
    let priorHku = 0;
    for (let j = 0; j < i; j++) {
      const prev = pairs[j]!;
      const prevSource = layout === "to_cjk" ? prev.en : prev.zh;
      if (isLegacyHkuInput(prevSource)) priorHku++;
    }
    const skipLegacyHku = isLegacyHkuInput(sourceText) && priorHku >= 1;
    const zhCol = await buildAkiTranslatedColumnAsync(sourceText, i, fetchMeme, { skipLegacyHku });
    out.push({ en: p.en, zh: zhCol });
  }
  return out;
}
