/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** 与 CLERK_ADMIN_USER_IDS 一致，逗号分隔 Clerk User ID，用于侧栏列出全部历史 */
  readonly VITE_CLERK_ADMIN_USER_IDS?: string;
  /**
   * 可选：AKI 动态梗接口完整 URL（如静态站托管时 API 在另一域名）。
   * 例：https://你的项目.vercel.app/api/aki-meme
   * 未设置时使用同源的 /api/aki-meme（需部署含 serverless 的站点并配置 DEEPSEEK_API_KEY）。
   */
  readonly VITE_AKI_MEME_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
