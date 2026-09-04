import { useState } from "react";
import { Collapse } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import Markdown from "@/components/Markdown";
import { formatElapsed, useElapsed } from "@/hooks/useElapsed";
import { summarizeTools } from "./format";
import { parseReasoningSteps } from "./reasoning";
import ToolTable from "./ToolTable";
import type { Turn } from "@/types/agent";


export default function TurnDetail({ turn }: { turn: Turn }) {
  // 用户手动开关后就以他为准；null 表示还没手动干预，交给下面的自动策略。
  const [manualKeys, setManualKeys] = useState<string[] | null>(null);

  const isRunning = turn.phase === "running";
  const live = useElapsed(isRunning, turn.startedAt);
  // 终态用记录下来的 endedAt，渲染期不调 Date.now()（react-hooks/purity），
  // 读数也不会随重渲染漂移。
  // 只有两种情况能给耗时：进行中（实时跳）、有 endedAt（固定值）。
  // 历史轮次两者都没有 —— 原来会回落到 live = now - startedAt，
  // 于是一条一小时前的消息显示「60m 00s」，而且每次重挂载还会变大。
  const elapsedText = formatElapsed(
    turn.endedAt ? turn.endedAt - turn.startedAt : isRunning ? live : 0,
  );

  const hasTools = turn.tools.length > 0;
  const hasReasoning = turn.reasoning.length > 0;
  const running = turn.tools.filter((x) => !x.done).length;
  const failed = turn.tools.filter((x) => x.failed).length;
  const totalCost = turn.tools.reduce((sum, x) => sum + (x.duration ?? 0), 0);

  if (!hasTools && !hasReasoning) return null;

  // 进行中自动展开工具面板（这是「在跑什么」的唯一可见处），终态自动收起。
  const autoKeys = running > 0 ? ["tools"] : [];
  const activeKey = manualKeys ?? autoKeys;

  const items = [];

  if (hasTools) {
    items.push({
      key: "tools",
      label: (
        <span>
          已调用 {turn.tools.length} 个能力{"　"}
          {summarizeTools(turn.tools)}
          {running > 0 ? (
            <>
              {"　"}
              <span className="tool-state running">
                <LoadingOutlined /> {running} 个执行中
              </span>
            </>
          ) : null}
          {failed > 0 ? (
            <>
              {"　"}
              <span className="tool-state failed">{failed} 个失败</span>
            </>
          ) : null}
          {totalCost > 0 ? (
            <>
              {"　"}
              <span className="tool-sub">工具 {totalCost.toFixed(2)}s</span>
            </>
          ) : null}
          {elapsedText ? (
            <>
              {"　"}
              {/* 本轮总耗时。工具耗时之和不含模型思考与生成，两个数都要给。 */}
              <span className="num">{elapsedText}</span>
            </>
          ) : null}
        </span>
      ),
      children: <ToolTable tools={turn.tools} running={running > 0} />,
    });
  }

  if (hasReasoning) {
    const blocks = turn.reasoning.map(parseReasoningSteps);
    const stepCount = blocks.reduce((sum, steps) => sum + steps.length, 0);
    items.push({
      key: "reasoning",
      label: (
        <span>
          推理摘要{"　"}
          <span className="num">{stepCount}</span> 步
        </span>
      ),
      children: (
        <div>
          <p className="reasoning-note">
            这是 provider 返回的推理摘要（reasoning_content），不是完整思维链，
            所以固定英文且很简短。
          </p>
          {blocks.map((steps, bi) => (
            <ol className="reasoning-steps" key={bi}>
              {steps.map((step, si) => (
                <li key={si}>
                  {step.title ? <strong>{step.title}</strong> : null}
                  {step.body ? (
                    <div className="reasoning-body">
                      <Markdown>{step.body}</Markdown>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          ))}
        </div>
      ),
    });
  }

  return (
    <div className="tool-row">
      <Collapse
        ghost
        size="small"
        items={items}
        activeKey={activeKey}
        onChange={(keys) => setManualKeys(Array.isArray(keys) ? keys : [keys])}
      />
    </div>
  );
}
