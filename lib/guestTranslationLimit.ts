/** 访客未登录时可完整完成的翻译次数；达到后需登录才能继续 */
export const GUEST_FREE_TRANSLATION_COUNT = 2;

export const GUEST_TRANSLATION_LIMIT_MESSAGE =
  "免费试用次数已用完（访客可完整使用 2 次翻译）。请通过右上角登录，或在本站输入本地用户名后再试。";

const STORAGE_KEY = "guest-translation-success-count";

export function getGuestTranslationSuccessCount(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function incrementGuestTranslationSuccessIfVisitor(isLoggedIn: boolean): void {
  if (isLoggedIn) return;
  try {
    const n = getGuestTranslationSuccessCount() + 1;
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch {
    /* quota / privacy mode */
  }
}

/** 已成功次数已达免费额度，下一次应要求登录 */
export function isGuestTranslationQuotaExceeded(isLoggedIn: boolean): boolean {
  if (isLoggedIn) return false;
  return getGuestTranslationSuccessCount() >= GUEST_FREE_TRANSLATION_COUNT;
}
