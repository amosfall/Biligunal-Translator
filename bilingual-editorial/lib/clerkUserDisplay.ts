/**
 * 将 Clerk user id（user_…）解析为可读展示名（username / 邮箱 / 姓名）。
 */

import { createClerkClient } from '@clerk/backend';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { label: string; t: number }>();

export function looksLikeClerkUserId(s: string): boolean {
  return s.startsWith('user_') && s.length >= 12;
}

function userDisplayName(u: {
  username: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  if (u.username?.trim()) return u.username.trim();
  const email = u.primaryEmailAddress?.emailAddress?.trim();
  if (email) return email;
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  return '';
}

/** 批量解析；非 Clerk id 原样返回；无 secret 时返回 id 本身 */
export async function resolveOwnerDisplayNames(
  usernames: (string | undefined)[],
  secretKey: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const sk = secretKey.trim();
  const unique = [...new Set(usernames.filter((u): u is string => !!u?.trim()))];
  if (unique.length === 0) return map;

  const now = Date.now();
  const toFetch: string[] = [];

  for (const id of unique) {
    if (!looksLikeClerkUserId(id)) {
      map.set(id, id);
      continue;
    }
    const hit = cache.get(id);
    if (hit && now - hit.t < CACHE_TTL_MS) {
      map.set(id, hit.label);
    } else {
      toFetch.push(id);
    }
  }

  if (!sk || toFetch.length === 0) {
    for (const id of toFetch) map.set(id, id);
    return map;
  }

  const clerk = createClerkClient({ secretKey: sk });
  await Promise.all(
    toFetch.map(async (id) => {
      try {
        const u = await clerk.users.getUser(id);
        const label = userDisplayName(u) || id;
        cache.set(id, { label, t: now });
        map.set(id, label);
      } catch {
        map.set(id, id);
      }
    })
  );

  return map;
}
