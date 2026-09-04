/**
 * 与 gateway/platforms/api_server.py 对接的类型。
 *
 * 字段取自服务端的「client-safe」白名单，不要凭猜测扩字段：
 *   会话  _session_response  api_server.py:2177-2184
 *   消息  _message_response  api_server.py:2194-2198
 *   事件  _make_run_event_callback / _handle_runs  api_server.py:4745-4773、4880、5007-5042
 */

/* ---------- 会话 ---------- */

export interface AgentSession {
  id: string;
  source?: string;
  title?: string | null;
  /** 首条用户消息前 60 字，服务端算好的（hermes_state.py:3717）。没有 title 时用它当标题。 */
  preview?: string | null;
  /** unix 秒。 */
  started_at?: number | null;
  last_active?: number | null;
  message_count?: number | null;
  model?: string | null;
}

export interface AgentMessage {
  id?: number | string;
  session_id?: string;
  role: string;
  content?: string | null;
  tool_name?: string | null;
  timestamp?: number | null;
  /** 历史里的思考过程，两个字段名服务端都可能给（_message_response 白名单里都有）。 */
  reasoning?: string | null;
  reasoning_content?: string | null;
}

/* ---------- 能力（技能 / 工具集 / 运行时） ---------- */

/** GET /v1/skills 的每一项。 */
export interface AgentSkill {
  name: string;
  description?: string | null;
  category?: string | null;
}

/** GET /v1/toolsets 的每一项，platform 固定是 api_server。 */
export interface AgentToolset {
  name: string;
  label?: string | null;
  /** 服务端这里给的是逗号分隔的工具名，不是散文描述。 */
  description?: string | null;
  enabled?: boolean;
  configured?: boolean;
  tools?: string[];
}

/** GET /v1/capabilities。 */
export interface AgentCapabilities {
  platform?: string;
  /**
   * 注意：这是 _resolve_model_name 的结果 —— 没显式配 API_SERVER_MODEL_NAME 时
   * 它回的是 **profile 名**（这里就是 "feishu"），不是真实模型。真实模型看
   * AgentSession.model。
   */
  model?: string;
  runtime?: {
    mode?: string;
    tool_execution?: string;
    split_runtime?: boolean;
    description?: string;
  };
  features?: Record<string, boolean>;
  auth?: { required?: boolean; type?: string };
}

/**
 * GET /v1/models 的每一项。
 *
 * 服务端会先放一条「基准」条目（parent 为 null），它的 id 是
 * _resolve_model_name 的结果 —— 没配 API_SERVER_MODEL_NAME 时那就是 **profile 名**
 * （这里是 "feishu"），**不是模型名**，不能直接显示给用户当模型。
 * 之后每条是 model_routes 里的 alias，root 才是真实模型
 * （api_server.py:1964-1989）。
 */
export interface AgentModel {
  id: string;
  root?: string;
  parent?: string | null;
  owned_by?: string;
}

/** 基准条目就是 parent 为空的那条。 */
export function isBaseModel(model: AgentModel): boolean {
  return !model.parent;
}

/* ---------- Run ---------- */

export type RunStatusValue =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

/** 终态之后服务端保留 _RUN_STATUS_TTL = 3600 秒可供轮询（api_server.py:4712）。 */
export const TERMINAL_RUN_STATUSES: readonly RunStatusValue[] = [
  "completed",
  "failed",
  "cancelled",
];

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** GET /v1/runs/{run_id} 的返回，即 _run_statuses[run_id] 原样。 */
export interface RunStatus {
  object?: string;
  run_id: string;
  status: RunStatusValue | string;
  created_at?: number;
  updated_at?: number;
  session_id?: string;
  model?: string;
  last_event?: string;
  output?: string;
  error?: string;
  usage?: RunUsage;
}

export interface RunUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

/* ---------- SSE 事件 ---------- */

interface RunEventBase {
  run_id: string;
  timestamp: number;
}

/**
 * 审批档位。服务端的 _approval_event_choices（api_server.py:71-74）返回的是
 * 纯字符串数组：["once","session","always","deny"]，smart_denied 时只有
 * ["once","deny"]，allow_permanent=false 时去掉 always。
 */
export type ApprovalChoice = "once" | "session" | "always" | "deny";

export const APPROVAL_CHOICE_LABELS: Record<string, string> = {
  once: "仅本次允许",
  session: "本会话内允许",
  always: "始终允许",
  deny: "拒绝",
};

export type RunEvent =
  | (RunEventBase & { event: "message.delta"; delta: string })
  | (RunEventBase & { event: "reasoning.available"; text: string })
  | (RunEventBase & { event: "tool.started"; tool: string; preview?: string | null })
  | (RunEventBase & {
      event: "tool.completed";
      tool: string;
      duration?: number;
      /** 服务端传的是 bool（is_error），不是错误文本。 */
      error?: boolean;
    })
  | (RunEventBase & {
      event: "approval.request";
      /** 已过 _redact_approval_command 脱敏（api_server.py:4934-4937）。 */
      command?: string;
      description?: string;
      choices?: string[];
      pattern_key?: string;
      pattern_keys?: string[];
      smart_denied?: boolean;
      allow_permanent?: boolean;
    })
  | (RunEventBase & { event: "approval.responded"; choice: string; resolved: number })
  | (RunEventBase & { event: "run.completed"; output?: string; usage?: RunUsage })
  | (RunEventBase & { event: "run.failed"; error?: string })
  | (RunEventBase & { event: "run.cancelled" });

export type RunEventName = RunEvent["event"];

/** 服务端没有 event: 字段，类型在 JSON 的 event 键里；未知事件直接忽略。 */
export function isRunEvent(value: unknown): value is RunEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { event?: unknown }).event === "string"
  );
}

/* ---------- 前端组装出来的一次对话 ---------- */

export type TurnPhase = "idle" | "running" | "completed" | "failed" | "cancelled" | "detached";

export interface ToolTrace {
  /** tool.started / tool.completed 靠工具名 + 出现顺序配对。 */
  id: string;
  tool: string;
  preview?: string | null;
  /**
   * tool.started 到达的毫秒时间戳。
   * 实测单个 search_files 能跑 60 秒，进行中要显示它已经跑了多久 ——
   * 这才是发现「某个工具挂住了」的唯一线索。
   */
  startedAt?: number;
  /** 秒。 */
  duration?: number;
  failed?: boolean;
  done: boolean;
}

export interface Turn {
  id: string;
  question: string;
  /** message.delta 累积出来的回答。 */
  answer: string;
  /** reasoning.available 的整块思考，逐条追加。 */
  reasoning: string[];
  tools: ToolTrace[];
  phase: TurnPhase;
  runId?: string;
  /** 由 sessionStorage 记录恢复出来的轮次：只能靠轮询拿最终答案，没有实时明细。 */
  recovered?: boolean;
  /** 本轮开始的毫秒时间戳：进行中用来跳计时器，终态用来显示总耗时与消息时间。 */
  startedAt: number;
  /**
   * 最后一个 SSE 事件到达的毫秒时间戳。
   * 用来判断「停滞」——长任务里超过一分钟没有任何动作，要告诉用户它可能卡住了，
   * 而不是让脉冲条一直转下去。
   */
  lastEventAt: number;
  /**
   * 到达终态的毫秒时间戳。
   * 有了它，总耗时就是纯数据（endedAt - startedAt），渲染期不必调 Date.now()
   * —— 那会触发 react-hooks/purity，而且读数会随每次重渲染漂移。
   */
  endedAt?: number;
  error?: string;
  usage?: RunUsage;
}
