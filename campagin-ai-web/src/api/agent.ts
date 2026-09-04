/**
 * gateway/platforms/api_server.py 的端点封装。
 *
 * 请求走同源相对路径，由 Vite dev server（生产环境由 nginx）转发到
 * 127.0.0.1:8642 并在服务端注入 Authorization —— 浏览器不持有 API_SERVER_KEY。
 * 因为是同源，不触发 CORS，也顺带绕开服务端 _CORS_HEADERS 里
 * Access-Control-Allow-Methods 缺 PATCH 的问题（api_server.py:575-578）。
 */

import { ApiError } from "./client";
import { WEB_RENDER_INSTRUCTIONS } from "./instructions";
import { parseSseStream } from "./sse";
import { isRunEvent } from "@/types/agent";
import type {
  AgentCapabilities,
  AgentMessage,
  AgentModel,
  AgentSession,
  AgentSkill,
  AgentToolset,
  RunEvent,
  RunStatus,
} from "@/types/agent";

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
  401: "鉴权失败：dev server 没能读到 API_SERVER_KEY，检查 ~/.hermes/profiles/feishu/.env",
  403: "被拒绝：请确认 .env 里 API_SERVER_CORS_ORIGINS 包含 http://localhost:5273",
  404: "资源不存在",
  409: "状态冲突",
  429: "并发已达上限（gateway.api_server.max_concurrent_runs），稍后再试",
  // 502/504 来自 dev server 的代理层：目标 127.0.0.1:8642 没在监听。
  502: "agent 服务未就绪：确认 gateway 已重启且 .env 里 API_SERVER_ENABLED=true",
  503: "会话数据库不可用",
  504: "agent 服务响应超时",
};

