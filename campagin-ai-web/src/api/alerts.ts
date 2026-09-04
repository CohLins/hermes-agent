import { clone, delay, mockGet } from "./client";
import { alertMetrics, alerts } from "@/mock/alerts";
import type { AlertItem, MetricItem } from "@/types";

let items: AlertItem[] = clone(alerts);

export function listAlerts(): Promise<AlertItem[]> {
  return mockGet(items);
}

export function getAlertMetrics(): Promise<MetricItem[]> {
  return mockGet(alertMetrics);
}

export async function acknowledgeAlert(key: string, owner: string): Promise<void> {
  await delay();
  items = items.map((x) =>
    x.key === key
      ? { ...x, status: "处理中", owner, timeline: [...x.timeline, { at: "刚刚", text: `${owner} 确认告警` }] }
      : x,
  );
}

export async function assignAlert(key: string, owner: string): Promise<void> {
  await delay();
  items = items.map((x) =>
    x.key === key
      ? { ...x, owner, timeline: [...x.timeline, { at: "刚刚", text: `告警分派给 ${owner}` }] }
      : x,
  );
}

export async function addAlertNote(key: string, author: string, text: string): Promise<void> {
  await delay();
  items = items.map((x) =>
    x.key === key ? { ...x, notes: [...x.notes, { at: "刚刚", author, text }] } : x,
  );
}

export async function closeAlert(key: string, reason: string, conclusion: string): Promise<void> {
  await delay();
  items = items.map((x) =>
    x.key === key
      ? {
          ...x,
          status: "已关闭",
          timeline: [...x.timeline, { at: "刚刚", text: `告警关闭，关闭原因：${reason}` }],
          notes: conclusion ? [...x.notes, { at: "刚刚", author: "林晓", text: conclusion }] : x.notes,
        }
      : x,
  );
}
