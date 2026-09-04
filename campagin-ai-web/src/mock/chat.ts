import type { ChatSuggestion } from "@/types";

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
