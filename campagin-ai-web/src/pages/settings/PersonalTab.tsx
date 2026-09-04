import { useEffect, useState } from "react";
import { App, Button, Form, Input, Select } from "antd";
import { getPersonalSettings, savePersonalSettings } from "@/api/settings";
import LoadState from "@/components/LoadState";
import Panel from "@/components/Panel";
import StatusPill from "@/components/StatusPill";
import { TIME_RANGES } from "@/constants";
import { answerModes } from "@/mock/personal";
import { useAsync } from "@/hooks/useAsync";
import type { PersonalSettings } from "@/types";

export default function PersonalTab() {
  const { message } = App.useApp();
  const state = useAsync(getPersonalSettings, []);
  const [form] = Form.useForm<PersonalSettings>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.data) form.setFieldsValue(state.data);
  }, [state.data, form]);

  const submit = async (values: PersonalSettings) => {
    setSaving(true);
    try {
      await savePersonalSettings(values);
      message.success("个人配置已保存到本地演示状态");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-layout">
      <Panel className="settings-panel" odId="personal-config-panel">
        <div className="settings-panel-head">
          <div>
            <h3>个人配置</h3>
            <p>用于 Agent 会话与外部工具调用的本地演示参数。</p>
          </div>
          <StatusPill tone="warn">敏感值已遮蔽</StatusPill>
        </div>
        <LoadState loading={state.loading} error={state.error} onRetry={state.reload}>
          <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
            <div className="form-grid">
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: "请填写姓名" }]}>
                <Input />
              </Form.Item>
              <Form.Item name="defaultRange" label="默认时间范围">
                <Select options={TIME_RANGES.map((x) => ({ value: x, label: x }))} />
              </Form.Item>
              <Form.Item name="openaiApiKey" label="OpenAI API Key">
                <Input.Password />
              </Form.Item>
              <Form.Item name="agentToken" label="Agent Token">
                <Input.Password />
              </Form.Item>
              <Form.Item name="answerMode" label="默认回答方式">
                <Select options={answerModes.map((x) => ({ value: x, label: x }))} />
              </Form.Item>
              <Form.Item
                name="notifyEmail"
                label="通知邮箱"
                rules={[{ type: "email", message: "邮箱格式不正确" }]}
              >
                <Input />
              </Form.Item>
            </div>
            <div className="config-actions">
              <Button type="primary" htmlType="submit" loading={saving}>
                保存个人配置
              </Button>
            </div>
          </Form>
        </LoadState>
      </Panel>
      <aside className="settings-side">
        <h3>安全提示</h3>
        <p>Key 与 Token 仅用于展示配置形态，不会保存、校验或发起真实连接。</p>
      </aside>
    </div>
  );
}
