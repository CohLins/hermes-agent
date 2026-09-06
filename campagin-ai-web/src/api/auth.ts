export interface AuthenticatedUser {
  authenticated: true;
  email: string;
  expires_at: number;
  csrf_token: string;
}

export interface BindingRegistration {
  code: string;
  expires_at: number;
}

interface AuthErrorBody {
  error?: { message?: string; code?: string };
}

export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | null = null;

export function setWebCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getWebCsrfToken(): string | null {
  return csrfToken;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new AuthApiError("连不上认证服务，确认 gateway 已启动", 0);
  }

  if (!response.ok) {
    let message = "认证请求失败";
    let code: string | undefined;
    try {
      const body = (await response.json()) as AuthErrorBody;
      message = body.error?.message || message;
      code = body.error?.code;
    } catch {
      // 代理层错误没有稳定的 JSON 错误结构。
    }
    throw new AuthApiError(message, response.status, code);
  }
  return (await response.json()) as T;
}

export function registerWebUser(email: string, password: string): Promise<BindingRegistration> {
  return authRequest<BindingRegistration>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function loginWebUser(email: string, password: string): Promise<AuthenticatedUser> {
  return authRequest<AuthenticatedUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function getCurrentWebUser(): Promise<AuthenticatedUser> {
  return authRequest<AuthenticatedUser>("/auth/me");
}

export function logoutWebUser(): Promise<{ authenticated: false }> {
  return authRequest<{ authenticated: false }>("/auth/logout", {
    method: "POST",
    headers: csrfToken ? { "X-CSRF-Token": csrfToken } : {},
  });
}
