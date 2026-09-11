import { useState } from "react";
import { Select } from "antd";
import { listRunHistory } from "@/api/tasks";
import DataTable from "@/components/DataTable";
import LoadState from "@/components/LoadState";
import StatusPill from "@/components/StatusPill";
import { toneOfRunResult } from "@/components/statusTone";
import { useAsync } from "@/hooks/useAsync";
import type { ScheduledTask, TaskRun } from "@/types";

/** 时间范围用预设：执行历史是按"最近多久"翻的，不需要精确到分钟的区间。 */
const RANGES = [
  { value: "1h", label: "最近 1 小时", hours: 1 },
  { value: "24h", label: "最近 24 小时", hours: 24 },
  { value: "7d", label: "最近 7 天", hours: 24 * 7 },
  { value: "30d", label: "最近 30 天", hours: 24 * 30 },
  { value: "all", label: "全部", hours: 0 },
] as const;

const PAGE_SIZE = 20;

function sinceOf(range: string): string | undefined {
  const found = RANGES.find((item) => item.value === range);
  if (!found || found.hours === 0) return undefined;
  return new Date(Date.now() - found.hours * 3_600_000).toISOString();
}

interface Props {
  /** 任务下拉的选项来源，与列表页共用同一份已加载的任务。 */
  tasks: ScheduledTask[];
}

export default function RunHistoryTab({ tasks }: Props) {
  const [taskKey, setTaskKey] = useState<string>();
  const [range, setRange] = useState<string>("24h");
  const [page, setPage] = useState(1);

  const history = useAsync(
    () =>
      listRunHistory({
        taskKey,
        since: sinceOf(range),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    [taskKey ?? "", range, page],
  );

  return (
    <>
      {/* Panel 没开 padded（表格要贴边），筛选栏自己补内边距。 */}
      <div className="toolbar" style={{ padding: "16px 18px 0" }}>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          value={taskKey}
          onChange={(value?: string) => {
            setTaskKey(value);
            setPage(1);
          }}
          placeholder="全部任务"
          style={{ width: 240 }}
          options={tasks.map((task) => ({ value: task.key, label: task.name }))}
          aria-label="按任务过滤"
        />
        <Select
          value={range}
          onChange={(value: string) => {
            setRange(value);
            setPage(1);
          }}
          style={{ width: 150 }}
          options={RANGES.map((item) => ({ value: item.value, label: item.label }))}
          aria-label="时间范围"
        />
        <StatusPill>共 {history.data?.total ?? 0} 条</StatusPill>
      </div>

      <LoadState loading={history.loading} error={history.error} onRetry={history.reload}>
        <DataTable<TaskRun>
          rowKey="key"
          dataSource={history.data?.runs ?? []}
          scroll={{ x: 1100 }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: history.data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            size: "small",
          }}
          columns={[
            {
              title: "任务名称",
              dataIndex: "taskName",
              render: (value: string) => (
                <span className="cell-clip">{value || "—"}</span>
              ),
            },
            { title: "开始时间", dataIndex: "startedAt", className: "num", width: 190 },
            { title: "结束时间", dataIndex: "finishedAt", className: "num", width: 190 },
            { title: "耗时", dataIndex: "duration", className: "num", width: 100 },
            {
              title: "结果",
              dataIndex: "result",
              width: 100,
              render: (value: string) => (
                <StatusPill tone={toneOfRunResult(value)}>{value}</StatusPill>
              ),
            },
            { title: "触发来源", dataIndex: "source", width: 120 },
            {
              title: "错误原因",
              dataIndex: "error",
              width: 240,
              render: (value?: string) =>
                value ? (
                  <span className="cell-clip" title={value} style={{ color: "var(--danger)" }}>
                    {value}
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </LoadState>
    </>
  );
}
