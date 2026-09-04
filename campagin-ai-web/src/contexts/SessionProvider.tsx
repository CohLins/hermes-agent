import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getRun, listSessions } from "@/api/agent";
import { listPendingSessions, readPendingRun, writePendingRun } from "@/api/pendingRuns";
import type { PendingRun } from "@/api/pendingRuns";
import { useAsync } from "@/hooks/useAsync";
import { isTerminalRunStatus } from "@/types/agent";
import { SessionContext } from "./sessionContext";

const WATCH_INTERVAL = 2000;

/**
 * 当前会话 id、会话列表、以及「哪些会话在跑」提到路由之上。
 *
 * Sidebar 点击历史要驱动首页加载对应会话，而 Sidebar 和 chat 页在 AppShell 里
 * 是兄弟节点，没法靠 props 传。运行状态也必须放在这里：切走之后 useAgentRun
 * 已经卸掉了那一轮的流，只有全局层面还知道后台有 run 没跑完。
 */
export default function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // 刷新后从 sessionStorage 重建，否则侧栏会漏掉后台仍在跑的会话。
  const [runningSessions, setRunningSessions] = useState<string[]>(() => listPendingSessions());
  const { data, loading, error, reload } = useAsync(() => listSessions(), []);

  const openSession = useCallback((next: string | null) => setSessionId(next), []);

  const setSessionRunning = useCallback((id: string, record: PendingRun | null) => {
    if (!id) return;
    writePendingRun(id, record);
    setRunningSessions((prev) => {
      const has = prev.includes(id);
      if (record && !has) return [...prev, id];
      if (!record && has) return prev.filter((x) => x !== id);
      return prev;
    });
  }, []);

  /**
   * 后台守望：轮询每个登记在跑的 run，终态就摘掉标识并刷新列表。
   *
   * 必须在 Provider 这一层做 —— 用户切到别的会话（甚至别的页面）后，
   * useAgentRun 的那份轮询已经随会话切换停掉了，没人来清这个标识。
   * setState 只发生在 then 里，不在 effect 体内同步调用。
   */
  useEffect(() => {
    if (runningSessions.length === 0) return;
    let stopped = false;
    let timer = 0;

    const tick = () => {
      const checks = runningSessions.map(async (id) => {
        const pending = readPendingRun(id);
        if (!pending) return { id, finished: true };
        try {
          const status = await getRun(pending.runId);
          return { id, finished: isTerminalRunStatus(status.status) };
        } catch {
          // 404 说明已过 _RUN_STATUS_TTL（3600s），当作结束，别让标识常亮。
          return { id, finished: true };
        }
      });

      Promise.all(checks).then((results) => {
        if (stopped) return;
        const finished = results.filter((x) => x.finished).map((x) => x.id);
        if (finished.length > 0) {
          finished.forEach((id) => writePendingRun(id, null));
          setRunningSessions((prev) => prev.filter((x) => !finished.includes(x)));
          reload();
        } else {
          timer = window.setTimeout(tick, WATCH_INTERVAL);
        }
      });
    };

    timer = window.setTimeout(tick, WATCH_INTERVAL);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [runningSessions, reload]);

  const value = useMemo(
    () => ({
      sessionId,
      openSession,
      sessions: data ?? [],
      sessionsLoading: loading,
      sessionsError: error,
      refreshSessions: reload,
      runningSessions,
      setSessionRunning,
    }),
    [sessionId, openSession, data, loading, error, reload, runningSessions, setSessionRunning],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
