import { LoadingOutlined } from "@ant-design/icons";
import { formatElapsed, useElapsed } from "@/hooks/useElapsed";
import {
  STALL_THRESHOLD_MS,
  currentActivity,
  recentTools,
  sinceLastEvent,
} from "./format";
import { parseReasoningSteps } from "./reasoning";
import type { Turn } from "@/types/agent";

const ACTIVITY_TEXT = {
  deciding: "正在决定下一步",
  writing: "正在写回答",
} as const;

/** 取最新一段推理的最后一个步骤标题，作为「它在想什么」的单行提示。 */
function latestNarration(turn: Turn): string {
  const last = turn.reasoning[turn.reasoning.length - 1];
  if (!last) return "";
  const steps = parseReasoningSteps(last);
  const step = steps[steps.length - 1];
  return (step?.title || step?.body || "").split("\n")[0].trim();
}

/**
 * 进行中气泡里的实时进度面板。
 *
 * 长任务是常态（profile 的 agent.max_turns=90、gateway_timeout=1800，一轮跑
 * 几十分钟合法），所以这几分钟里必须一直有变化的信息，而不是一句静态文案。
 * 四块内容分别由 tool.started / tool.completed / reasoning.available / 计时器驱动。
 *
 * 进度条是**不确定态**：SSE 里没有任何总量信息（拿不到已用几轮、max_turns 还剩
 * 多少），编一个百分比比没有更糟。
 */
export default function RunProgress({ turn }: { turn: Turn }) {
  const live = useElapsed(true, turn.startedAt);
  const elapsed = formatElapsed(live);

  const total = turn.tools.length;
  const failed = turn.tools.filter((x) => x.failed).length;
  const toolCost = turn.tools.reduce((sum, x) => sum + (x.duration ?? 0), 0);
  const activity = currentActivity(turn.tools, turn.answer);
  const idleFor = sinceLastEvent(turn.startedAt, live, turn.lastEventAt);
  // 有在跑的工具就不算停滞：那时我们清楚它在干什么（实测单个 search_files
  // 能跑 60s），该报的是这个工具已经跑了多久。
  const stalled = activity.kind !== "tool" && idleFor >= STALL_THRESHOLD_MS;
  // 当前工具已执行时长。startedAt 是 tool.started 到达的时刻。
  const pendingTool = turn.tools.find((x) => !x.done);
  const toolFor =
    pendingTool?.startedAt !== undefined
      ? sinceLastEvent(turn.startedAt, live, pendingTool.startedAt)
      : 0;

  const counts = (
    <span className="rp-counts">
      {total > 0 ? `${total} 个工具` : "尚未调用工具"}
      {failed > 0 ? (
        <>
          {" · "}
          <span className="rp-failed">{failed} 失败</span>
        </>
      ) : null}
      {toolCost > 0 ? ` · 工具累计 ${toolCost.toFixed(2)}s` : ""}
    </span>
  );

  // 回答已经在流出时，把面板压成一行，主体位置让给正文。
  if (turn.answer) {
    return (
      <div className="run-progress slim" data-od-id="run-progress">
        <LoadingOutlined />
        <span className="rp-elapsed">{elapsed || "刚开始"}</span>
        {counts}
      </div>
    );
  }

  const narration = latestNarration(turn);

  return (
    <div className="run-progress" data-od-id="run-progress">
      {/* 不再重复「执行中」—— 气泡顶部的 agent-label 已经在说了。 */}
      <div className="rp-head">
        <span className="rp-elapsed">{elapsed || "刚开始"}</span>
        <span className="rp-bar" aria-hidden />
      </div>

      <div className="rp-now">
        <LoadingOutlined />
        {activity.kind === "tool" ? (
          <>
            <code>{activity.tool}</code>
            {activity.preview ? <em>{activity.preview}</em> : null}
            {/* 慢工具的唯一线索：它已经跑了多久。 */}
            {formatElapsed(toolFor) ? (
              <span className="num rp-tool-for">已 {formatElapsed(toolFor)}</span>
            ) : null}
          </>
        ) : (
          <span>{ACTIVITY_TEXT[activity.kind]}</span>
        )}
      </div>

      <div className="rp-stat">{counts}</div>

      {(() => {
        const recent = recentTools(turn.tools);
        if (recent.length === 0) return null;
        return (
          <div className="rp-recent">
            <div className="rp-recent-head">最近</div>
            {recent.map((tool) => (
              <div className={`rp-recent-row${tool.failed ? " failed" : ""}`} key={tool.id}>
                <span className="rp-mark">{tool.failed ? "✗" : "✓"}</span>
                <code>{tool.tool}</code>
                <em>{tool.preview ?? ""}</em>
                <span className="num">
                  {tool.duration !== undefined ? `${tool.duration.toFixed(2)}s` : ""}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {narration ? <div className="rp-narration">「{narration}」</div> : null}

      {stalled ? (
        <div className="rp-stall">
          已 {Math.round(idleFor / 1000)}s 没有新动作 —— 可能在生成长回答，也可能卡住了，
          可点右下角中断。
        </div>
      ) : null}
    </div>
  );
}
