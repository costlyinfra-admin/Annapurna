/**
 * Thin API client for the Annapurna backend.
 *
 * All calls send the session cookie (`credentials: "include"`). In dev, Vite
 * proxies `/api` to the FastAPI backend (see vite.config.ts).
 */

export interface User {
  id: string;
  tenant_id: string;
  email: string;
}

export interface ConnectorStatus {
  type: string;
  name: string;
  category: string;
  connected: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  signup: (email: string, password: string) =>
    request<User>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  me: () => request<User>("/auth/me"),

  connectors: () => request<ConnectorStatus[]>("/connectors"),

  saveCredential: (connectorType: string, secret: string, label?: string) =>
    request<void>(`/connectors/${connectorType}/credential`, {
      method: "POST",
      body: JSON.stringify({ secret, label }),
    }),
};
