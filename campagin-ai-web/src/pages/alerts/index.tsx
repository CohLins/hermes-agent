import { useMemo, useState } from "react";
import { App, Button, Input, Select, Space } from "antd";
import { Link } from "react-router-dom";
import {
  acknowledgeAlert,
  addAlertNote,
  assignAlert,
  closeAlert,
  getAlertMetrics,
  listAlerts,
} from "@/api/alerts";
import DataTable from "@/components/DataTable";
import DetailDrawer, { DetailBlock } from "@/components/DetailDrawer";
import EmptyBlock from "@/components/EmptyBlock";
import LoadState from "@/components/LoadState";
import MetricRow from "@/components/MetricRow";
import PageHead from "@/components/PageHead";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { toneOfAlertLevel, toneOfAlertStatus } from "@/components/statusTone";
import { CURRENT_USER } from "@/constants";
import { useAsync } from "@/hooks/useAsync";
import CloseAlertModal from "./CloseAlertModal";
import type { AlertItem } from "@/types";

export default function AlertsPage() {
  const { message } = App.useApp();
  const alerts = useAsync(listAlerts, []);
  const metrics = useAsync(getAlertMetrics, []);
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [detailKey, setDetailKey] = useState<string>();
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);

  const services = useMemo(
    () => Array.from(new Set((alerts.data ?? []).map((x) => x.service))),
    [alerts.data],
  );

  const rows = useMemo(
    () =>
      (alerts.data ?? []).filter(
        (x) =>
          (level === "all" || x.level === level) &&
          (status === "all" || x.status === status) &&
          (service === "all" || x.service === service),
      ),
    [alerts.data, level, status, service],
  );

  const detail = (alerts.data ?? []).find((x) => x.key === detailKey);
  const hasFilter = level !== "all" || status !== "all" || service !== "all";

  const clearFilters = () => {
    setLevel("all");
    setStatus("all");
    setService("all");
  };

  const run = async (action: () => Promise<void>, tip: string) => {
    setSaving(true);
    try {
      await action();
      message.success(tip);
      alerts.reload();
      metrics.reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-od-id="view-alerts">
      <PageHead
        eyebrow="INCIDENTS"
        title="告警管理"
        desc="集中处理服务与任务的模拟异常。"
        extra={
          <Button
            onClick={() => {
              alerts.reload();
              metrics.reload();
              message.success("列表已刷新，仍为本地模拟数据");
            }}
          >
            刷新告警
          </Button>
        }
      />

      <MetricRow items={metrics.data ?? []} />

      <div className="toolbar">
        <Select
          value={level}
          onChange={setLevel}
          style={{ width: 130 }}
          options={[
            { value: "all", label: "全部级别" },
            { value: "高", label: "高" },
            { value: "中", label: "中" },
            { value: "低", label: "低" },
          ]}
          aria-label="告警级别筛选"
        />
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 140 }}
          options={[
            { value: "all", label: "全部状态" },
            { value: "未处理", label: "未处理" },
            { value: "处理中", label: "处理中" },
            { value: "已关闭", label: "已关闭" },
          ]}
          aria-label="处理状态筛选"
        />
        <Select
          value={service}
          onChange={setService}
          style={{ width: 200 }}
          options={[{ value: "all", label: "全部服务" }, ...services.map((x) => ({ value: x, label: x }))]}
          aria-label="服务筛选"
        />
        {hasFilter ? (
          <Button type="text" onClick={clearFilters}>
            清除筛选
          </Button>
        ) : null}
      </div>

      <Panel odId="alert-panel">
        <LoadState loading={alerts.loading} error={alerts.error} onRetry={alerts.reload}>
          {rows.length === 0 ? (
            <EmptyBlock
              title="没有匹配的告警"
              desc="当前筛选条件下没有告警记录。"
              action={<Button onClick={clearFilters}>清除筛选</Button>}
            />
          ) : (
            <DataTable<AlertItem>
              rowKey="key"
              pagination={false}
              dataSource={rows}
              onRowClick={(row) => {
                setDetailKey(row.key);
                setNote("");
              }}
              columns={[
                {
                  title: "级别",
                  dataIndex: "level",
                  render: (value: string) => <StatusPill tone={toneOfAlertLevel(value)}>{value}</StatusPill>,
                },
                { title: "告警标题", dataIndex: "title", width: 240 },
                { title: "关联服务", dataIndex: "service" },
                { title: "来源", dataIndex: "source" },
                { title: "首次发生", dataIndex: "firstSeenAt", className: "num" },
                { title: "最近发生", dataIndex: "lastSeenAt", className: "num" },
                { title: "持续时长", dataIndex: "duration", className: "num" },
                {
                  title: "处理状态",
                  dataIndex: "status",
                  render: (value: string) => <StatusPill tone={toneOfAlertStatus(value)}>{value}</StatusPill>,
                },
                { title: "负责人", dataIndex: "owner" },
              ]}
            />
          )}
        </LoadState>
      </Panel>

      <DetailDrawer
        open={!!detail}
        eyebrow="ALERT DETAIL"
        title={detail?.title ?? "告警详情"}
        onClose={() => setDetailKey(undefined)}
        extra={detail ? <StatusPill tone={toneOfAlertStatus(detail.status)}>{detail.status}</StatusPill> : null}
      >
        {detail ? (
          <>
            <DetailBlock title="告警描述">
              <p>{detail.description}</p>
            </DetailBlock>
            <DetailBlock title="触发条件">
              <p>
                {detail.condition}
                <br />
                关联服务：{detail.service}
                <br />
                来源：{detail.source}
                <br />
                负责人：{detail.owner}
              </p>
            </DetailBlock>
            <DetailBlock title="时间线">
              {detail.timeline.map((item, i) => (
                <p key={i}>
                  <span className="num">{item.at}</span>{"\u3000"}{item.text}
                </p>
              ))}
            </DetailBlock>
            <DetailBlock title="关联对象">
              <div className="evidence-links">
                {detail.relations.map((item) => (
                  <Link key={item.label} to={item.to}>
                    {item.label}
                  </Link>
                ))}
              </div>
            </DetailBlock>
            <DetailBlock title="处理记录">
              {detail.notes.length === 0 ? <p>暂无处理记录。</p> : null}
              {detail.notes.map((item, i) => (
                <p key={i}>
                  <span className="num">{item.at}</span>{"\u3000"}{item.author}：{item.text}
                </p>
              ))}
              <Input.TextArea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="添加备注，说明当前证据与下一步动作"
                style={{ marginTop: 10 }}
              />
              <Button
                style={{ marginTop: 8 }}
                loading={saving}
                onClick={() => {
                  if (!note.trim()) {
                    message.warning("请先填写备注内容");
                    return;
                  }
                  run(() => addAlertNote(detail.key, CURRENT_USER.name, note.trim()), "备注已添加").then(() =>
                    setNote(""),
                  );
                }}
              >
                添加备注
              </Button>
            </DetailBlock>
            <DetailBlock title="操作">
              <Space wrap>
                <Button
                  type="primary"
                  disabled={detail.status !== "未处理"}
                  loading={saving}
                  onClick={() => run(() => acknowledgeAlert(detail.key, CURRENT_USER.name), "告警已确认")}
                >
                  确认
                </Button>
                <Button
                  disabled={detail.status === "已关闭"}
                  loading={saving}
                  onClick={() => run(() => assignAlert(detail.key, CURRENT_USER.name), `已分派给 ${CURRENT_USER.name}`)}
                >
                  分派给我
                </Button>
                <Button danger disabled={detail.status === "已关闭"} onClick={() => setClosing(true)}>
                  关闭
                </Button>
              </Space>
            </DetailBlock>
          </>
        ) : null}
      </DetailDrawer>

      <CloseAlertModal
        open={closing}
        saving={saving}
        onCancel={() => setClosing(false)}
        onSubmit={(values) => {
          if (!detail) return;
          run(() => closeAlert(detail.key, values.reason, values.conclusion), "告警已关闭").then(() =>
            setClosing(false),
          );
        }}
      />
    </section>
  );
}
