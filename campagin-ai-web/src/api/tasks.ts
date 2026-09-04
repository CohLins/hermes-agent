import { clone, delay, mockGet } from "./client";
import { scheduledTasks, taskMetrics } from "@/mock/tasks";
import type { MetricItem, ScheduledTask, TaskStatus } from "@/types";

/** 阶段一的写操作只改这份内存副本，刷新页面即回到初始状态。 */
let tasks: ScheduledTask[] = clone(scheduledTasks);

export function listTasks(): Promise<ScheduledTask[]> {
  return mockGet(tasks);
}

export function getTaskMetrics(): Promise<MetricItem[]> {
  return mockGet(taskMetrics);
}

export interface TaskDraft {
  name: string;
  summary: string;
  frequency: string;
  dataRange: string;
  notify: string;
  enabled: boolean;
}

export async function createTask(draft: TaskDraft): Promise<ScheduledTask> {
  await delay();
  const task: ScheduledTask = {
    key: `task-${Date.now()}`,
    name: draft.name,
    summary: draft.summary,
    frequency: draft.frequency,
    nextRunAt: "待调度",
    lastRunAt: "—",
    status: draft.enabled ? "运行中" : "已暂停",
    owner: "林晓",
    notify: draft.notify,
    dataRange: draft.dataRange,
    runs: [],
  };
  tasks = [task, ...tasks];
  return clone(task);
}

export async function updateTask(key: string, draft: TaskDraft): Promise<void> {
  await delay();
  tasks = tasks.map((x) =>
    x.key === key
      ? {
          ...x,
          name: draft.name,
          summary: draft.summary,
          frequency: draft.frequency,
          dataRange: draft.dataRange,
          notify: draft.notify,
          status: draft.enabled ? x.status === "已暂停" ? "运行中" : x.status : "已暂停",
        }
      : x,
  );
}

export async function setTaskStatus(key: string, status: TaskStatus): Promise<void> {
  await delay();
  tasks = tasks.map((x) => (x.key === key ? { ...x, status } : x));
}

export async function retryTask(key: string): Promise<void> {
  await delay();
  tasks = tasks.map((x) =>
    x.key === key
      ? {
          ...x,
          status: "运行中",
          lastRunAt: "刚刚",
          runs: [
            { key: `r-${Date.now()}`, startedAt: "刚刚", finishedAt: "刚刚", result: "成功", tools: "模拟重试" },
            ...x.runs,
          ],
        }
      : x,
  );
}
