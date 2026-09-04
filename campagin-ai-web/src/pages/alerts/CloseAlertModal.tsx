import { Form, Input, Modal, Select } from "antd";
import { alertCloseReasons } from "@/mock/alerts";

interface Props {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: { reason: string; conclusion: string }) => void;
}

/** 关闭告警必须填写处理结论或选择关闭原因（plan.md 要求）。 */
export default function CloseAlertModal({ open, saving, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<{ reason: string; conclusion: string }>();

  return (
    <Modal
      open={open}
      title="关闭告警"
      okText="确认关闭"
      cancelText="取消"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} requiredMark={false}>
        <Form.Item name="reason" label="关闭原因" rules={[{ required: true, message: "请选择关闭原因" }]}>
          <Select options={alertCloseReasons.map((x) => ({ value: x, label: x }))} placeholder="请选择" />
        </Form.Item>
        <Form.Item name="conclusion" label="处理结论" rules={[{ required: true, message: "请填写处理结论" }]}>
          <Input.TextArea rows={3} placeholder="说明处置动作与验证结果，便于后续复盘。" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
