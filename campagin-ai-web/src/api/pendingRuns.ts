/**
 * 「这个会话还有没跑完的 run」的本地记录。
 *
 * SSE 流是一次性的：客户端一断开，服务端就在 finally 里 pop 掉事件队列
 * （api_server.py:5184），重连拿 404。但 run 在后台照跑。所以把 run_id 记下来，
 * 刷新页面、或切到别的会话再切回来，都能靠轮询 GET /v1/runs/{id} 把结果补上。
 *
 * 放在 sessionStorage：只对当前标签页有效，正是想要的语义（另一个标签页看不到
 * 也不该抢同一个 run 的流）。
 */

const PREFIX = "campaign-ai:pending-run:";

export interface PendingRun {
  runId: string;
  question: string;
  /** 本轮开始的毫秒时间戳。恢复出来的轮次靠它算真实耗时，而不是从恢复那刻重新计。 */
  startedAt?: number;
}

export function readPendingRun(sessionId: string): PendingRun | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + sessionId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingRun;
    return parsed.runId ? parsed : null;
  } catch {
    return null;
  }
}

export function writePendingRun(sessionId: string, record: PendingRun | null): void {
  if (!sessionId) return;
  try {
    if (record) sessionStorage.setItem(PREFIX + sessionId, JSON.stringify(record));
    else sessionStorage.removeItem(PREFIX + sessionId);
  } catch {
    // 隐私模式下 sessionStorage 会抛：丢掉恢复能力，但不影响正常对话。
  }
}

/** 刷新后重建「哪些会话在跑」，用于侧栏的运行中标识。 */
export function listPendingSessions(): string[] {
  const ids: string[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length));
    }
  } catch {
    // 同上。
  }
  return ids;
}
