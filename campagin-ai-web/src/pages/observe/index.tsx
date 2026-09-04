import { useState } from "react";
import { App, Select, Switch, Tabs } from "antd";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getKafkaPanel,
  getSlowApiPanel,
  getSlowSqlPanel,
  getStatusPanel,
} from "@/api/observe";
import DataTable from "@/components/DataTable";
import DetailDrawer, { DetailBlock } from "@/components/DetailDrawer";
import LoadState from "@/components/LoadState";
import MetricRow from "@/components/MetricRow";
import PageHead from "@/components/PageHead";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { toneOfServiceStatus } from "@/components/statusTone";
import TrendBars from "@/components/TrendBars";
import { DEFAULT_TIME_RANGE, TIME_RANGES } from "@/constants";
import { useAsync } from "@/hooks/useAsync";
import TraceTab from "./TraceTab";
import type { ObserveTabKey, TopologyNode, TraceResult, TraceSpan } from "@/types";

const TABS: { key: ObserveTabKey; label: string }[] = [
  { key: "status", label: "服务状态" },
  { key: "sql", label: "慢 SQL" },
  { key: "api", label: "慢接口" },
  { key: "trace", label: "链路分析" },
  { key: "kafka", label: "Kafka 看板" },
];

type DrawerState = { title: string; eyebrow: string; body: React.ReactNode } | undefined;

export default function ObservePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const active = (TABS.find((x) => x.key === tab)?.key ?? "status") as ObserveTabKey;

  // 时间范围与自动刷新是页面级上下文，切 Tab 时保留。
  const [range, setRange] = useState<string>(DEFAULT_TIME_RANGE);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>();

  const analyzeInAgent = (subject: string) => (
    <Link to="/" onClick={() => message.info(`已把「${subject}」的上下文带回对话首页（模拟）`)}>
      在 Agent 中分析
    </Link>
  );

  return (
    <section data-od-id="view-observe">
      <PageHead
        eyebrow="OBSERVABILITY"
        title="服务可观测"
        desc="按条件发起 Mock 查询，查看服务状态、性能证据和链路图。"
        extra={
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Select
              value={range}
              onChange={setRange}
              style={{ width: 150 }}
              options={TIME_RANGES.map((x) => ({ value: x, label: x }))}
              aria-label="时间范围"
            />
            <span className="user-role" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} aria-label="自动刷新" />
              自动刷新
            </span>
            <StatusPill>单一工作区 · 示例数据</StatusPill>
          </div>
        }
      />

      <Tabs
        activeKey={active}
        onChange={(key) => navigate(`/observe/${key}`)}
        items={TABS.map((x) => ({ key: x.key, label: x.label }))}
      />

      {active === "status" ? <StatusTab range={range} onOpen={setDrawer} analyze={analyzeInAgent} /> : null}
      {active === "sql" ? <SlowSqlTab range={range} onOpen={setDrawer} analyze={analyzeInAgent} /> : null}
      {active === "api" ? <SlowApiTab range={range} onOpen={setDrawer} analyze={analyzeInAgent} /> : null}
      {active === "kafka" ? <KafkaTab range={range} onOpen={setDrawer} analyze={analyzeInAgent} /> : null}
      {active === "trace" ? (
        <TraceTab
          onOpenSpan={(span: TraceSpan, traceId: string) =>
            setDrawer({
              title: span.name,
              eyebrow: "SPAN DETAIL",
              body: (
                <>
                  <DetailBlock title="Span 概览">
                    <p>
                      类型：{span.kindLabel}
                      <br />
                      耗时：{span.duration}
                      <br />
                      Trace ID：{traceId}
                      <br />
                      服务：{span.service}
                    </p>
                  </DetailBlock>
                  {span.evidence ? (
                    <DetailBlock title="慢查询证据">
                      <div className="code">{span.evidence}</div>
                    </DetailBlock>
                  ) : null}
                  <DetailBlock title="下一步">{analyzeInAgent(span.name)}</DetailBlock>
                </>
              ),
            })
          }
          onOpenNode={(node: TopologyNode) =>
            setDrawer({
              title: node.label,
              eyebrow: "SERVICE NODE",
              body: (
                <>
                  <DetailBlock title="服务节点">
                    <p>
                      节点耗时：{node.meta}
                      <br />
                      该节点来自当前查询生成的本地 Mock 服务拓扑。
                    </p>
                  </DetailBlock>
                  <DetailBlock title="下一步">{analyzeInAgent(node.label)}</DetailBlock>
                </>
              ),
            })
          }
          onOpenTrace={(result: TraceResult, query) =>
            setDrawer({
              title: `Trace ${result.traceId}`,
              eyebrow: "TRACE SUMMARY",
              body: (
                <>
                  <DetailBlock title="查询条件">
                    <p>
                      接口路径：{query.keyword}
                      <br />
                      入口服务：{query.service}
                      <br />
                      时间范围：{query.range}
                    </p>
                  </DetailBlock>
                  <DetailBlock title="异常摘要">
                    {result.insights.map((x) => (
                      <p key={x.title}>
                        {x.title}：{x.detail}
                      </p>
                    ))}
                  </DetailBlock>
                  <DetailBlock title="下一步">{analyzeInAgent(`Trace ${result.traceId}`)}</DetailBlock>
                </>
              ),
            })
          }
        />
      ) : null}

      <DetailDrawer
        open={!!drawer}
        title={drawer?.title ?? "详情"}
        eyebrow={drawer?.eyebrow}
        onClose={() => setDrawer(undefined)}
      >
        {drawer?.body}
      </DetailDrawer>
    </section>
  );
}

