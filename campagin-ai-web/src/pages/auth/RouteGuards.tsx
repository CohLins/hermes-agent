import { type ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "@/contexts/useAuth";

export function SessionExpiryBoundary({ children }: { children: ReactNode }) {
  const { requireLogin } = useAuth();

  useEffect(() => {
    const onLoginRequired = () => requireLogin();
    window.addEventListener("hermes:login-required", onLoginRequired);
    return () => window.removeEventListener("hermes:login-required", onLoginRequired);
  }, [requireLogin]);

  return <>{children}</>;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-loading">
        <Spin size="large" tip="正在验证登录状态" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <Spin size="large" tip="正在验证登录状态" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}
