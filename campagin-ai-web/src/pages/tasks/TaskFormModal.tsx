import { useCallback, useRef, useState } from "react";
import { Alert, AutoComplete, Form, Input, Modal, Select, Switch } from "antd";
import {
  formatScheduleRun,
  listFeishuChats,
  parseSchedule,
  type TaskDraft,
} from "@/api/tasks";
import { useAsync } from "@/hooks/useAsync";
import type { ScheduledTask, SchedulePreview } from "@/types";

/** 常用写法提示；频率字段本身允许任意中文，解析在服务端。 */
const SCHEDULE_SUGGESTIONS = [
  "每 15 分钟",
  "每 30 分钟",
  "每小时",
  "每天 09:00",
  "每天早上 9 点",
  "每天凌晨 2 点",
  "每周一 09:00",
  "每个工作日 08:30",
];

const PREVIEW_SOURCE_TEXT: Record<string, string> = {
  rule: "按常用写法识别",
  passthrough: "按 cron 表达式识别",
  llm: "由模型识别",
};

const NAME_MAX = 200;
const PROMPT_MAX = 5000;
const SCHEDULE_MAX = 200;

interface Props {
  open: boolean;
  /** 传入任务表示编辑，null 表示新建。 */
  task: ScheduledTask | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: TaskDraft) => void;
}

/**
 * 表单初值。父组件用 key 让每次打开都挂一个新实例，所以初值只在挂载时算一次，
 * 不需要在 effect 里回填 —— 也就不会出现上次编辑的残留。
 */
function initialDraft(task: ScheduledTask | null): TaskDraft {
  if (!task) {
    return {
      name: "",
      summary: "",
      scheduleText: "",
      notifyKind: "self",
      notifyChatId: undefined,
      // 新建默认关闭，确认无误后再手动启用。
      enabled: false,
    };
  }
  return {
    name: task.name,
    summary: task.summary,
    scheduleText: task.scheduleText,
    notifyKind: task.notifyKind,
    notifyChatId: task.notifyChatId,
    enabled: task.status !== "已暂停",
  };
}

