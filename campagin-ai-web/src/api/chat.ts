import { mockGet } from "./client";
import { chatSuggestions } from "@/mock/chat";
import type { ChatSuggestion } from "@/types";

/** 首页建议卡片是静态文案，不需要后端；对话本体走 src/api/agent.ts。 */
export function getChatSuggestions(): Promise<ChatSuggestion[]> {
  return mockGet(chatSuggestions, 60);
}
