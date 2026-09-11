import type { PillTone } from "@/types";

/** 各页面共用的状态 → 语义色映射（与原型的 .pill 修饰类一致）。 */

export function toneOfServiceStatus(status: string): PillTone {
  if (status === "健康" || status === "正常") return "success";
  if (status === "告警") return "warn";
  return "danger";
}

export function toneOfCapabilityStatus(status: string): PillTone {
  if (status === "已启用") return "success";
  // 「未启用」是用户自己关的，不是异常，别用告警色喊人。
  if (status === "未启用") return "neutral";
  return "warn";
}

export function toneOfTaskStatus(status: string): PillTone {
  if (status === "运行中") return "success";
  if (status === "执行失败") return "danger";
  return "warn";
}

export function toneOfAlertLevel(level: string): PillTone {
  if (level === "高") return "danger";
  if (level === "中") return "warn";
  return "neutral";
}

export function toneOfAlertStatus(status: string): PillTone {
  if (status === "未处理") return "danger";
  if (status === "处理中") return "warn";
  return "success";
}
