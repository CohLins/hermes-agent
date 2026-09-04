import type { ChatAnswer, ChatSession, ChatSuggestion } from "@/types";

/** 历史会话与示例回答来自设计原型 index.html 的侧栏与 sendChat。 */
export const chatSessions: ChatSession[] = [
  { id: "s1", title: "支付服务错误日志排查", group: "今天" },
  { id: "s2", title: "订单接口 P95 变慢分析", group: "今天" },
  { id: "s3", title: "Kafka 消费积压检查", group: "最近 7 天" },
  { id: "s4", title: "夜间巡检任务配置", group: "最近 7 天" },
  { id: "s5", title: "用户中心发布后异常", group: "更早" },
];

/** plan.md 要求首页给 3–4 个具体问题建议，并说明各自会用到什么能力。 */
export const chatSuggestions: ChatSuggestion[] = [
  {
    id: "error-log",
    title: "错误日志排查",
    question: "查看支付服务近 30 分钟错误日志",
    desc: "按服务与时间窗口提取错误模式、错误码分布和首次发生时间。",
    meta: "日志分析 · 最近 30 分钟",
  },
  {
    id: "latency",
    title: "接口延迟归因",
    question: "分析订单接口 P95 变慢原因",
    desc: "从入口 Span 定位最长耗时，再对照依赖调用与数据库等待。",
    meta: "链路分析 · SQL 性能分析",
  },
  {
    id: "kafka",
    title: "消费积压检查",
    question: "检查 Kafka 消费积压",
    desc: "巡检监控范围内 Topic 的积压量与消费速率，超阈值的标记为告警。",
    meta: "可观测平台 MCP · Kafka 看板",
  },
  {
    id: "health",
    title: "服务健康巡检",
    question: "对全部服务做一次健康巡检",
    desc: "聚合服务状态、实例健康与近期异常，形成一份可直接转发的巡检摘要。",
    meta: "服务健康巡检 · 全部服务",
  },
];

/** 阶段一固定返回这份示例回答；阶段二换成真实 Agent 响应。 */
export const mockAnswer: ChatAnswer = {
  label: "ATLAS AGENT · 模拟回答",
  elapsed: "1.4s",
  tools: [
    { name: "日志分析", range: "最近 30 分钟", result: "命中 42 条错误日志，集中在回调签名校验分支。" },
    { name: "服务健康巡检", range: "最近 30 分钟", result: "14 个服务中 12 个健康，order-api 与 inventory-service 处于告警。" },
  ],
  paragraphs: [
    "基于最近 30 分钟的示例数据，已完成对相关服务与日志的模拟检查，发现一处需要继续确认的性能信号。",
    "结论：order-api 的 /api/v2/orders/{id} P95 达到 812 ms，链路分析显示瓶颈在 inventory-service 的库存查询（SQL Span 684 ms）；payment-service 的错误率同期升至 2.10%，两者暂未发现直接关联。",
    "下一步建议：先在慢 SQL 视图确认 sku_inventory 的索引与锁等待，再看 payment-service 回调签名失败的比例是否与渠道侧变更相关。",
  ],
  evidence: [
    { label: "服务状态 · 示例数据", to: "/observe/status" },
    { label: "链路分析 · tr_8af2c91d", to: "/observe/trace" },
    { label: "关联告警 · 模拟状态", to: "/alerts" },
  ],
};
