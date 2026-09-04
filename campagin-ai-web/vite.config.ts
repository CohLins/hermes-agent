import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * 从 hermes profile 的 .env 里读 API_SERVER_KEY。
 *
 * 这个 key 能驱动一个有 terminal 权限的 agent，等价于远程代码执行，
 * 所以绝不能出现在前端 bundle 里（VITE_* 前缀的变量会被编译进产物）。
 * 由 dev server 在转发时注入请求头，浏览器全程不持有它。
 *
 * 每次请求都重读文件：换 key 后不必重启 Vite。
 */
function readAgentKey(): string {
  const envPath =
    process.env.HERMES_PROFILE_ENV ?? path.resolve(homedir(), ".hermes/profiles/feishu/.env");
  try {
    const line = readFileSync(envPath, "utf8")
      .split("\n")
      .find((l) => l.trimStart().startsWith("API_SERVER_KEY="));
    if (line) return line.slice(line.indexOf("=") + 1).trim();
  } catch {
    // 文件不存在或没有读权限时退回进程环境变量。
  }
  return process.env.API_SERVER_KEY ?? "";
}

const agentTarget = process.env.AGENT_API_TARGET ?? "http://127.0.0.1:8642";

/**
 * api_server 的两个前缀：/api/sessions、/v1/runs 等。
 *
 * - changeOrigin 保持 false：api_server 的 _origin_allowed 对带 Origin 且
 *   不在 API_SERVER_CORS_ORIGINS 白名单里的请求直接 403，转发原始 Origin
 *   （http://localhost:5273）才能通过。
 * - 去掉 accept-encoding：避免中间层压缩把 SSE 攒成一整块才吐。
 */
const agentProxy = {
  target: agentTarget,
  changeOrigin: false,
  // Vite 8 底层是 http-proxy-3。
  configure: (proxy: {
    on: (event: string, cb: (proxyReq: { setHeader: (k: string, v: string) => void; removeHeader?: (k: string) => void }) => void) => void;
  }) => {
    proxy.on("proxyReq", (proxyReq) => {
      const key = readAgentKey();
      if (key) proxyReq.setHeader("Authorization", `Bearer ${key}`);
      proxyReq.removeHeader?.("accept-encoding");
    });
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5273,
    proxy: {
      "/api": agentProxy,
      "/v1": agentProxy,
    },
  },
});
