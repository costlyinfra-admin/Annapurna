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

export interface FeatureSignal {
  id: string;
  signal_type: string;
  external_ref: string;
  confidence: string | null;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  status: string;
  discovery_confidence: string | null;
  signals: FeatureSignal[];
}

export interface DiscoverySummary {
  owner: string;
  prs: number;
  repos: string[];
  proposals: number;
}

export interface SplitGroup {
  name: string;
  signal_ids: string[];
}

export interface DashboardRow {
  feature_id: string;
  name: string;
  build_cost: number;
  inference_cost: number;
  active_users: number | null;
  cost_per_user: number | null;
  requests: number | null;
  worth_it: string;
  confidence: string | null;
}

export interface DashboardHighlights {
  most_expensive: DashboardRow | null;
  optimization: DashboardRow | null;
  highest_cost_per_user: DashboardRow | null;
}

export interface Insight {
  kind: string;
  text: string;
}

export interface Dashboard {
  period: string;
  features: DashboardRow[];
  unattributed: { build_cost: number; inference_cost: number };
  highlights: DashboardHighlights;
  insights: Insight[];
  totals: { build_cost: number; inference_cost: number };
}

export interface FeatureDetail {
  feature_id: string;
  name: string;
  description: string;
  status: string;
  discovery_confidence: string | null;
  period: string;
  headline: { build_cost: number; inference_cost: number; active_users: number | null };
  build_total: number;
  build_contributors: number;
  build_by_developer: {
    developer_id: string;
    tool: string;
    amount: number;
    confidence: string;
    prs: number | null;
    commits: number | null;
    files_changed: number | null;
  }[];
  evidence: {
    signal_type: string;
    external_ref: string;
    confidence: string | null;
    actor: string | null;
    source: string | null;
  }[];
  inference_sources: string[];
  optimization: {
    opportunities: {
      opportunity: string;
      savings: number;
      confidence: string;
      rationale: string;
    }[];
    monthly_savings: number;
    annual_savings: number;
  };
}

export interface FeatureInference {
  window: string;
  total: number;
  by_model: { model: string; amount: number; pct: number; requests: number | null }[];
  trend: { period: string; amount: number }[];
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

  // ---- Discovery + features (wizard step 2) ----
  runDiscovery: (owner: string, days = 90) =>
    request<DiscoverySummary>("/discovery/run", {
      method: "POST",
      body: JSON.stringify({ owner, days }),
    }),

  listFeatures: (status?: string) =>
    request<Feature[]>(`/features${status ? `?status=${status}` : ""}`),

  addFeature: (name: string, description = "") =>
    request<Feature>("/features", { method: "POST", body: JSON.stringify({ name, description }) }),

  renameFeature: (id: string, fields: { name?: string; description?: string }) =>
    request<Feature>(`/features/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),

  deleteFeature: (id: string) => request<void>(`/features/${id}`, { method: "DELETE" }),

  splitFeature: (id: string, groups: SplitGroup[]) =>
    request<Feature[]>(`/features/${id}/split`, {
      method: "POST",
      body: JSON.stringify({ groups }),
    }),

  mergeFeatures: (featureIds: string[], name?: string) =>
    request<Feature>("/features/merge", {
      method: "POST",
      body: JSON.stringify({ feature_ids: featureIds, name }),
    }),

  confirmOnboarding: (featureIds?: string[]) =>
    request<Feature[]>("/onboarding/confirm", {
      method: "POST",
      body: JSON.stringify({ feature_ids: featureIds ?? null }),
    }),

  // ---- The three screens (M6) ----
  dashboard: (period?: string) =>
    request<Dashboard>(`/dashboard${period ? `?period=${period}` : ""}`),

  featureDetail: (id: string, period?: string) =>
    request<FeatureDetail>(`/features/${id}/detail${period ? `?period=${period}` : ""}`),

  featureInference: (id: string, window: "month" | "quarter" | "year") =>
    request<FeatureInference>(`/features/${id}/inference?window=${window}`),

  setUsage: (id: string, activeUsers: number, period?: string) =>
    request<Feature>(`/features/${id}/usage`, {
      method: "PUT",
      body: JSON.stringify({ active_users: activeUsers, period }),
    }),

  ingestInference: (provider: string, period?: string) =>
    request<{ total: number }>("/inference/ingest", {
      method: "POST",
      body: JSON.stringify({ provider, period }),
    }),

  importBuildCost: (csv: string, tool?: string, period?: string) =>
    request<{ total: number }>("/build/import", {
      method: "POST",
      body: JSON.stringify({ csv, tool, period }),
    }),

  // ---- Metering hook (M7, optional precision tier) ----
  createHookToken: () => request<{ token: string }>("/hook/token", { method: "POST" }),
};
