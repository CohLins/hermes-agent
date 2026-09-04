import type { TraceResult } from "@/types";

/** 数据来自设计原型 index.html:46-47（spans / 拓扑 SVG / 分析结论）。 */
export const traceResult: TraceResult = {
  traceId: "tr_8af2c91d",
  ruler: ["0 ms", "312 ms", "624 ms", "936 ms", "1,248 ms"],
  summary: [
    { label: "异常 Trace · 1", tone: "danger" },
    { label: "总耗时 · 1,248 ms", tone: "neutral" },
    { label: "Span · 7", tone: "neutral" },
    { label: "慢 SQL · 684 ms", tone: "warn" },
  ],
  insights: [
    { title: "主要瓶颈", detail: "inventory-service 占用 926 ms，其中 SQL Span 为 684 ms。" },
    { title: "异常信号", detail: "数据库等待占比过高，建议继续查看索引与锁等待。" },
  ],
  topology: {
    viewBox: "0 0 760 280",
    edges: [
      { path: "M130 130H250" },
      { path: "M370 130L490 55" },
      { path: "M370 130L490 205" },
      { path: "M610 55H700" },
      { path: "M370 130H490", slow: true },
      { path: "M610 205H700", slow: true },
    ],
    nodes: [
      { id: "API Gateway", label: "API Gateway", meta: "入口 · 12 ms", x: 20, y: 100, width: 110 },
      { id: "order-api", label: "order-api", meta: "1,248 ms", x: 250, y: 100, width: 120 },
      { id: "user-center", label: "user-center", meta: "124 ms", x: 490, y: 25, width: 120 },
      { id: "inventory-service", label: "inventory-service", meta: "926 ms · 慢", x: 490, y: 175, width: 120, slow: true },
      { id: "payment-service", label: "payment", meta: "74 ms", x: 700, y: 175, width: 55 },
    ],
  },
  spans: [
    { id: "root", name: "GET /api/v2/orders/{id}", kindLabel: "入口", kind: "root", depth: 0, offset: 0, width: 100, duration: "1,248 ms", service: "order-api" },
    { id: "controller", name: "OrderController.getDetail", kindLabel: "CTRL", kind: "root", depth: 1, offset: 0.5, width: 98.5, duration: "1,230 ms", service: "order-api" },
    { id: "profile", name: "Feign GET /profile/v1/users/{id}", kindLabel: "RPC", kind: "remote", depth: 2, offset: 3, width: 10, duration: "124 ms", service: "user-center" },
    { id: "inventory", name: "Feign POST /inventory/v1/reserve", kindLabel: "RPC", kind: "remote", depth: 2, offset: 15, width: 75, duration: "926 ms", service: "inventory-service" },
    { id: "redis", name: "Redis GET inventory:sku:10892", kindLabel: "CACHE", kind: "cache", depth: 3, offset: 17, width: 2.4, duration: "30 ms", service: "inventory-service · redis-01" },
    {
      id: "sql",
      name: "SELECT stock FROM sku_inventory WHERE sku_id = ?",
      kindLabel: "DB",
      kind: "database",
      depth: 3,
      offset: 21,
      width: 55,
      duration: "684 ms",
      service: "inventory-service · mysql-cluster-01",
      evidence: "SELECT stock FROM sku_inventory\nWHERE sku_id = ?\nFOR UPDATE",
    },
    { id: "payment", name: "Feign POST /payment/v1/query", kindLabel: "RPC", kind: "remote", depth: 2, offset: 91, width: 6, duration: "74 ms", service: "payment-service" },
  ],
};

export const traceServices = ["order-api", "payment-service", "inventory-service"];