interface TabProps {
  range: string;
  onOpen: (state: DrawerState) => void;
  analyze: (subject: string) => React.ReactNode;
}

function StatusTab({ range, onOpen, analyze }: TabProps) {
  const state = useAsync(getStatusPanel, [range]);
  return (
    <>
      <MetricRow items={state.data?.metrics ?? []} />
      <Panel
        title="服务健康概览"
        extra={<StatusPill>{range} · 示例数据</StatusPill>}
        odId="observe-status-panel"
      >
        <LoadState loading={state.loading} error={state.error} onRetry={state.reload}>
          <TrendBars values={state.data?.trend ?? []} />
          <DataTable
            rowKey="key"
            pagination={false}
            dataSource={state.data?.rows ?? []}
            onRowClick={(row) =>
              onOpen({
                title: row.service,
                eyebrow: "SERVICE DETAIL",
                body: (
                  <>
                    <DetailBlock title="服务状态">
                      <p>
                        状态：{row.status}
                        <br />
                        实例数：{row.instances}
                        <br />
                        错误率：{row.errorRate}
                        <br />
                        P95 延迟：{row.p95}
                        <br />
                        数据窗口：{range}
                      </p>
                    </DetailBlock>
                    <DetailBlock title="下一步">{analyze(row.service)}</DetailBlock>
                  </>
                ),
              })
            }
            columns={[
              { title: "服务", dataIndex: "service" },
              {
                title: "状态",
                dataIndex: "status",
                render: (value: string) => <StatusPill tone={toneOfServiceStatus(value)}>{value}</StatusPill>,
              },
              { title: "实例", dataIndex: "instances", className: "num" },
              { title: "错误率", dataIndex: "errorRate", className: "num" },
              { title: "P95 延迟", dataIndex: "p95", className: "num" },
            ]}
          />
        </LoadState>
      </Panel>
    </>
  );
}

function SlowSqlTab({ range, onOpen, analyze }: TabProps) {
  const state = useAsync(getSlowSqlPanel, [range]);
  return (
    <>
      <MetricRow items={state.data?.metrics ?? []} />
      <Panel title="慢 SQL 明细" extra={<StatusPill>{range} · 示例数据</StatusPill>} odId="observe-sql-panel">
        <LoadState loading={state.loading} error={state.error} onRetry={state.reload}>
          <DataTable
            rowKey="key"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            dataSource={state.data?.rows ?? []}
            onRowClick={(row) =>
              onOpen({
                title: "慢 SQL 详情",
                eyebrow: "SLOW SQL",
                body: (
                  <>
                    <DetailBlock title="SQL 摘要">
                      <div className="code">{row.digest}</div>
                    </DetailBlock>
                    <DetailBlock title="执行统计">
                      <p>
                        调用服务：{row.service}
                        <br />
                        平均耗时：{row.avgCost}
                        <br />
                        最大耗时：{row.maxCost}
                        <br />
                        出现次数：{row.count}
                        <br />
                        最近出现：{row.lastSeenAt}
                      </p>
                    </DetailBlock>
                    <DetailBlock title="下一步">{analyze(row.digest)}</DetailBlock>
                  </>
                ),
              })
            }
            columns={[
              { title: "SQL 摘要", dataIndex: "digest", ellipsis: true, width: 340 },
              { title: "服务", dataIndex: "service" },
              { title: "平均耗时", dataIndex: "avgCost", className: "num", sorter: (a, b) => a.avgCost.localeCompare(b.avgCost) },
              { title: "最大耗时", dataIndex: "maxCost", className: "num" },
              { title: "出现次数", dataIndex: "count", className: "num", sorter: (a, b) => Number(a.count) - Number(b.count) },
              { title: "最近时间", dataIndex: "lastSeenAt", className: "num" },
            ]}
          />
        </LoadState>
      </Panel>
    </>
  );
}

