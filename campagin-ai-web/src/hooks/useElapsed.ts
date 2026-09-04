import { useEffect, useState } from "react";

/**
 * active 为真时每秒返回一次「距 since 已过去多少毫秒」。
 *
 * setInterval 在 effect 里注册，setState 只发生在 interval 回调里 ——
 * 不在 effect 体内同步调用，满足 react-hooks v7 的 set-state-in-effect
 * （同 src/hooks/useAsync.ts 的处理方式）。
 *
 * active 转 false 后返回值停在最后一次读数上，不清零，这样终态仍能显示总耗时。
 */
export function useElapsed(active: boolean, since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active || since === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, since]);

  if (since === undefined) return 0;
  return Math.max(0, now - since);
}

/** 12.4s / 1m 05s；不足 1 秒不显示，避免刚发出去就闪一个 0.0s。 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return "";
  const total = ms / 1000;
  if (total < 60) return `${total.toFixed(1)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
