/** 状态胶囊的语义色，对应原型 .pill / .pill.success / .warn / .danger。 */
export type PillTone = "neutral" | "success" | "warn" | "danger";

/* ---------- 能力管理 ---------- */
/* Skill / MCP 的类型见 @/types/capability.ts —— 那里按 api_server 的实际字段定义。 */

/* ---------- 服务可观测 ---------- */

export type ObserveTabKey = "status" | "sql" | "api" | "trace" | "kafka";

export interface MetricItem {
  label: string;
  value: string;
  change?: string;
}

export interface ServiceStatusRow {
  key: string;
  service: string;
  status: "健康" | "告警" | "离线";
  instances: string;
  errorRate: string;
  p95: string;
}

export interface SlowSqlRow {
  key: string;
  digest: string;
  service: string;
  avgCost: string;
  maxCost: string;
  count: string;
  lastSeenAt: string;
}

export interface SlowApiRow {
  key: string;
  path: string;
  method: string;
  service: string;
  latency: string;
  errorRate: string;
  lastRequestAt: string;
}

export interface KafkaRow {
  key: string;
  topic: string;
  consumerGroup: string;
  backlog: string;
  produceRate: string;
  status: "正常" | "告警";
}

export interface ObservePanelData {
  metrics: MetricItem[];
  /** 服务状态 Tab 的趋势条高度百分比。 */
  trend?: number[];
}

/* ---------- 链路分析 ---------- */

export type SpanKind = "root" | "remote" | "cache" | "database";

export interface TraceSpan {
  id: string;
  name: string;
  kindLabel: string;
  kind: SpanKind;
  depth: number;
  /** 相对总耗时的起点与宽度，单位 %。 */
  offset: number;
  width: number;
  duration: string;
  service: string;
  evidence?: string;
}

export interface TopologyNode {
  id: string;
  label: string;
  meta: string;
  x: number;
  y: number;
  width: number;
  slow?: boolean;
}

export interface TopologyEdge {
  path: string;
  slow?: boolean;
}

export interface TraceQuery {
  keyword: string;
  service: string;
  range: string;
}

export interface TraceResult {
  traceId: string;
  summary: { label: string; tone: PillTone }[];
  insights: { title: string; detail: string }[];
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[]; viewBox: string };
  spans: TraceSpan[];
  ruler: string[];
}

/* ---------- 定时任务 ---------- */

export type TaskStatus = "运行中" | "已暂停" | "执行失败" | "从未运行" | "已完成";

/** 任务结果推给谁：本人飞书私聊 / 指定群 / 不推送。 */
export type TaskNotifyKind = "self" | "group" | "none";

export interface ScheduledTask {
  /** cron job id（12 位 hex）。 */
  key: string;
  name: string;
  /** 任务内容，对应 cron job 的 prompt。 */
  summary: string;
  /** 列表展示用的 cron 表达式，如 `0 9 * * *`、`every 30m`、`once in 5m`。 */
  frequency: string;
  /** 用户自己写的中文频率原文（服务端 schedule_display），编辑时回填。 */
  scheduleText: string;
  /** 表达式的中文读法，鼠标悬停在频率上时显示。 */
  frequencyHint: string;
  nextRunAt: string;
  lastRunAt: string;
  createdAt: string;
  status: TaskStatus;
  /** 创建人姓名，取飞书通讯录的 name。 */
  owner: string;
  /** 通知对象的展示文案。 */
  notify: string;
  notifyKind: TaskNotifyKind;
  notifyChatId?: string;
  lastError?: string;
}

/** 一次执行尝试，来自 cron 的执行账本（cron/executions.py）。 */
export interface TaskRun {
  key: string;
  /** 所属任务名，仅跨任务历史里有值。 */
  taskName: string;
  startedAt: string;
  finishedAt: string;
  /** 本次执行耗时，账本只记时刻所以由前端算。 */
  duration: string;
  result: "成功" | "失败" | "进行中" | "未知";
  /** 触发来源：定时调度还是手动触发。 */
  source: string;
  error?: string;
}

/** 中文频率的解析预览结果。 */
export interface SchedulePreview {
  /** 存进 cron 的表达式，如 `0 9 * * *`、`every 30m`。 */
  schedule: string;
  kind: string;
  /** 用户输入的原文；与输入框当前内容比对，判断回显是否还对得上。 */
  display: string;
  /** 表达式的中文读法，例如「每天 09:00 执行」。 */
  description: string;
  /** 接下来几次执行时间（ISO），一次看不出误解，几次就能。 */
  nextRuns: string[];
  /** 一次性任务：只跑一次，跑完即结束。 */
  once: boolean;
  /** rule=规则命中，passthrough=本身就是表达式，llm=模型解析。 */
  source: string;
}

export interface FeishuChatOption {
  chatId: string;
  name: string;
}

/* ---------- 告警 ---------- */

export type AlertLevel = "高" | "中" | "低";
export type AlertStatus = "未处理" | "处理中" | "已关闭";

export interface AlertItem {
  key: string;
  level: AlertLevel;
  title: string;
  service: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  duration: string;
  status: AlertStatus;
  owner: string;
  description: string;
  condition: string;
  timeline: { at: string; text: string }[];
  relations: { label: string; to: string }[];
  notes: { at: string; author: string; text: string }[];
}

/* ---------- 设置 ---------- */

export type SettingsTabKey = "personal" | "topics" | "services" | "projects";

export interface PersonalSettings {
  name: string;
  defaultRange: string;
  openaiApiKey: string;
  agentToken: string;
  answerMode: string;
  notifyEmail: string;
}

export interface TopicThreshold {
  topic: string;
  consumer_group: string;
  threshold: number;
}

export interface TopicConfig {
  topics: TopicThreshold[];
}

export interface ServiceConfig {
  service_name: string[];
}

export interface BrandConfig<T> {
  brand: string;
  label: string;
  config: T;
}

export interface ProjectConfig {
  project: string;
  service_name: string[];
  brands: string[];
  aliases: string[];
  domains: string[];
  owns: string[];
  code_hints: { entrypoints: string[]; search_terms: string[]; exclude: string[] };
  docs: { summary: string };
  git: { url: string; branch: string };
  log_skill: string;
}

/* ---------- 知识库 ---------- */

export interface KnowledgeCollection {
  id: string;
  type: "项目文档" | "领域文档";
  name: string;
  desc: string;
  updated: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  /** Markdown 正文。 */
  body: string;
}

export interface KnowledgeFolder {
  id: string;
  name: string;
  docs: KnowledgeDoc[];
}

/* ---------- 对话 ---------- */

/** 首页的问题建议卡片。 */
export interface ChatSuggestion {
  id: string;
  title: string;
  /** 点击后填入输入框的完整问句。 */
  question: string;
  desc: string;
  /** 该建议会用到的能力与数据源。 */
  meta: string;
}