async function toError(res: Response): Promise<AgentApiError> {
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
function toNetworkError(err: unknown): AgentApiError {
  if (err instanceof AgentApiError) return err;
  if (err instanceof DOMException && err.name === "AbortError") throw err;
  return new AgentApiError("连不上 agent 服务，确认 gateway 已启动并启用了 api_server", 0);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    throw toNetworkError(err);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ---------- 会话 ---------- */

interface SessionListResponse {
  data: AgentSession[];
  has_more: boolean;
}

/**
 * source 固定 api_server：飞书助手的会话（source=feishu）不进这个列表。
 * 服务端按 last_active 倒序（order_by_last_active=True，api_server.py:2252）。
 */
export async function listSessions(limit = 50, offset = 0): Promise<AgentSession[]> {
  const query = new URLSearchParams({
    source: "api_server",
    limit: String(limit),
    offset: String(offset),
  });
  const body = await request<SessionListResponse>(`/api/sessions?${query}`);
  return body.data ?? [];
}

/**
 * 建一个空会话。
 *
 * 不传 title：服务端的 title 有唯一约束，冲突会回滚整条插入并返回 400
 * （api_server.py:2324-2332）。列表标题用服务端算好的 preview。
 * 也不传 id，让服务端生成 api_<ts>_<hex>。
 */
export async function createSession(): Promise<AgentSession> {
  const body = await request<{ session: AgentSession }>("/api/sessions", {
    method: "POST",
    body: "{}",
  });
  return body.session;
}

export async function getMessages(sessionId: string): Promise<AgentMessage[]> {
  const body = await request<{ data: AgentMessage[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  return body.data ?? [];
}

/** 重命名。标题重复时服务端返回 400 invalid_title，调用方要把文案透出去。 */
export async function renameSession(sessionId: string, title: string): Promise<AgentSession> {
  const body = await request<{ session: AgentSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
  );
  return body.session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

/* ---------- 能力 ---------- */

/** 本 profile 下 agent 能用的 skill（profile 的 skills/ 目录，与飞书助手同一份）。 */
export async function listSkills(): Promise<AgentSkill[]> {
  const body = await request<{ data: AgentSkill[] }>("/v1/skills");
  return body.data ?? [];
}

/** api_server 这个 platform 实际解析出的工具集（含未启用的，便于看全貌）。 */
export async function listToolsets(): Promise<AgentToolset[]> {
  const body = await request<{ data: AgentToolset[] }>("/v1/toolsets");
  return body.data ?? [];
}

/**
 * 可选模型。只有 config.yaml 里 platforms.api_server.extra.model_routes 配了
 * alias，这里才会多于一条（api_server.py:1978）。没配就只有基准条目，
 * 也就没得可切。
 */
export async function listModels(): Promise<AgentModel[]> {
  const body = await request<{ data: AgentModel[] }>("/v1/models");
  return body.data ?? [];
}

export function getCapabilities(): Promise<AgentCapabilities> {
  return request<AgentCapabilities>("/v1/capabilities");
}

/** 从现有会话分叉一条新的，保留上下文另开一路。 */
export async function forkSession(sessionId: string): Promise<AgentSession> {
  const body = await request<{ session: AgentSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
    { method: "POST", body: "{}" },
  );
  return body.session;
}

/* ---------- Run ---------- */

export interface HistoryEntry {
  role: string;
  content: string;
}

/**
 * 起一个 run，立刻返回 run_id（HTTP 202）。
 *
 * conversation_history 必须显式传：/v1/runs 不会自动读 session 历史
 * （只有 /chat/stream 会，api_server.py:2575）。不传就是每轮失忆。
 */
export async function startRun(params: {
  input: string;
  sessionId: string;
  history: HistoryEntry[];
  /**
   * model_routes 里的 alias。只在用户显式选了非基准模型时才传 —— 传一个
   * 没有路由的名字，_resolve_route 会返回 None 并静默回落到 config 默认模型，
   * 界面上却显示「已切换」，那是假反馈。
   */
  model?: string;
}): Promise<string> {
  const body = await request<{ run_id: string }>("/v1/runs", {
    method: "POST",
    body: JSON.stringify({
      input: params.input,
      session_id: params.sessionId,
      conversation_history: params.history,
      // 覆盖 hermes 给 api_server 内置的「assume plain text / no markdown」提示词，
      // 否则模型输出的是一整片无层次纯文本。详见 ./instructions.ts。
      instructions: WEB_RENDER_INSTRUCTIONS,
      ...(params.model ? { model: params.model } : {}),
    }),
  });
  return body.run_id;
}

/**
 * 订阅一个 run 的事件流。
 *
 * 服务端允许提前订阅（20×50ms 轮询等注册，api_server.py:5147-5152），且事件
 * 进的是会缓冲的 asyncio.Queue，所以「先 POST /v1/runs 再 GET events」不丢事件。
 *
 * 流是一次性的：断开后服务端在 finally 里 pop 掉队列（:5184），重连拿 404。
 */
export async function* openRunEvents(
  runId: string,
  signal: AbortSignal,
): AsyncGenerator<RunEvent, void, void> {
  let res: Response;
  try {
    res = await fetch(`/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
  } catch (err) {
    throw toNetworkError(err);
  }
  if (!res.ok) throw await toError(res);
  if (!res.body) throw new AgentApiError("agent 服务没有返回事件流", 0);

  for await (const raw of parseSseStream(res.body)) {
    if (isRunEvent(raw)) yield raw;
  }
}

/** 轮询用：终态记录保留 3600 秒（_RUN_STATUS_TTL），过期后 404。 */
export function getRun(runId: string): Promise<RunStatus> {
  return request<RunStatus>(`/v1/runs/${encodeURIComponent(runId)}`);
}

/**
 * 真正停掉 agent（_active_run_agents[run_id].interrupt()）。
 * 只 abort 前端的 fetch 不够 —— agent 会在后台把这一轮跑完。
 */
export function stopRun(runId: string): Promise<{ status: string }> {
  return request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
}

export function respondApproval(
  runId: string,
  choice: string,
  all = false,
): Promise<{ resolved: number }> {
  return request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: "POST",
    body: JSON.stringify({ choice, all }),
  });
}
