import { createContext } from "react";
import type { AuthenticatedUser, BindingRegistration } from "@/api/auth";

export interface AuthContextValue {
  user: AuthenticatedUser | null;
  loading: boolean;
  register: (email: string, password: string) => Promise<BindingRegistration>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  requireLogin: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
