import type { AlertItem } from "@/types";

/** 数据来自设计原型 index.html:49，详情按 plan.md 的抽屉结构补齐。 */
export const alerts: AlertItem[] = [
  {
    key: "alert-payment-error",
    level: "高",
    title: "支付服务错误率升高",
    service: "payment-service",
    source: "服务可观测",
    firstSeenAt: "今天 10:02",
    lastSeenAt: "刚刚",
    duration: "12 分钟",
    status: "未处理",
    owner: "未分派",
    description: "payment-service 的回调处理接口在最近 10 分钟内错误率从 0.18% 升至 2.10%，集中在回调签名校验环节。",
    condition: "错误率 > 1% 持续 5 分钟（示例阈值）",
    timeline: [
      { at: "10:02", text: "错误率首次超过阈值，告警生成" },
      { at: "10:06", text: "错误集中在 /api/v1/payments 回调分支" },
      { at: "10:12", text: "错误率仍在阈值以上，告警保持未处理" },
    ],
    relations: [
      { label: "服务状态 · payment-service", to: "/observe/status" },
      { label: "慢接口 · /api/v1/payments", to: "/observe/api" },
    ],
    notes: [],
  },
  {
    key: "alert-order-p95",
    level: "中",
    title: "订单接口 P95 超过阈值",
    service: "order-api",
    source: "服务可观测",
    firstSeenAt: "今天 09:58",
    lastSeenAt: "12 分钟前",
    duration: "26 分钟",
    status: "处理中",
    owner: "林晓",
    description: "order-api 的 /api/v2/orders/{id} P95 达到 812 ms，链路分析显示瓶颈在 inventory-service 的库存查询。",
    condition: "P95 > 500 ms 持续 10 分钟（示例阈值）",
    timeline: [
      { at: "09:58", text: "P95 超过阈值，告警生成" },
      { at: "10:04", text: "林晓确认告警并开始链路分析" },
      { at: "10:09", text: "链路分析定位到 SQL Span 684 ms" },
    ],
    relations: [
      { label: "链路分析 · tr_8af2c91d", to: "/observe/trace" },
      { label: "慢 SQL · sku_inventory", to: "/observe/sql" },
    ],
    notes: [{ at: "10:04", author: "林晓", text: "已确认，正在做链路分析，先不升级。" }],
  },
  {
    key: "alert-kafka-backlog",
    level: "中",
    title: "Kafka 消费组存在积压",
    service: "order-events",
    source: "定时任务 · Kafka 积压检查",
    firstSeenAt: "今天 09:42",
    lastSeenAt: "今天 09:42",
    duration: "42 分钟",
    status: "处理中",
    owner: "林晓",
    description: "order-worker 消费组积压 8,240 条，超过 Topic 阈值配置中的告警线。",
    condition: "积压量 > 5,000 条（示例阈值）",
    timeline: [
      { at: "09:42", text: "定时任务巡检发现积压，告警生成" },
      { at: "09:50", text: "确认为上游批量投递导致的短时积压" },
    ],
    relations: [
      { label: "Kafka 看板 · order-events", to: "/observe/kafka" },
      { label: "Topic 阈值配置", to: "/settings/topics" },
    ],
    notes: [{ at: "09:50", author: "林晓", text: "上游批量投递，观察 30 分钟后再决定是否扩容消费者。" }],
  },
  {
    key: "alert-night-task",
    level: "低",
    title: "夜间巡检任务执行失败",
    service: "巡检任务",
    source: "定时任务 · 夜间服务健康检查",
    firstSeenAt: "昨天 02:04",
    lastSeenAt: "昨天 02:04",
    duration: "已结束",
    status: "已关闭",
    owner: "林晓",
    description: "夜间服务健康检查任务因可观测平台 MCP 未配置访问令牌而中止。",
    condition: "定时任务执行结果为失败",
    timeline: [
      { at: "昨天 02:04", text: "任务执行失败，告警生成" },
      { at: "昨天 09:12", text: "确认为 MCP 未配置，非服务异常" },
      { at: "昨天 09:15", text: "告警关闭，关闭原因：配置问题，已转配置项跟进" },
    ],
    relations: [
      { label: "定时任务 · 夜间服务健康检查", to: "/tasks" },
      { label: "能力管理 · 可观测平台 MCP", to: "/capability" },
    ],
    notes: [{ at: "昨天 09:15", author: "林晓", text: "非服务异常，等 MCP 配置完成后重跑。" }],
  },
];

export const alertMetrics = [
  { label: "未处理", value: "02", change: "需要关注" },
  { label: "处理中", value: "01" },
  { label: "今日关闭", value: "06" },
  { label: "平均响应", value: "12m" },
];

export const alertCloseReasons = ["已修复", "误报", "配置问题", "重复告警", "无需处理"];