export default function TaskFormModal({ open, task, saving, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<TaskDraft>();
  const notifyKind = Form.useWatch("notifyKind", form);
  const scheduleText = (Form.useWatch("scheduleText", form) ?? "").trim();
  // 群列表要走飞书 API + 逐群成员校验，只在弹窗真的打开时拉。
  const chats = useAsync(() => (open ? listFeishuChats() : Promise.resolve([])), [open]);
  const [preview, setPreview] = useState<SchedulePreview>();
  const [previewError, setPreviewError] = useState<{ text: string; message: string }>();
  const [previewing, setPreviewing] = useState(false);
  // 只认最后一次解析请求的结果，避免快速改动时旧响应覆盖新响应。
  const previewSeq = useRef(0);

  // 回显是否还对得上输入框里的内容 —— 改了字就自动失效，不需要在 effect 里清状态。
  const previewMatches = !!preview && preview.display === scheduleText;
  const errorMatches = !!previewError && previewError.text === scheduleText;
  // 编辑时没动过频率，说明这句话服务端早就解析过了，不必再点一次解析。
  const pristineSchedule = !!task && scheduleText === task.scheduleText.trim();
  const scheduleReady = previewMatches || pristineSchedule;
  const previewIsOnce = previewMatches && !!preview?.once;

  const runPreview = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const seq = previewSeq.current + 1;
    previewSeq.current = seq;
    setPreviewing(true);
    try {
      const result = await parseSchedule(trimmed);
      if (previewSeq.current !== seq) return;
      setPreview(result);
      setPreviewError(undefined);
    } catch (err: unknown) {
      if (previewSeq.current !== seq) return;
      setPreview(undefined);
      setPreviewError({
        text: trimmed,
        message: err instanceof Error ? err.message : "解析失败，请稍后重试",
      });
    } finally {
      if (previewSeq.current === seq) setPreviewing(false);
    }
  }, []);

  return (
    <Modal
      open={open}
      title={task ? "编辑定时任务" : "新建定时任务"}
      okText={task ? "保存" : "创建"}
      cancelText="取消"
      confirmLoading={saving}
      // 频率没解析通过就不让提交：宁可多点一次「解析」，也不要建出跑错时间的任务。
      // 按钮禁用时给出原因，否则用户只看到点不动的按钮。
      okButtonProps={{
        disabled: !scheduleReady,
        title: scheduleReady ? undefined : "请先在执行频率右侧点「解析」，确认识别出的执行时间",
      }}
      onCancel={onCancel}
      onOk={() => form.submit()}
      width={640}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} initialValues={initialDraft(task)}>
        <Form.Item
          name="name"
          label="任务名称"
          rules={[
            { required: true, whitespace: true, message: "请填写任务名称" },
            { max: NAME_MAX, message: `任务名称不能超过 ${NAME_MAX} 个字` },
          ]}
        >
          <Input placeholder="例如：支付服务错误巡检" maxLength={NAME_MAX} showCount />
        </Form.Item>
        <Form.Item
          name="summary"
          label="任务内容（自然语言描述）"
          rules={[
            { required: true, whitespace: true, message: "请描述任务要做什么" },
            { max: PROMPT_MAX, message: `任务内容不能超过 ${PROMPT_MAX} 个字` },
          ]}
        >
          <Input.TextArea
            rows={3}
            maxLength={PROMPT_MAX}
            placeholder="例如：检查 payment-service 近 30 分钟的错误日志，出现集中报错时给出归因结论。"
          />
        </Form.Item>
        <Form.Item
          name="scheduleText"
          label="执行频率（用中文描述）"
          rules={[
            { required: true, whitespace: true, message: "请描述什么时候执行" },
            { max: SCHEDULE_MAX, message: `执行频率不能超过 ${SCHEDULE_MAX} 个字` },
          ]}
          extra="写完点右侧「解析」确认识别结果。周期：每 30 分钟、每天早上 9 点、每周一 09:00；只跑一次：5 分钟后、明天早上 9 点执行一次；也可直接写 cron 表达式。"
        >
          <AutoComplete
            options={SCHEDULE_SUGGESTIONS.map((value) => ({ value }))}
            // v6 起 filterOption 挪进 showSearch；顶层写法已废弃。
            showSearch={{
              filterOption: (input, option) =>
                String(option?.value ?? "").toLowerCase().includes(input.toLowerCase()),
            }}
            // 点下拉选项不会触发 Input.Search 的 onSearch，这里补一次解析。
            onSelect={(value: string) => void runPreview(value)}
          >
            <Input.Search
              placeholder="每天早上 9 点"
              enterButton="解析"
              loading={previewing}
              maxLength={SCHEDULE_MAX}
              onSearch={(value) => void runPreview(value)}
            />
          </AutoComplete>
        </Form.Item>

        {previewMatches && preview ? (
          <>
            <Alert
              type="success"
              showIcon
              style={{ marginBottom: 10 }}
              message={
                <span>
                  cron 表达式 <span className="num">{preview.schedule}</span>
                </span>
              }
              description={`${preview.description} · ${
                PREVIEW_SOURCE_TEXT[preview.source] ?? preview.source
              }`}
            />
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={
                preview.once ? "执行时间（只执行一次）" : `接下来 ${preview.nextRuns.length} 次执行`
              }
              description={
                preview.nextRuns.length === 0 ? (
                  "算不出后续执行时间，请换个写法。"
                ) : (
                  <div className="num" style={{ lineHeight: 1.9 }}>
                    {preview.nextRuns.map((run) => (
                      <div key={run}>{formatScheduleRun(run)}</div>
                    ))}
                  </div>
                )
              }
            />
          </>
        ) : null}
        {errorMatches && previewError ? (
          // 直接用服务端文案：「没识别出执行时间」和「解析服务暂时不可用」
          // 要让用户分得清哪个是自己该改的。
          <Alert type="error" showIcon style={{ marginBottom: 16 }} message={previewError.message} />
        ) : null}
        {!scheduleReady && !errorMatches && scheduleText ? (
          <p className="field-help" style={{ marginTop: -8, marginBottom: 16 }}>
            频率改动后需要重新点「解析」才能提交。
          </p>
        ) : null}

        <div className="form-grid">
          <Form.Item
            name="notifyKind"
            label="通知对象"
            rules={[{ required: true, message: "请选择通知对象" }]}
          >
            <Select
              options={[
                { value: "self", label: "我（飞书私聊）" },
                { value: "group", label: "指定群" },
                { value: "none", label: "不推送，只在这里看" },
              ]}
            />
          </Form.Item>
          {notifyKind === "group" ? (
            <Form.Item
              name="notifyChatId"
              label="选择群聊"
              rules={[{ required: true, message: "请选择要推送的群" }]}
              extra={chats.error ?? "只列出你和助手都在的群。"}
            >
              <Select
                showSearch
                loading={chats.loading}
                optionFilterProp="label"
                placeholder="选择群聊"
                options={(chats.data ?? []).map((chat) => ({
                  value: chat.chatId,
                  label: chat.name,
                }))}
                notFoundContent={chats.loading ? "加载中…" : "没有你和助手都在的群"}
              />
            </Form.Item>
          ) : null}
        </div>
        {task || previewIsOnce ? null : (
          <Form.Item name="enabled" label="创建后立即启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
        <p className="field-help">
          {task
            ? "保存后按新的频率重新排期。"
            : previewIsOnce
              ? "一次性任务创建后立即生效 —— 暂停会让它错过唯一的执行时间。"
              : "默认创建为已暂停，确认无误后在列表里手动启用。"}
        </p>
      </Form>
    </Modal>
  );
}
