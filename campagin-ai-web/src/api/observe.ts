import { ApiError, delay, mockGet } from "./client";
import {
  apiMetrics,
  kafkaMetrics,
  kafkaRows,
  serviceStatusRows,
  slowApiRows,
  slowSqlRows,
  sqlMetrics,
  statusMetrics,
  statusTrend,
} from "@/mock/observe";
import { traceResult, traceServices } from "@/mock/trace";
import type {
  KafkaRow,
  MetricItem,
  ServiceStatusRow,
  SlowApiRow,
  SlowSqlRow,
  TraceQuery,
  TraceResult,
} from "@/types";

export interface StatusPanel {
  metrics: MetricItem[];
  trend: number[];
  rows: ServiceStatusRow[];
}

export function getStatusPanel(): Promise<StatusPanel> {
  return mockGet({ metrics: statusMetrics, trend: statusTrend, rows: serviceStatusRows });
}

export function getSlowSqlPanel(): Promise<{ metrics: MetricItem[]; rows: SlowSqlRow[] }> {
  return mockGet({ metrics: sqlMetrics, rows: slowSqlRows });
}

export function getSlowApiPanel(): Promise<{ metrics: MetricItem[]; rows: SlowApiRow[] }> {
  return mockGet({ metrics: apiMetrics, rows: slowApiRows });
}

export function getKafkaPanel(): Promise<{ metrics: MetricItem[]; rows: KafkaRow[] }> {
  return mockGet({ metrics: kafkaMetrics, rows: kafkaRows });
}

export function getTraceServices(): Promise<string[]> {
  return mockGet(traceServices);
}

/** 链路分析是按需查询：未提交条件时页面不请求，提交后才拿结果。 */
export async function queryTrace(query: TraceQuery): Promise<TraceResult> {
  await delay(500);
  if (!query.keyword.trim()) {
    throw new ApiError("请填写接口路径或 Trace ID");
  }
  return { ...structuredClone(traceResult) };
}
