/**
 * api_server 的 HTTP 客户端底座。
 *
 * 请求走同源相对路径，由 Vite dev server（生产环境由 nginx）转发到
 * 127.0.0.1:8642 并在服务端注入 Authorization —— 浏览器不持有 API_SERVER_KEY。
 * 因为是同源，不触发 CORS，也顺带绕开服务端 _CORS_HEADERS 里
 * Access-Control-Allow-Methods 缺 PATCH 的问题（api_server.py:575-578）。
 *
 * agent.ts 与 capability.ts 共用这一份：401 处理、CSRF 头和错误文案只能有一处，
 * 否则「登录失效要跳登录页」这种行为会在两份实现里漂移。
 */

import { ApiError } from "./client";
import { getWebCsrfToken, setWebCsrfToken } from "./auth";

/** api_server 的错误体统一是 {"error": {"message", "type", "code"}}。 */
interface ApiErrorBody {
  error?: { message?: string; code?: string; type?: string };
}

export class AgentApiError extends ApiError {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.code = code;
  }
}

const STATUS_HINTS: Record<number, string> = {
  401: "登录已失效，请重新登录",
  403: "请求验证失败，请刷新页面后重试",
  404: "资源不存在",
  409: "状态冲突",
  429: "并发已达上限（gateway.api_server.max_concurrent_runs），稍后再试",
  // 502/504 来自 dev server 的代理层：目标 127.0.0.1:8642 没在监听。
  502: "agent 服务未就绪：确认 gateway 已重启且 .env 里 API_SERVER_ENABLED=true",
  503: "会话数据库不可用",
  504: "agent 服务响应超时",
};

export async function toApiError(res: Response): Promise<AgentApiError> {
  let message = "";
  let code: string | undefined;
  try {
    const body = (await res.json()) as ApiErrorBody;
    message = body.error?.message ?? "";
    code = body.error?.code;
  } catch {
    // 非 JSON 响应（如代理层的 502），走下面的兜底文案。
  }
  if (!message) message = STATUS_HINTS[res.status] ?? `请求失败（HTTP ${res.status}）`;
  return new AgentApiError(message, res.status, code);
}

/** 连不上后端时 fetch 直接 reject，转成同一种错误类型便于页面统一展示。 */
export function toNetworkError(err: unknown): AgentApiError {
  if (err instanceof AgentApiError) return err;
  if (err instanceof DOMException && err.name === "AbortError") throw err;
  return new AgentApiError("连不上 agent 服务，确认 gateway 已启动并启用了 api_server", 0);
}

/** 401 时清掉 CSRF 并广播，让 AuthProvider 跳登录。 */
export function handleUnauthorized(res: Response): void {
  if (res.status !== 401) return;
  setWebCsrfToken(null);
  window.dispatchEvent(new Event("hermes:login-required"));
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const csrfToken = getWebCsrfToken();
    res = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method) && csrfToken
          ? { "X-CSRF-Token": csrfToken }
          : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw toNetworkError(err);
  }
  handleUnauthorized(res);
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
