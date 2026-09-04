import { useEffect, useRef, useState } from "react";
import { LoadingOutlined } from "@ant-design/icons";
import { countByTool } from "./format";
import type { ToolTrace } from "@/types/agent";

/** null = 全部；"__failed__" = 只看失败；其余是工具名。 */
type Filter = string | null;

const FAILED = "__failed__";

/**
 * 工具明细的紧凑时序表。
 *
 * 替掉原来每条一个 .detail-block（约 96px）的渲染 —— 83 条会把页面撑到 8000px，
 * 而「2 个失败」埋在中间根本找不到。这里一行 ≈26px、限高内部滚动、可按失败或
 * 工具名筛选，并**保留执行顺序**：看「它到底干了什么」靠的就是顺序。
 *
 * 用新 class（.tool-table 前缀）：.detail-block / .tool-preview 被 DetailDrawer
 * 和定时任务页共用，不能为这里改。
 */
export default function ToolTable({
  tools,
  running,
}: {
  tools: ToolTrace[];
  running: boolean;
}) {
  const [filter, setFilter] = useState<Filter>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // 用户手动滚上去看历史时不要再把他拽回底部。
  const stickRef = useRef(true);

  const failedCount = tools.filter((x) => x.failed).length;
  const groups = countByTool(tools);

  const shown =
    filter === null
      ? tools
      : filter === FAILED
        ? tools.filter((x) => x.failed)
        : tools.filter((x) => x.tool === filter);

  // 进行中跟随最新一条。setState 不参与，只操作 DOM，所以不违反 set-state-in-effect。
  useEffect(() => {
    if (!running || !stickRef.current) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [running, tools.length, filter]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  };

  return (
    <div className="tool-table">
      <div className="tool-table-filters">
        <button
          type="button"
          className={`tt-chip${filter === null ? " active" : ""}`}
          onClick={() => setFilter(null)}
        >
          全部 <span className="num">{tools.length}</span>
        </button>
        {failedCount > 0 ? (
          <button
            type="button"
            className={`tt-chip danger${filter === FAILED ? " active" : ""}`}
            onClick={() => setFilter(FAILED)}
          >
            失败 <span className="num">{failedCount}</span>
          </button>
        ) : null}
        {groups.map((g) => (
          <button
            key={g.tool}
            type="button"
            className={`tt-chip${filter === g.tool ? " active" : ""}`}
            onClick={() => setFilter(g.tool)}
          >
            {g.tool} <span className="num">{g.count}</span>
          </button>
        ))}
      </div>

      <div className="tool-table-list" ref={listRef} onScroll={onScroll}>
        {shown.length === 0 ? (
          <div className="tt-empty">没有匹配的调用</div>
        ) : (
          shown.map((tool) => {
            const open = expanded === tool.id;
            return (
              <div key={tool.id}>
                <button
                  type="button"
                  className={`tt-row${tool.failed ? " failed" : ""}${open ? " open" : ""}`}
                  onClick={() => setExpanded(open ? null : tool.id)}
                  title={tool.preview ?? tool.tool}
                >
                  <span className="tt-mark">
                    {tool.done ? (tool.failed ? "✗" : "✓") : <LoadingOutlined />}
                  </span>
                  <code className="tt-name">{tool.tool}</code>
                  <span className="tt-cost num">
                    {tool.duration !== undefined ? `${tool.duration.toFixed(2)}s` : "…"}
                  </span>
                  <span className="tt-preview">{tool.preview ?? ""}</span>
                </button>
                {open && tool.preview ? <pre className="tt-full">{tool.preview}</pre> : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
