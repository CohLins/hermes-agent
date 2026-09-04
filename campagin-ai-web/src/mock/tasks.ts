import type { ScheduledTask } from "@/types";

/** 数据来自设计原型 index.html:48，补齐 plan.md 要求的任务内容摘要与运行记录。 */
export const scheduledTasks: ScheduledTask[] = [
  {
    key: "task-payment-error",
    name: "支付服务错误巡检",
    summary: "检查 payment-service 近 30 分钟的错误日志，出现集中报错时给出归因结论。",
    frequency: "每 30 分钟",
    nextRunAt: "10:30",
    lastRunAt: "10:00",
    status: "运行中",
    owner: "林晓",
    notify: "支付值班群",
    dataRange: "最近 30 分钟",
    runs: [
      { key: "r1", startedAt: "10:00:02", finishedAt: "10:00:07", result: "成功", tools: "日志分析 · 服务健康巡检" },
      { key: "r2", startedAt: "09:30:02", finishedAt: "09:30:06", result: "成功", tools: "日志分析" },
    ],
  },
  {
    key: "task-order-latency",
    name: "订单接口延迟日报",
    summary: "汇总 order-api 全部接口的 P95/P99 延迟，输出同比变化与慢接口清单。",
    frequency: "每天 09:00",
    nextRunAt: "明天 09:00",
    lastRunAt: "今天 09:00",
    status: "运行中",
    owner: "林晓",
    notify: "订单研发群",
    dataRange: "最近 24 小时",
    runs: [{ key: "r1", startedAt: "09:00:01", finishedAt: "09:00:12", result: "成功", tools: "SQL 性能分析 · 服务健康巡检" }],
  },
  {
    key: "task-kafka-backlog",
    name: "Kafka 积压检查",
    summary: "巡检监控范围内的 Topic 积压量，超过阈值的消费组升级为告警。",
    frequency: "每 15 分钟",
    nextRunAt: "10:15",
    lastRunAt: "10:00",
    status: "运行中",
    owner: "林晓",
    notify: "平台告警群",
    dataRange: "最近 15 分钟",
    runs: [{ key: "r1", startedAt: "10:00:00", finishedAt: "10:00:03", result: "成功", tools: "可观测平台 MCP" }],
  },
  {
    key: "task-night-health",
    name: "夜间服务健康检查",
    summary: "凌晨低峰期对全部服务做一次健康巡检，异常项直接建单。",
    frequency: "每天 02:00",
    nextRunAt: "明天 02:00",
    lastRunAt: "昨天 02:00",
    status: "执行失败",
    owner: "林晓",
    notify: "值班同学",
    dataRange: "最近 2 小时",
    runs: [
      {
        key: "r1",
        startedAt: "昨天 02:00:01",
        finishedAt: "昨天 02:00:04",
        result: "失败",
        tools: "服务健康巡检",
        error: "可观测平台 MCP 未配置访问令牌，任务在获取服务清单时中止。",
      },
    ],
  },
];

export const taskMetrics = [
  { label: "运行中", value: "03" },
  { label: "今日已执行", value: "18" },
  { label: "执行失败", value: "01" },
  { label: "成功率", value: "94.4%" },
];

export const taskFrequencies = ["每 15 分钟", "每 30 分钟", "每小时", "每天 09:00", "每天 02:00", "每周一 09:00"];
