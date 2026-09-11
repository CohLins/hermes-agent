import { useState } from "react";
import { App, Button, Popconfirm, Segmented, Space, Tooltip } from "antd";
import {
  createTask,
  deleteTask,
  getTaskMetrics,
  listTaskRuns,
  listTasks,
  runTaskNow,
  setTaskEnabled,
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
import { toneOfRunResult, toneOfTaskStatus } from "@/components/statusTone";
import { useAsync } from "@/hooks/useAsync";
import RunHistoryTab from "./RunHistoryTab";
import TaskFormModal from "./TaskFormModal";
import type { ScheduledTask, TaskRun } from "@/types";

export default function TasksPage() {
  const { message } = App.useApp();
  const tasks = useAsync(listTasks, []);
  const metrics = useAsync(getTaskMetrics, []);
  const [editing, setEditing] = useState<ScheduledTask | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"list" | "history">("list");
  const [detail, setDetail] = useState<ScheduledTask>();
  const [triggering, setTriggering] = useState(false);
  // 执行记录单独拉：列表只带最近一次状态，明细才需要完整账本。
  const detailKey = detail?.key;
  const runs = useAsync<TaskRun[]>(
    () => (detailKey ? listTaskRuns(detailKey) : Promise.resolve([])),
    [detailKey],
  );

  const reloadAll = () => {
    tasks.reload();
    metrics.reload();
  };

  const submit = async (draft: TaskDraft) => {
    setSaving(true);
    try {
      if (editing) {
        await updateTask(editing.key, draft);
        message.success("任务已保存");
      } else {
        await createTask(draft);
        message.success(
          draft.enabled ? "任务已创建并启用" : "任务已创建，当前为暂停状态，启用后才会执行",
        );
      }
      setEditing(undefined);
      reloadAll();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (task: ScheduledTask) => {
    const enable = task.status === "已暂停";
    try {
      await setTaskEnabled(task.key, enable);
      message.success(`任务已${enable ? "启用" : "暂停"}`);
      reloadAll();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const remove = async (task: ScheduledTask) => {
    try {
      await deleteTask(task.key);
      message.success("任务已删除");
      if (detail?.key === task.key) setDetail(undefined);
      reloadAll();
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const triggerNow = async (task: ScheduledTask) => {
    setTriggering(true);
    try {
      await runTaskNow(task.key);
      message.success("已触发一次执行，结果会推送到通知对象");
      reloadAll();
      setDetail(undefined);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : "触发失败");
    } finally {
      setTriggering(false);
    }
  };

  return (
    <section data-od-id="view-tasks">
      <PageHead
        eyebrow="AUTOMATION"
        title="定时任务管理"
        desc="任务由 Hermes cron 真实调度，与飞书助手共用同一份任务列表。"
        extra={
          <Button type="primary" onClick={() => setEditing(null)}>
            ＋ 新建定时任务
          </Button>
        }
      />

      <MetricRow items={metrics.data ?? []} />

      <Panel
        title={tab === "history" ? "执行历史" : "我的任务"}
        extra={
          <Space>
            <Segmented
              value={tab}
              onChange={(value) => setTab(value as "list" | "history")}
              options={[
                { value: "list", label: "任务列表" },
                { value: "history", label: "执行历史" },
              ]}
            />
            {tab === "list" ? <StatusPill>仅显示自己创建的任务</StatusPill> : null}
          </Space>
        }
        odId="task-panel"
      >
        {tab === "history" ? (
          <RunHistoryTab tasks={tasks.data ?? []} />
        ) : (
        <LoadState loading={tasks.loading} error={tasks.error} onRetry={tasks.reload}>
          <DataTable<ScheduledTask>
            rowKey="key"
            pagination={false}
            dataSource={tasks.data ?? []}
            onRowClick={setDetail}
            // 不用 fixed 固定列：在这套自定义表头样式下它会错位（表头重复、
            // 列顺序跳到别的列前面）。列宽收紧后滚动距离很短，够用。
            scroll={{ x: 1240 }}
            columns={[
              {
                title: "任务名称",
                dataIndex: "name",
                // 故意不设 width：固定列场景需要一列吸收剩余宽度。
                render: (_: unknown, row) => (
                  <div>
                    <div className="cell-clip">{row.name}</div>
                    <Tooltip title={row.summary} placement="topLeft">
                      <div className="user-role cell-clip">{row.summary}</div>
                    </Tooltip>
                  </div>
                ),
              },
              {
                title: "执行频率",
                dataIndex: "frequency",
                width: 150,
                // 表达式是排查时真正要看的，用户写的中文原句放悬停里。
                render: (value: string, row) => (
                  <Tooltip
                    title={row.frequencyHint ? `原始描述：${row.frequencyHint}` : undefined}
                    placement="topLeft"
                  >
                    <span className="num cell-clip" style={{ maxWidth: 132 }}>
                      {value}
                    </span>
                  </Tooltip>
                ),
              },
              { title: "下次执行", dataIndex: "nextRunAt", className: "num", width: 160 },
              { title: "最近执行", dataIndex: "lastRunAt", className: "num", width: 160 },
              { title: "创建时间", dataIndex: "createdAt", className: "num", width: 160 },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value: string) => (
                  <StatusPill tone={toneOfTaskStatus(value)}>{value}</StatusPill>
                ),
              },
              {
                title: "创建人",
                dataIndex: "owner",
                width: 110,
                render: (value: string) => (
                  <span className="cell-clip" style={{ maxWidth: 110 }}>
                    {value}
                  </span>
                ),
              },
              {
                title: "更多操作",
                key: "actions",
                width: 210,
                render: (_: unknown, row) => (
                  <Space onClick={(e) => e.stopPropagation()}>
                    <Button size="small" onClick={() => setEditing(row)}>
                      编辑
                    </Button>
                    {/* 一次性任务跑完就是终点，启用它只会被 cron 以「执行时间已过」拒绝。 */}
                    {row.status === "已完成" ? null : (
                      <Popconfirm
                        title={row.status === "已暂停" ? "确认启用该任务？" : "确认暂停该任务？"}
                        description="启停会改变任务的下次执行时间。"
                        okText="确认"
                        cancelText="取消"
                        onConfirm={() => toggle(row)}
                      >
                        <Button size="small">{row.status === "已暂停" ? "启用" : "暂停"}</Button>
                      </Popconfirm>
                    )}
                    <Popconfirm
                      title="确认删除该任务？"
                      description="删除后任务不再执行，也无法恢复；已有的执行记录会保留在执行历史里。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => remove(row)}
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </LoadState>
        )}
      </Panel>

      <TaskFormModal
        key={editing === undefined ? "task-form-closed" : (editing?.key ?? "task-form-new")}
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
                执行频率：<span className="num">{detail.frequency}</span>
                {detail.scheduleText ? `（原始描述：${detail.scheduleText}）` : null}
                <br />
                通知对象：{detail.notify}
                <br />
                下次执行：<span className="num">{detail.nextRunAt}</span>
                <br />
                最近执行：<span className="num">{detail.lastRunAt}</span>
                <br />
                创建时间：<span className="num">{detail.createdAt}</span>
                <br />
                创建人：{detail.owner}
                <br />
                当前状态：{detail.status}
              </p>
              {detail.lastError ? (
                <p style={{ color: "var(--danger)" }}>最近一次错误：{detail.lastError}</p>
              ) : null}
            </DetailBlock>
            <DetailBlock title="最近执行记录">
              <LoadState loading={runs.loading} error={runs.error} onRetry={runs.reload} rows={2}>
                {(runs.data ?? []).length === 0 ? (
                  <p>该任务尚未执行过。</p>
                ) : (
                  (runs.data ?? []).map((run) => (
                    <div key={run.key} style={{ marginBottom: 14 }}>
                      <p>
                        <StatusPill tone={toneOfRunResult(run.result)}>{run.result}</StatusPill>
                        {"　"}
                        <span className="num">
                          {run.startedAt} → {run.finishedAt}
                        </span>
                      </p>
                      <p>
                        耗时：{run.duration}
                        {"　"}
                        触发来源：{run.source}
                      </p>
                      {run.error ? (
                        <p style={{ color: "var(--danger)" }}>错误原因：{run.error}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </LoadState>
              <p className="field-help">完整历史见上方「执行历史」，可按任务和时间范围筛选。</p>
            </DetailBlock>
            <DetailBlock title="操作">
              <Button type="primary" loading={triggering} onClick={() => triggerNow(detail)}>
                立即执行一次
              </Button>
            </DetailBlock>
          </>
        ) : null}
      </DetailDrawer>
    </section>
  );
}
