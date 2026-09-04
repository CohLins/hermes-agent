import type {
  KafkaRow,
  MetricItem,
  ServiceStatusRow,
  SlowApiRow,
  SlowSqlRow,
} from "@/types";

/** 数据来自设计原型 index.html:45 的 renderObserve。 */

export const statusTrend = [42, 65, 54, 78, 61, 86, 72, 90, 68, 78, 82, 96];

export const statusMetrics: MetricItem[] = [
  { label: "健康服务", value: "12 / 14", change: "示例数据" },
  { label: "数据窗口", value: "30m" },
  { label: "工作区", value: "Mock" },
  { label: "状态", value: "正常" },
];

export const serviceStatusRows: ServiceStatusRow[] = [
  { key: "payment-service", service: "payment-service", status: "健康", instances: "8", errorRate: "0.18%", p95: "142 ms" },
  { key: "order-api", service: "order-api", status: "告警", instances: "6", errorRate: "1.24%", p95: "386 ms" },
  { key: "user-center", service: "user-center", status: "健康", instances: "12", errorRate: "0.06%", p95: "98 ms" },
  { key: "inventory-service", service: "inventory-service", status: "告警", instances: "4", errorRate: "0.92%", p95: "926 ms" },
  { key: "campaign-worker", service: "campaign-worker", status: "离线", instances: "0", errorRate: "—", p95: "—" },
];

export const sqlMetrics: MetricItem[] = [
  { label: "慢 SQL", value: "08", change: "示例数据" },
  { label: "数据窗口", value: "30m" },
  { label: "工作区", value: "Mock" },
  { label: "状态", value: "正常" },
];

export const slowSqlRows: SlowSqlRow[] = [
  {
    key: "sql-1",
    digest: "SELECT orders WHERE user_id = ?",
    service: "order-api",
    avgCost: "486 ms",
    maxCost: "2.8 s",
    count: "42",
    lastSeenAt: "10:12",
  },
  {
    key: "sql-2",
    digest: "UPDATE inventory SET stock = ?",
    service: "inventory-service",
    avgCost: "312 ms",
    maxCost: "1.2 s",
    count: "18",
    lastSeenAt: "10:08",
  },
  {
    key: "sql-3",
    digest: "SELECT stock FROM sku_inventory WHERE sku_id = ? FOR UPDATE",
    service: "inventory-service",
    avgCost: "684 ms",
    maxCost: "3.1 s",
    count: "26",
    lastSeenAt: "10:11",
  },
];

export const apiMetrics: MetricItem[] = [
  { label: "慢接口", value: "06", change: "示例数据" },
  { label: "数据窗口", value: "30m" },
  { label: "工作区", value: "Mock" },
  { label: "状态", value: "正常" },
];

export const slowApiRows: SlowApiRow[] = [
  {
    key: "api-1",
    path: "/api/v2/orders/{id}",
    method: "GET",
    service: "order-api",
    latency: "142 / 812 ms",
    errorRate: "1.24%",
    lastRequestAt: "10:12",
  },
  {
    key: "api-2",
    path: "/api/v1/payments",
    method: "POST",
    service: "payment-service",
    latency: "98 / 426 ms",
    errorRate: "2.10%",
    lastRequestAt: "10:11",
  },
  {
    key: "api-3",
    path: "/api/v1/inventory/reserve",
    method: "POST",
    service: "inventory-service",
    latency: "210 / 926 ms",
    errorRate: "0.86%",
    lastRequestAt: "10:10",
  },
];

export const kafkaMetrics: MetricItem[] = [
  { label: "Topic", value: "07", change: "示例数据" },
  { label: "数据窗口", value: "30m" },
  { label: "工作区", value: "Mock" },
  { label: "状态", value: "正常" },
];

export const kafkaRows: KafkaRow[] = [
  { key: "order-events", topic: "order-events", consumerGroup: "order-worker", backlog: "8,240", produceRate: "1,120 /s", status: "正常" },
  { key: "payment-events", topic: "payment-events", consumerGroup: "payment-worker", backlog: "4,240", produceRate: "680 /s", status: "告警" },
  { key: "campaign_base_topic", topic: "campaign_base_topic", consumerGroup: "campaign-atom", backlog: "12,860", produceRate: "240 /s", status: "告警" },
];
