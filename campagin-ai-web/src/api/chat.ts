import { delay, mockGet } from "./client";
import { chatSessions, chatSuggestions, mockAnswer } from "@/mock/chat";
import type { ChatAnswer, ChatSession, ChatSuggestion } from "@/types";

export function listChatSessions(): Promise<ChatSession[]> {
  return mockGet(chatSessions, 120);
}

export function getChatSuggestions(): Promise<ChatSuggestion[]> {
  return mockGet(chatSuggestions, 60);
}

/** 阶段一固定返回示例回答；阶段二换成真实 Agent 流式响应。 */
export async function sendChatMessage(question: string): Promise<ChatAnswer> {
  await delay(1400);
  return {
    ...structuredClone(mockAnswer),
    paragraphs: [`针对「${question}」的模拟分析结果：`, ...mockAnswer.paragraphs],
  };
}
