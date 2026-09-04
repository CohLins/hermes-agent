import type { ToolTrace } from "@/types/agent";

/**
 * 对话区的纯格式化函数。
 *
 * 单独一个模块：这些函数从组件文件里导出会触发
 * react-refresh/only-export-components（模块含非组件导出就无法作为 HMR 边界）。
 */

/** 按工具名去重计数：skill_view×3 · terminal×2。原来是逐个平铺，重复名一长串。 */
export function summarizeTools(tools: ToolTrace[]): string {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.tool, (counts.get(tool.tool) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => (n > 1 ? `${name}×${n}` : name)).join(" · ");
}

/** 当天只显示时分，跨天补上日期。 */
export function formatMessageTime(at: number): string {
  const date = new Date(at);
  const hm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay ? hm : `${date.getMonth() + 1}/${date.getDate()} ${hm}`;
}

/** 按工具名计数，顺序按首次出现。筛选 chip 与摘要行同源。 */
export function countByTool(tools: ToolTrace[]): { tool: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const tool of tools) counts.set(tool.tool, (counts.get(tool.tool) ?? 0) + 1);
  return [...counts.entries()].map(([tool, count]) => ({ tool, count }));
}

/**
 * 进度面板里「最近」那几条。
 *
 * 单纯取末尾 N 条不行：83 个工具里的 2 个失败几乎不可能落在末尾，
 * 那用户就永远看不到失败。所以本轮有失败时，强制让至少一条失败进入这个列表
 * （挤掉最旧的那条），并保持执行顺序。
 */
export function recentTools(tools: ToolTrace[], limit = 3): ToolTrace[] {
  const done = tools.filter((x) => x.done);
  if (done.length <= limit) return done;

  const tail = done.slice(-limit);
  if (tail.some((x) => x.failed)) return tail;

  const lastFailed = [...done].reverse().find((x) => x.failed);
  if (!lastFailed) return tail;
  // 失败那条放最前，保留剩下的最新几条。
  return [lastFailed, ...tail.slice(1)];
}

/** 进行中气泡的当前动作。 */
export type RunActivity =
  | { kind: "tool"; tool: string; preview?: string | null }
  | { kind: "deciding" }
  | { kind: "writing" };

/**
 * 有未完成的工具 → 就是它。
 * 没有未完成工具但也还没有一个字 → 模型在决定下一步（**不是**在生成回答，
 * 原来那句「正在生成回答」在工具批次之间是误导）。
 * 已经有回答文字 → 确实在写了。
 */
export function currentActivity(
  tools: ToolTrace[],
  answer: string,
): RunActivity {
  const pending = tools.find((x) => !x.done);
  if (pending) return { kind: "tool", tool: pending.tool, preview: pending.preview };
  return answer ? { kind: "writing" } : { kind: "deciding" };
}

/**
 * 超过这个时长没有任何事件才提示可能卡住了。
 *
 * 90 秒而不是 60 秒：实测单个 search_files 就跑了 60.3s，而 reasoning_effort
 * 是 max，模型在两批工具之间思考几十秒是正常的。而且**只在没有在跑的工具时**
 * 才判定停滞 —— 有在跑的工具说明我们清楚它在干什么，那时该显示这个工具已经
 * 跑了多久，而不是喊「卡住了」。
 */
export const STALL_THRESHOLD_MS = 90_000;

/**
 * 距上次事件多久（毫秒）。
 * 用 startedAt + live 推算「现在」，避免渲染期调 Date.now()（react-hooks/purity）。
 */
export function sinceLastEvent(startedAt: number, live: number, lastEventAt: number): number {
  return Math.max(0, startedAt + live - lastEventAt);
}

/** 1886400 → 1.89M；长会话的累计 token 用原始数字读不出量级。 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
