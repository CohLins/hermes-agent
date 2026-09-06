import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { Link } from "react-router-dom";
import { AuthApiError, type BindingRegistration } from "@/api/auth";
import { useAuth } from "@/contexts/useAuth";

interface RegisterValues {
  email: string;
  password: string;
  confirmation: string;
}

function secondsRemaining(expiresAt: number): number {
  return Math.max(0, Math.ceil(expiresAt - Date.now() / 1000));
}

export default function RegisterPage() {
  const { register } = useAuth();
  const [form] = Form.useForm<RegisterValues>();
  const [registration, setRegistration] = useState<BindingRegistration>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!registration) return;
    const refresh = () => setRemaining(secondsRemaining(registration.expires_at));
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [registration]);

  const expiresText = useMemo(() => {
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [remaining]);

  const submit = async ({ email, password }: RegisterValues) => {
    setSubmitting(true);
    setError(undefined);
    try {
      setRegistration(await register(email, password));
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "注册失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <Card className="auth-card" bordered={false}>
        <Typography.Title level={2}>注册并绑定飞书</Typography.Title>
        <Typography.Paragraph type="secondary">
          首次使用需要把账户与当前开发机连接的飞书助手绑定。绑定成功后才能登录工作台。
        </Typography.Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} /> : null}
        {registration ? (
          <section className="binding-card" aria-live="polite">
            <Alert
              type={remaining > 0 ? "info" : "warning"}
              showIcon
              message={remaining > 0 ? `请在 ${expiresText} 内完成绑定` : "绑定码已过期"}
              description={
                remaining > 0
                  ? "在当前开发机连接的飞书助手私聊中发送下面的命令。绑定成功后回到登录页。"
                  : "提交同一邮箱和密码即可生成新的绑定码，旧码会立即失效。"
              }
            />
            {remaining > 0 ? <code className="binding-command">/bind {registration.code}</code> : null}
            <div className="auth-actions">
              <Button type="primary" onClick={() => form.submit()} disabled={submitting}>
                {remaining > 0 ? "重新生成绑定码" : "生成新的绑定码"}
              </Button>
              <Link to="/login">已绑定，去登录</Link>
            </div>
          </section>
        ) : null}
        <Form form={form} layout="vertical" onFinish={submit} requiredMark={false} size="large" style={{ marginTop: 20 }}>
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
            <Input autoComplete="email" inputMode="email" />
          </Form.Item>
          <Form.Item name="password" label="密码" extra="至少 6 位，支持中文、英文及其他字符。建议使用不复用的密码。" rules={[{ required: true, message: "请输入密码" }, { min: 6, message: "密码至少需要 6 位" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="confirmation" label="确认密码" dependencies={["password"]} rules={[{ required: true, message: "请再次输入密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("password") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {registration ? "重新生成绑定码" : "生成绑定码"}
          </Button>
        </Form>
        {!registration ? <p className="auth-switch">已有账号？<Link to="/login">去登录</Link></p> : null}
      </Card>
    </main>
  );
}
