import { useState } from "react";
import { App, Button, Popconfirm, Space } from "antd";
import {
  createTask,
  getTaskMetrics,
  listTasks,
  retryTask,
  setTaskStatus,
  updateTask,
  type TaskDraft,
} from "@/api/tasks";
import DataTable from "@/components/DataTable";
import DetailDrawer, { DetailBlock } from "@/components/DetailDrawer";
import LoadState from "@/components/LoadState";
import MetricRow from "@/components/MetricRow";
import PageHead from "@/components/PageHead";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { toneOfTaskStatus } from "@/components/statusTone";
import { useAsync } from "@/hooks/useAsync";
import TaskFormModal from "./TaskFormModal";
import type { ScheduledTask } from "@/types";

export default function TasksPage() {
  const { message } = App.useApp();
  const tasks = useAsync(listTasks, []);
  const metrics = useAsync(getTaskMetrics, []);
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ScheduledTask>();

  const submit = async (draft: TaskDraft) => {
    setSaving(true);
    try {
      if (editing) {
        await updateTask(editing.key, draft);
        message.success("任务已保存到本地演示状态");
      } else {
        await createTask(draft);
        message.success("任务已创建到本地演示状态");
      }
      setEditing(undefined);
      tasks.reload();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (task: ScheduledTask) => {
    const next = task.status === "已暂停" ? "运行中" : "已暂停";
    await setTaskStatus(task.key, next);
    message.success(`任务已${next === "运行中" ? "启用" : "暂停"}（模拟操作）`);
    tasks.reload();
  };

  return (
    <section data-od-id="view-tasks">
      <PageHead
        eyebrow="AUTOMATION"
        title="定时任务管理"
        desc="任务执行结果为本地 Mock，不触发真实定时任务。"
        extra={
          <Button type="primary" onClick={() => setEditing(null)}>
            ＋ 新建定时任务
          </Button>
        }
      />

      <MetricRow items={metrics.data ?? []} />

      <Panel title="全部任务" extra={<StatusPill>示例数据 · 模拟状态</StatusPill>} odId="task-panel">
        <LoadState loading={tasks.loading} error={tasks.error} onRetry={tasks.reload}>
          <DataTable<ScheduledTask>
            rowKey="key"
            pagination={false}
            dataSource={tasks.data ?? []}
            onRowClick={setDetail}
            columns={[
              {
                title: "任务名称",
                dataIndex: "name",
                width: 240,
                render: (_: unknown, row) => (
                  <div>
                    <div>{row.name}</div>
                    <div className="user-role" style={{ whiteSpace: "normal", maxWidth: 320 }}>
                      {row.summary}
                    </div>
                  </div>
                ),
              },
              { title: "执行频率", dataIndex: "frequency" },
              { title: "下次执行", dataIndex: "nextRunAt", className: "num" },
              { title: "最近执行", dataIndex: "lastRunAt", className: "num" },
              {
                title: "状态",
                dataIndex: "status",
                render: (value: string) => <StatusPill tone={toneOfTaskStatus(value)}>{value}</StatusPill>,
              },
              { title: "创建人", dataIndex: "owner" },
              {
                title: "更多操作",
                key: "actions",
                render: (_: unknown, row) => (
                  <Space onClick={(e) => e.stopPropagation()}>
                    <Button size="small" onClick={() => setEditing(row)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title={row.status === "已暂停" ? "确认启用该任务？" : "确认暂停该任务？"}
                      description="启停会改变任务的下次执行时间（阶段一仅为模拟）。"
                      okText="确认"
                      cancelText="取消"
                      onConfirm={() => toggle(row)}
                    >
                      <Button size="small">{row.status === "已暂停" ? "启用" : "暂停"}</Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </LoadState>
      </Panel>

      <TaskFormModal
        open={editing !== undefined}
        task={editing ?? null}
        saving={saving}
        onCancel={() => setEditing(undefined)}
        onSubmit={submit}
      />

      <DetailDrawer
        open={!!detail}
        eyebrow="TASK RUNS"
        title={detail?.name ?? "运行记录"}
        onClose={() => setDetail(undefined)}
      >
        {detail ? (
          <>
            <DetailBlock title="任务信息">
              <p>
                任务内容：{detail.summary}
                <br />
                执行频率：{detail.frequency}
                <br />
                数据范围：{detail.dataRange}
                <br />
                通知对象：{detail.notify}
                <br />
                当前状态：{detail.status}
              </p>
            </DetailBlock>
            <DetailBlock title="执行记录">
              {detail.runs.length === 0 ? (
                <p>该任务尚未执行过。</p>
              ) : (
                detail.runs.map((run) => (
                  <div key={run.key} style={{ marginBottom: 14 }}>
                    <p>
                      <StatusPill tone={run.result === "成功" ? "success" : "danger"}>{run.result}</StatusPill>
                      {"\u3000"}<span className="num">
                        {run.startedAt} → {run.finishedAt}
                      </span>
                    </p>
                    <p>工具调用：{run.tools}</p>
                    {run.error ? <p style={{ color: "var(--danger)" }}>错误原因：{run.error}</p> : null}
                  </div>
                ))
              )}
            </DetailBlock>
            <DetailBlock title="操作">
              <Button
                type="primary"
                onClick={async () => {
                  await retryTask(detail.key);
                  message.success("已发起一次模拟重试");
                  tasks.reload();
                  setDetail(undefined);
                }}
              >
                重试一次
              </Button>
            </DetailBlock>
          </>
        ) : null}
      </DetailDrawer>
    </section>
  );
}
