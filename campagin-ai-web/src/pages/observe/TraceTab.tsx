import { useState } from "react";
import { App, Button, Input, Select } from "antd";
import { getTraceServices, queryTrace } from "@/api/observe";
import { DEFAULT_TIME_RANGE, TIME_RANGES } from "@/constants";
import EmptyBlock from "@/components/EmptyBlock";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { useAsync } from "@/hooks/useAsync";
import type { TraceResult, TraceSpan, TopologyNode } from "@/types";

interface Props {
  onOpenSpan: (span: TraceSpan, traceId: string) => void;
  onOpenNode: (node: TopologyNode) => void;
  onOpenTrace: (result: TraceResult, query: { keyword: string; service: string; range: string }) => void;
}

/** 链路分析是按需查询：未提交条件前不请求，也不自动刷新（原型 tracePanel）。 */
export default function TraceTab({ onOpenSpan, onOpenNode, onOpenTrace }: Props) {
  const { message } = App.useApp();
  const { data: services } = useAsync(getTraceServices, []);
  const [keyword, setKeyword] = useState("/api/v2/orders/{id}");
  const [service, setService] = useState("order-api");
  const [range, setRange] = useState<string>(DEFAULT_TIME_RANGE);
  const [result, setResult] = useState<TraceResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const run = async () => {
    setLoading(true);
    setError(undefined);
    setResult(undefined);
    try {
      const next = await queryTrace({ keyword, service, range });
      setResult(next);
      message.success("链路分析已生成模拟报告");
    } catch (err) {
      setError(err instanceof Error ? err.message : "查询失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <div className="observe-query" data-od-id="trace-query">
      <div className="observe-query-head">
        <div>
          <div className="observe-query-title">链路分析条件</div>
          <p className="observe-query-note">
            输入接口路径或 Trace ID、入口服务和时间范围后发起一次查询。页面不会自动刷新。
          </p>
        </div>
        <StatusPill tone={result ? "success" : "neutral"}>{result ? "查询完成" : "按需查询"}</StatusPill>
      </div>
      <div className="query-fields">
        <div className="query-field">
          <label htmlFor="trace-keyword">接口路径或 Trace ID</label>
          <Input id="trace-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </div>
        <div className="query-field">
          <label htmlFor="trace-service">入口服务</label>
          <Select
            id="trace-service"
            value={service}
            onChange={setService}
            options={(services ?? []).map((x) => ({ value: x, label: x }))}
          />
        </div>
        <div className="query-field">
          <label htmlFor="trace-range">时间范围</label>
          <Select
            id="trace-range"
            value={range}
            onChange={setRange}
            options={TIME_RANGES.map((x) => ({ value: x, label: x }))}
          />
        </div>
        <Button type="primary" onClick={run} loading={loading}>
          查询链路
        </Button>
      </div>
      <div className="query-status">
        {result
          ? "已生成一份模拟报告 · 不会自动刷新"
          : "尚未查询 · 请选择条件后获取结果"}
      </div>
    </div>
  );

  if (loading) {
    return (
      <>
        {form}
        <EmptyBlock title="正在执行模拟链路查询…" desc="查询过程约 0.5 秒，完成后展示拓扑图与 Span 时间轴。" />
      </>
    );
  }

  if (error) {
    return (
      <>
        {form}
        <EmptyBlock
          title="链路查询失败"
          desc={error}
          action={
            <Button type="primary" onClick={run}>
              重试
            </Button>
          }
        />
      </>
    );
  }

  if (!result) {
    return (
      <>
        {form}
        <EmptyBlock title="等待发起链路分析" desc="查询后将展示服务拓扑图与 Span 时间轴链路图。" />
      </>
    );
  }

  return (
    <>
      {form}
      <div className="trace-summary">
        {result.summary.map((item) => (
          <StatusPill key={item.label} tone={item.tone}>
            {item.label}
          </StatusPill>
        ))}
      </div>

      <div className="trace-layout">
        <Panel className="topology-panel">
          <h3>服务拓扑图</h3>
          <p>红色路径表示本次链路中的主要耗时瓶颈，点击节点查看详情。</p>
          <div className="topology-canvas">
            <svg viewBox={result.topology.viewBox} role="img" aria-label="服务调用拓扑图">
              {result.topology.edges.map((edge, i) => (
                <path key={i} className={edge.slow ? "topology-edge slow" : "topology-edge"} d={edge.path} />
              ))}
              {result.topology.nodes.map((node) => (
                <g
                  key={node.id}
                  className={node.slow ? "topology-node slow" : "topology-node"}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.label} 节点详情`}
                  onClick={() => onOpenNode(node)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenNode(node);
                    }
                  }}
                >
                  <rect x={node.x} y={node.y} width={node.width} height={60} rx={8} />
                  <text x={node.x + node.width / 2} y={node.y + 26} textAnchor="middle" fontSize={node.width < 80 ? 11 : 13}>
                    {node.label}
                  </text>
                  <text className="node-meta" x={node.x + node.width / 2} y={node.y + 46} textAnchor="middle">
                    {node.meta}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </Panel>

        <Panel className="trace-insight">
          <h3>分析结论</h3>
          {result.insights.map((item) => (
            <div className="insight-item" key={item.title}>
              <strong>{item.title}</strong>
              <p className="insight-copy">{item.detail}</p>
            </div>
          ))}
          <div className="insight-item">
            <Button type="text" onClick={() => onOpenTrace(result, { keyword, service, range })}>
              查看 Trace 摘要
            </Button>
          </div>
        </Panel>
      </div>

      <Panel className="waterfall">
        <div className="waterfall-head">
          <h3>Span 链路时间轴</h3>
          <p>展示父子层级、并行调用、起始位置和持续时间，点击任意 Span 查看详情。</p>
        </div>
        <div className="waterfall-ruler">
          <span>Span 名称</span>
          <span className="ruler-ticks">
            {result.ruler.map((tick) => (
              <i key={tick}>{tick}</i>
            ))}
          </span>
        </div>
        <div className="waterfall-body">
          {result.spans.map((span) => (
            <button
              key={span.id}
              type="button"
              className="waterfall-row"
              data-od-id={`span-${span.id}`}
              onClick={() => onOpenSpan(span, result.traceId)}
            >
              <div className="span-name">
                <i className="span-depth" style={{ ["--depth" as string]: span.depth }} />
                <span className="span-kind">{span.kindLabel}</span>
                <span className="span-label">{span.name}</span>
                <span className="span-duration">{span.duration}</span>
              </div>
              <div className="span-track">
                <span
                  className={`span-bar ${span.kind}`}
                  style={{ left: `${span.offset}%`, width: `${span.width}%` }}
                >
                  {span.width > 16 ? span.duration : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      </Panel>
    </>
  );
}
