/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** 与 CLERK_ADMIN_USER_IDS 一致，逗号分隔 Clerk User ID，用于侧栏列出全部历史 */
  readonly VITE_CLERK_ADMIN_USER_IDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
