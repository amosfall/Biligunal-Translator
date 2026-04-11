/**
 * 将 Neon `translations` 表里旧 `username`（例如本地登录时填的 Aki）
 * 批量改为新 Clerk 账号的 User ID（user_ 开头），便于「Aki」→「Aki虾」Clerk 帐号继承云端历史。
 *
 * 用法（在 bilingual-editorial 目录）：
 *   MERGE_TO_CLERK_USER_ID=user_xxxxxxxx npm run merge-history
 * 若旧名不是 Aki：
 *   MERGE_FROM_USERNAME=旧名字 MERGE_TO_CLERK_USER_ID=user_xxx npm run merge-history
 *
 * Clerk User ID：Dashboard → Users → 点开「Aki虾」→ 侧栏或详情里的 User ID。
 */

import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const fromUser = (process.env.MERGE_FROM_USERNAME || 'Aki').trim();
const toUser = (process.env.MERGE_TO_CLERK_USER_ID || '').trim();

async function main() {
  if (!DATABASE_URL) {
    console.error('缺少 DATABASE_URL，请在 .env.local 中配置。');
    process.exit(1);
  }
  if (!toUser) {
    console.error(
      '请设置环境变量 MERGE_TO_CLERK_USER_ID=<新 Clerk 的 User ID>\n' +
        '示例：MERGE_TO_CLERK_USER_ID=user_2abc... npm run merge-history'
    );
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  const rows = await sql`
    SELECT COUNT(*)::int AS c FROM translations WHERE username = ${fromUser}
  `;
  const n = Number((rows[0] as { c: number }).c ?? 0);

  console.log(`找到 username = "${fromUser}" 的记录：${n} 条`);
  console.log(`将更新为 Clerk user id: ${toUser}`);

  if (n === 0) {
    console.log('无数据可更新。若旧用户名不同，请设置 MERGE_FROM_USERNAME。');
    return;
  }

  await sql`
    UPDATE translations SET username = ${toUser} WHERE username = ${fromUser}
  `;

  console.log('更新完成。请用「Aki虾」的 Clerk 账号登录，并开启云端历史后刷新。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
