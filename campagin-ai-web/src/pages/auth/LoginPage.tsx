import { useState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthApiError } from "@/api/auth";
import { useAuth } from "@/contexts/useAuth";

interface LoginValues {
  email: string;
  password: string;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const target = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || "/";

  const submit = async ({ email, password }: LoginValues) => {
    setSubmitting(true);
    setError(undefined);
    try {
      await login(email, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <Card className="auth-card" bordered={false}>
        <Typography.Title level={2}>登录工作台</Typography.Title>
        <Typography.Paragraph type="secondary">
          使用已完成飞书绑定的邮箱和密码登录。登录状态有效期为 8 小时。
        </Typography.Paragraph>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} /> : null}
        <Form<LoginValues> layout="vertical" onFinish={submit} requiredMark={false} size="large">
          <Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "邮箱格式不正确" }]}>
            <Input autoComplete="email" inputMode="email" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
        <p className="auth-switch">还没有账号？<Link to="/register">注册并绑定飞书</Link></p>
      </Card>
    </main>
  );
}
