import { createContext } from "react";
import type { PendingRun } from "@/api/pendingRuns";
import type { AgentSession } from "@/types/agent";

export interface SessionContextValue {
  /** 当前打开的会话；null 表示新对话（首轮发送时才真正建会话）。 */
  sessionId: string | null;
  /** 点击历史、点「对话首页」或「新建」。 */
  openSession: (sessionId: string | null) => void;
  /** 会话列表（Sidebar 与 chat 页共用一份，避免两次请求）。 */
  sessions: AgentSession[];
  sessionsLoading: boolean;
  sessionsError: string | undefined;
  /** 发完一轮、重命名、删除后调用，重拉列表。 */
  refreshSessions: () => void;
  /**
   * 有未终结 run 的会话 id。切到别的会话后 run 仍在后台跑，
   * 侧栏靠这个显示运行中标识。
   */
  runningSessions: string[];
  /** 起 run 时登记，终态时传 null 注销。同时落 sessionStorage 以撑过刷新。 */
  setSessionRunning: (sessionId: string, record: PendingRun | null) => void;
}

/** 单独一个模块：Provider 组件文件里再导出 hook 会触发 react-refresh/only-export-components。 */
export const SessionContext = createContext<SessionContextValue | null>(null);
