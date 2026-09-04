import { useContext } from "react";
import { SessionContext, type SessionContextValue } from "./sessionContext";

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession 必须在 SessionProvider 内使用");
  return ctx;
}
