/**
 * 定时任务：gateway/platforms/api_server.py 的 /api/jobs 系列封装。
 *
 * 后端是真实 cron（cron/jobs.py），与飞书助手端共用同一份任务：
 * 服务端按登录身份对应的飞书 user_id 做隔离，所以这里拿到的就是"我的"任务。
 * 传输层（同源转发、CSRF、401）复用 ./http 的 request()。
 */

import { request } from "./http";
import type {
  FeishuChatOption,
  MetricItem,
  ScheduledTask,
  SchedulePreview,
  TaskNotifyKind,
  TaskRun,
} from "@/types";

/* ---------- 服务端形状 ---------- */

interface CronExecution {
  id: string;
  job_id: string;
  source: string;
  status: "claimed" | "running" | "completed" | "failed" | "unknown";
  claimed_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  /** 仅跨任务历史接口会带。 */
  job_name?: string;
}

/** parse_schedule 的产物（cron/jobs.py parse_schedule）。 */
interface CronSchedule {
  kind?: "once" | "interval" | "cron";
  /** cron 表达式（kind=cron）。 */
  expr?: string;
  /** 间隔分钟数（kind=interval）。 */
  minutes?: number;
  /** 执行时刻（kind=once）。 */
  run_at?: string;
  /** 规范化的表达式串，如 `every 30m`、`once in 5m`。 */
  display?: string;
}

interface CronJob {
  id: string;
  name: string;
  prompt: string;
  /** 被我们覆盖成用户写的中文原文，不是表达式。 */
  schedule_display?: string;
  schedule?: CronSchedule | null;
  created_at?: string | null;
  enabled?: boolean;
  state?: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  deliver?: string;
  owner_name?: string | null;
  origin?: { user_name?: string | null } | null;
  latest_execution?: CronExecution | null;
}

interface JobsMetrics {
  running: number;
  total: number;
  today_executed: number;
  today_failed: number;
  success_rate: number | null;
}

/* ---------- 时间格式化 ---------- */

const pad = (value: number) => String(value).padStart(2, "0");

/** 所有时间统一 `yyyy-MM-dd HH:mm:ss`：相对说法（"明天"）排查时反而要换算。 */
function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/* ---------- 映射 ---------- */

/**
 * 列表频率列展示的表达式。
 *
 * 顶层 schedule_display 已被换成用户写的中文原文，所以表达式从
 * parse_schedule 存下的 schedule 里取（它自带规范化的 display）。
 */
function cronExpression(schedule?: CronSchedule | null): string {
  if (!schedule) return "—";
  if (schedule.display) return schedule.display;
  if (schedule.kind === "cron" && schedule.expr) return schedule.expr;
  if (schedule.kind === "interval" && schedule.minutes) return `every ${schedule.minutes}m`;
  if (schedule.kind === "once" && schedule.run_at) {
    return `once at ${formatTimestamp(schedule.run_at)}`;
  }
  return "—";
}

function toStatus(job: CronJob): ScheduledTask["status"] {
  // 一次性任务跑完后 cron 会把它标成 completed 并停用（cron/jobs.py
  // mark_job_run），那不是"被人暂停"，也不该再显示启用按钮。
  if (job.state === "completed") return "已完成";
  if (job.enabled === false || job.state === "paused") return "已暂停";
  const latest = job.latest_execution?.status ?? job.last_status;
  if (latest === "failed") return "执行失败";
  if (!job.last_run_at && !job.latest_execution) return "从未运行";
  return "运行中";
}

/** deliver 是 cron 的投递串："origin" / "feishu:<群 id>" / "local"。 */
function toNotify(deliver: string | undefined, groupNames: Map<string, string>) {
  const value = (deliver ?? "local").trim();
  if (value === "origin") {
    return { kind: "self" as TaskNotifyKind, text: "我的飞书私聊", chatId: undefined };
  }
  if (value.startsWith("feishu:")) {
    const chatId = value.slice("feishu:".length);
    return { kind: "group" as TaskNotifyKind, text: groupNames.get(chatId) ?? chatId, chatId };
  }
  return { kind: "none" as TaskNotifyKind, text: "不推送", chatId: undefined };
}

function toTask(job: CronJob, groupNames: Map<string, string>): ScheduledTask {
  const notify = toNotify(job.deliver, groupNames);
  const scheduleText = job.schedule_display || "";
  return {
    key: job.id,
    name: job.name,
    summary: job.prompt || "—",
    frequency: cronExpression(job.schedule),
    scheduleText,
    frequencyHint: scheduleText,
    nextRunAt:
      job.state === "completed"
        ? "已结束"
        : job.enabled === false
          ? "已暂停"
          : formatTimestamp(job.next_run_at),
    lastRunAt: formatTimestamp(job.last_run_at),
    createdAt: formatTimestamp(job.created_at),
    status: toStatus(job),
    owner: job.owner_name || job.origin?.user_name || "—",
    notify: notify.text,
    notifyKind: notify.kind,
    notifyChatId: notify.chatId,
    lastError: job.last_error ?? undefined,
  };
}

const RUN_RESULTS: Record<CronExecution["status"], TaskRun["result"]> = {
  completed: "成功",
  failed: "失败",
  running: "进行中",
  claimed: "进行中",
  unknown: "未知",
};

