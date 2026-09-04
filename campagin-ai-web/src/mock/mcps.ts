import type { McpServer } from "@/types";

/** 数据来自设计原型 index.html:38。 */
export const mcps: McpServer[] = [
  {
    id: "log-query",
    name: "日志查询 MCP",
    description: "查询指定服务和时间范围内的日志。",
    status: "已启用",
    configSummary: "内置连接 · 无需配置",
    lastCheckedAt: "今天 10:12",
    permissions: ["读取日志索引", "读取服务清单"],
    connection: [
      { key: "endpoint", value: "内置" },
      { key: "auth", value: "无需配置" },
    ],
  },
  {
    id: "observability",
    name: "可观测平台 MCP",
    description: "访问服务状态、慢接口、慢 SQL、Trace 与 Kafka 看板。",
    status: "待配置",
    configSummary: "需要访问地址与令牌",
    lastCheckedAt: "尚未检查",
    permissions: ["读取服务指标", "读取 Trace", "读取 Kafka 消费组"],
    connection: [
      { key: "base_url", value: "https://<待填写>" },
      { key: "api_token", value: "••••••••••••", masked: true },
    ],
  },
  {
    id: "notify-center",
    name: "通知中心 MCP",
    description: "将 Agent 结论转发至团队通知渠道。",
    status: "待配置",
    configSummary: "需要选择通知渠道",
    lastCheckedAt: "尚未检查",
    permissions: ["发送群消息", "读取渠道列表"],
    connection: [
      { key: "channel", value: "<待选择>" },
      { key: "webhook", value: "••••••••••••", masked: true },
    ],
  },
];
