<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3ea876de-ced9-4b8d-ab51-350aa19e481a

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   ```bash
   npm install
   ```
2. **必须**在 `bilingual-editorial` 目录下创建 `.env.local`，填入 DeepSeek API Key：
   ```bash
   cd bilingual-editorial
   cp .env.example .env.local
   # 编辑 .env.local，将 DEEPSEEK_API_KEY 改为你在 https://platform.deepseek.com 获取的真实密钥
   ```
3. Start both backend and frontend (recommended: one command):
   ```bash
   npm start
   ```
   Or use two terminals: `npm run server` and `npm run dev`.
4. Open http://localhost:3000 and upload a `.docx` file.

## 部署到 Vercel

1. 将本仓库推送到 GitHub。
2. 在 [Vercel](https://vercel.com) 中 **Import Project**，选择该仓库。
3. 配置环境变量：在 **Settings → Environment Variables** 中添加 `DEEPSEEK_API_KEY`，值从 `.env.local` 复制。
4. 构建设置（通常可自动识别）：
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. 点击 Deploy，完成后在手机/平板访问部署域名即可使用。

> 若 GitHub 仓库根目录是上一级（如 `Translator Project`），在 Vercel 导入时需将 **Root Directory** 设为 `bilingual-editorial`。
