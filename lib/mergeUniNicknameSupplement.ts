import { glossNicknameEn } from "./nicknameEnGloss";
import { USER_NICKNAME_SUPPLEMENT } from "./uniUserNicknameSupplement.generated";

type UniVariation = { zh: string; en: string };
type UniRow = { match: string; variations: UniVariation[]; matchAliases?: string[] };

function zhKey(v: UniVariation): string {
  return v.zh.trim();
}

/** 将用户提供的「校名 → 多行梗」合并进已有高校行；新校名则追加到列表末尾。 */
export function mergeUniversityNicknameSupplement(base: UniRow[]): UniRow[] {
  const byMatch = new Map<string, UniRow>();
  for (const row of base) {
    byMatch.set(row.match, { ...row, variations: [...row.variations] });
  }

  for (const [match, zhs] of Object.entries(USER_NICKNAME_SUPPLEMENT)) {
    const row = byMatch.get(match) ?? { match, variations: [] as UniVariation[] };
    const seen = new Set(row.variations.map(zhKey));
    for (const zh of zhs) {
      const t = zh.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      row.variations.push({ zh: t, en: glossNicknameEn(t) });
    }
    byMatch.set(match, row);
  }

  const out: UniRow[] = [];
  for (const row of base) {
    const merged = byMatch.get(row.match);
    out.push(merged ?? row);
  }

  const baseMatches = new Set(base.map((r) => r.match));
  const newKeys = [...byMatch.keys()]
    .filter((m) => !baseMatches.has(m))
    .sort((a, b) => a.localeCompare(b, "zh-Hans"));
  for (const m of newKeys) {
    const row = byMatch.get(m);
    if (row && row.variations.length > 0) out.push(row);
  }

  return out;
}