/** 耗时：账本只记时刻，时长得自己算。 */
function runDuration(row: CronExecution): string {
  const start = row.started_at ?? row.claimed_at;
  if (!start || !row.finished_at) return "—";
  const ms = new Date(row.finished_at).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

function toRun(row: CronExecution): TaskRun {
  return {
    key: row.id,
    taskName: row.job_name ?? "",
    startedAt: formatTimestamp(row.started_at ?? row.claimed_at),
    finishedAt: formatTimestamp(row.finished_at),
    duration: runDuration(row),
    result: RUN_RESULTS[row.status] ?? "未知",
    source: row.source === "manual" ? "手动触发" : row.source || "定时调度",
    error: row.error ?? undefined,
  };
}

/* ---------- 群列表 ---------- */

/** 只返回「我和助手都在」的群，服务端已做成员校验。 */
export async function listFeishuChats(): Promise<FeishuChatOption[]> {
  const body = await request<{ chats: { chat_id: string; name: string }[] }>("/api/feishu/chats");
  return (body.chats ?? []).map((chat) => ({ chatId: chat.chat_id, name: chat.name }));
}

/** 群名映射失败不该拖垮任务列表，所以单独兜底。 */
async function groupNameMap(): Promise<Map<string, string>> {
  try {
    const chats = await listFeishuChats();
    return new Map(chats.map((chat) => [chat.chatId, chat.name]));
  } catch {
    return new Map();
  }
}

/* ---------- 查询 ---------- */

export async function listTasks(): Promise<ScheduledTask[]> {
  const [body, groupNames] = await Promise.all([
    request<{ jobs: CronJob[] }>("/api/jobs"),
    groupNameMap(),
  ]);
  return (body.jobs ?? []).map((job) => toTask(job, groupNames));
}

export async function getTaskMetrics(): Promise<MetricItem[]> {
  const body = await request<JobsMetrics>("/api/jobs/metrics");
  return [
    { label: "运行中", value: pad(body.running) },
    { label: "今日已执行", value: pad(body.today_executed) },
    { label: "执行失败", value: pad(body.today_failed) },
    {
      label: "成功率",
      value: body.success_rate === null ? "—" : `${(body.success_rate * 100).toFixed(1)}%`,
    },
  ];
}

export async function listTaskRuns(key: string, limit = 20): Promise<TaskRun[]> {
  const body = await request<{ executions: CronExecution[] }>(
    `/api/jobs/${encodeURIComponent(key)}/executions?limit=${limit}`,
  );
  return (body.executions ?? []).map(toRun);
}

interface ScheduleParseResponse {
  schedule: string;
  kind: string;
  display: string;
  description: string;
  next_runs?: string[];
  once?: boolean;
  source: string;
}

/** 中文频率的解析预览：点「解析」时调用，确认无误才允许提交。 */
export async function parseSchedule(text: string): Promise<SchedulePreview> {
  const body = await request<ScheduleParseResponse>("/api/jobs/parse-schedule", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return {
    schedule: body.schedule,
    kind: body.kind,
    display: body.display,
    description: body.description,
    nextRuns: body.next_runs ?? [],
    once: body.once ?? false,
    source: body.source,
  };
}

/** 回显里的执行时间：带星期，"每周一"和"每天"一眼能分辨。 */
export function formatScheduleRun(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatTimestamp(value)} 周${"日一二三四五六"[date.getDay()]}`;
}

/* ---------- 写入 ---------- */

export interface TaskDraft {
  name: string;
  summary: string;
  /** 中文频率原文，服务端解析成 cron 表达式后把原文存回 schedule_display。 */
  scheduleText: string;
  notifyKind: TaskNotifyKind;
  notifyChatId?: string;
  /** 仅新建时有意义：默认关闭，手动开启。 */
  enabled: boolean;
}

function notifyPayload(draft: TaskDraft) {
  return draft.notifyKind === "group"
    ? { kind: "group", chat_id: draft.notifyChatId }
    : { kind: draft.notifyKind };
}

export async function createTask(draft: TaskDraft): Promise<ScheduledTask> {
  const body = await request<{ job: CronJob }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      name: draft.name,
      prompt: draft.summary,
      schedule_text: draft.scheduleText,
      notify: notifyPayload(draft),
      enabled: draft.enabled,
    }),
  });
  return toTask(body.job, await groupNameMap());
}

export async function updateTask(key: string, draft: TaskDraft): Promise<void> {
  await request(`/api/jobs/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: draft.name,
      prompt: draft.summary,
      schedule_text: draft.scheduleText,
      notify: notifyPayload(draft),
    }),
  });
}

export interface RunHistoryQuery {
  /** 只看某个任务；不传则看自己的全部任务。 */
  taskKey?: string;
  /** 起始时间（ISO），不传则不限。 */
  since?: string;
  limit?: number;
  offset?: number;
}

export interface RunHistoryPage {
  runs: TaskRun[];
  total: number;
}

/** 跨任务的执行历史，服务端已按登录身份限定在自己的任务范围内。 */
export async function listRunHistory(query: RunHistoryQuery = {}): Promise<RunHistoryPage> {
  // URLSearchParams 会把 "+08:00" 里的 + 正确编码 —— 不编码的话它在
  // query string 里等于空格，服务端解析时间就会失败。
  const params = new URLSearchParams({
    limit: String(query.limit ?? 20),
    offset: String(query.offset ?? 0),
  });
  if (query.taskKey) params.set("job_id", query.taskKey);
  if (query.since) params.set("since", query.since);
  const body = await request<{ executions: CronExecution[]; total: number }>(
    `/api/jobs/executions?${params}`,
  );
  return { runs: (body.executions ?? []).map(toRun), total: body.total ?? 0 };
}

export async function deleteTask(key: string): Promise<void> {
  await request(`/api/jobs/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function setTaskEnabled(key: string, enabled: boolean): Promise<void> {
  const action = enabled ? "resume" : "pause";
  await request(`/api/jobs/${encodeURIComponent(key)}/${action}`, { method: "POST" });
}

/** 立即跑一次，不影响后续排期。 */
export async function runTaskNow(key: string): Promise<void> {
  await request(`/api/jobs/${encodeURIComponent(key)}/run`, { method: "POST" });
}
