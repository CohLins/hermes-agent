import { CURRENT_USER, DEFAULT_TIME_RANGE } from "@/constants";
import type { PersonalSettings } from "@/types";

/** 数据来自设计原型 index.html:50 的个人配置面板；Key 与 Token 仅展示遮蔽形态。 */
export const personalSettings: PersonalSettings = {
  name: CURRENT_USER.name,
  defaultRange: DEFAULT_TIME_RANGE,
  openaiApiKey: "sk-mock-••••••••••••",
  agentToken: "agt-mock-••••••••••••",
  answerMode: "显示工具调用摘要",
  notifyEmail: CURRENT_USER.email,
};

export const answerModes = ["显示工具调用摘要", "仅显示结论"];
