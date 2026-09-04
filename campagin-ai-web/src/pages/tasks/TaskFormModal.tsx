import { Form, Input, Modal, Select, Switch } from "antd";
import { useEffect } from "react";
import { taskFrequencies } from "@/mock/tasks";
import { TIME_RANGES } from "@/constants";
import type { TaskDraft } from "@/api/tasks";
import type { ScheduledTask } from "@/types";

interface Props {
  open: boolean;
  /** 传入任务表示编辑，null 表示新建。 */
  task: ScheduledTask | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: TaskDraft) => void;
}

export default function TaskFormModal({ open, task, saving, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<TaskDraft>();

  // 编辑时回填原任务内容，防止误覆盖。
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(
      task
        ? {
            name: task.name,
            summary: task.summary,
            frequency: task.frequency,
            dataRange: task.dataRange,
            notify: task.notify,
            enabled: task.status !== "已暂停",
          }
        : {
            name: "",
            summary: "",
            frequency: taskFrequencies[1],
            dataRange: TIME_RANGES[1],
            notify: "",
            enabled: true,
          },
    );
  }, [open, task, form]);

  return (
    <Modal
      open={open}
      title={task ? "编辑定时任务" : "新建定时任务"}
      okText={task ? "保存" : "创建"}
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => form.submit()}
      width={640}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
        <Form.Item name="name" label="任务名称" rules={[{ required: true, message: "请填写任务名称" }]}>
          <Input placeholder="例如：支付服务错误巡检" />
        </Form.Item>
        <Form.Item
          name="summary"
          label="任务内容（自然语言描述）"
          rules={[{ required: true, message: "请描述任务要做什么" }]}
        >
          <Input.TextArea rows={3} placeholder="例如：检查 payment-service 近 30 分钟的错误日志，出现集中报错时给出归因结论。" />
        </Form.Item>
        <div className="form-grid">
          <Form.Item name="frequency" label="执行频率" rules={[{ required: true, message: "请选择执行频率" }]}>
            <Select options={taskFrequencies.map((x) => ({ value: x, label: x }))} />
          </Form.Item>
          <Form.Item name="dataRange" label="数据范围" rules={[{ required: true, message: "请选择数据范围" }]}>
            <Select options={TIME_RANGES.map((x) => ({ value: x, label: x }))} />
          </Form.Item>
        </div>
        <Form.Item name="notify" label="通知对象" rules={[{ required: true, message: "请填写通知对象" }]}>
          <Input placeholder="例如：支付值班群" />
        </Form.Item>
        <Form.Item name="enabled" label="创建后立即启用" valuePropName="checked">
          <Switch />
        </Form.Item>
        <p className="field-help">阶段一不会真实触发定时任务，保存后只更新本地演示状态。</p>
      </Form>
    </Modal>
  );
}
