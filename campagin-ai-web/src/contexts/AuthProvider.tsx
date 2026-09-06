import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCurrentWebUser,
  loginWebUser,
  logoutWebUser,
  registerWebUser,
  setWebCsrfToken,
  type AuthenticatedUser,
} from "@/api/auth";
import { AuthContext } from "./authContext";

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getCurrentWebUser()
      .then((current) => {
        if (!active) return;
        setWebCsrfToken(current.csrf_token);
        setUser(current);
      })
      .catch(() => {
        if (!active) return;
        setWebCsrfToken(null);
        setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const register = useCallback((email: string, password: string) => registerWebUser(email, password), []);

  const login = useCallback(async (email: string, password: string) => {
    const current = await loginWebUser(email, password);
    setWebCsrfToken(current.csrf_token);
    setUser(current);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutWebUser();
    } finally {
      setWebCsrfToken(null);
      setUser(null);
    }
  }, []);

  const requireLogin = useCallback(() => {
    setWebCsrfToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, register, login, logout, requireLogin }),
    [user, loading, register, login, logout, requireLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
