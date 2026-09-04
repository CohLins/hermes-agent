import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5273,
    // 阶段二接入真实后端时打开：页面里的请求统一走 /api 前缀。
    // proxy: {
    //   "/api": {
    //     target: process.env.CAMPAIGN_AI_API ?? "http://127.0.0.1:8080",
    //     changeOrigin: true,
    //   },
    // },
  },
});