function SlowApiTab({ range, onOpen, analyze }: TabProps) {
  const state = useAsync(getSlowApiPanel, [range]);
  return (
    <>
      <MetricRow items={state.data?.metrics ?? []} />
      <Panel title="慢接口明细" extra={<StatusPill>{range} · 示例数据</StatusPill>} odId="observe-api-panel">
        <LoadState loading={state.loading} error={state.error} onRetry={state.reload}>
          <DataTable
            rowKey="key"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            dataSource={state.data?.rows ?? []}
            onRowClick={(row) =>
              onOpen({
                title: row.path,
                eyebrow: "SLOW API",
                body: (
                  <>
                    <DetailBlock title="接口信息">
                      <p>
                        方法：{row.method}
                        <br />
                        服务：{row.service}
                        <br />
                        P50 / P95：{row.latency}
                        <br />
                        错误率：{row.errorRate}
                        <br />
                        最近请求：{row.lastRequestAt}
                      </p>
                    </DetailBlock>
                    <DetailBlock title="下一步">{analyze(row.path)}</DetailBlock>
                  </>
                ),
              })
            }
            columns={[
              { title: "接口", dataIndex: "path", width: 260 },
              { title: "方法", dataIndex: "method" },
              { title: "服务", dataIndex: "service" },
              { title: "P50 / P95", dataIndex: "latency", className: "num" },
              { title: "错误率", dataIndex: "errorRate", className: "num", sorter: (a, b) => parseFloat(a.errorRate) - parseFloat(b.errorRate) },
              { title: "最近请求", dataIndex: "lastRequestAt", className: "num" },
            ]}
          />
        </LoadState>
      </Panel>
    </>
  );
}

function KafkaTab({ range, onOpen, analyze }: TabProps) {
  const state = useAsync(getKafkaPanel, [range]);
  const [group, setGroup] = useState<string>("all");
  const rows = (state.data?.rows ?? []).filter((x) => group === "all" || x.consumerGroup === group);
  const groups = Array.from(new Set((state.data?.rows ?? []).map((x) => x.consumerGroup)));

  return (
    <>
      <MetricRow items={state.data?.metrics ?? []} />
      <div className="toolbar">
        <Select
          value={group}
          onChange={setGroup}
          style={{ width: 220 }}
          options={[{ value: "all", label: "全部消费组" }, ...groups.map((x) => ({ value: x, label: x }))]}
          aria-label="消费组筛选"
        />
      </div>
      <Panel title="Kafka 看板" extra={<StatusPill>{range} · 示例数据</StatusPill>} odId="observe-kafka-panel">
        <LoadState loading={state.loading} error={state.error} onRetry={state.reload}>
          <DataTable
            rowKey="key"
            pagination={false}
            dataSource={rows}
            onRowClick={(row) =>
              onOpen({
                title: row.topic,
                eyebrow: "KAFKA TOPIC",
                body: (
                  <>
                    <DetailBlock title="Topic 概览">
                      <p>
                        消费组：{row.consumerGroup}
                        <br />
                        积压量：{row.backlog}
                        <br />
                        生产速率：{row.produceRate}
                        <br />
                        状态：{row.status}
                      </p>
                    </DetailBlock>
                    <DetailBlock title="阈值配置">
                      <p>
                        该 Topic 的积压阈值在 <Link to="/settings/topics">设置 · Topic 配置</Link> 中维护。
                      </p>
                    </DetailBlock>
                    <DetailBlock title="下一步">{analyze(row.topic)}</DetailBlock>
                  </>
                ),
              })
            }
            columns={[
              { title: "Topic", dataIndex: "topic", className: "num", width: 240 },
              { title: "消费组", dataIndex: "consumerGroup", className: "num" },
              { title: "积压量", dataIndex: "backlog", className: "num", sorter: (a, b) => Number(a.backlog.replace(/,/g, "")) - Number(b.backlog.replace(/,/g, "")) },
              { title: "生产速率", dataIndex: "produceRate", className: "num" },
              {
                title: "状态",
                dataIndex: "status",
                render: (value: string) => <StatusPill tone={toneOfServiceStatus(value)}>{value}</StatusPill>,
              },
            ]}
          />
        </LoadState>
      </Panel>
    </>
  );
}
