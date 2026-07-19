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
  repos_scanned: number;
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
  start: string;
  end: string;
  months: number;
  features: DashboardRow[];
  unattributed: { build_cost: number; inference_cost: number };
  highlights: DashboardHighlights;
  insights: Insight[];
  totals: {
    build_cost: number;
    inference_cost: number;
    prev_build_cost: number;
    prev_inference_cost: number;
    tokens_in: number;
    tokens_out: number;
  };
}

export interface FeatureDetail {
  feature_id: string;
  name: string;
  description: string;
  status: string;
  discovery_confidence: string | null;
  period: string;
  headline: {
    build_cost: number;
    inference_cost: number;
    active_users: number | null;
    avg_latency_ms: number | null;
  };
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
  optimization: HeuristicOptimization;
}

/** The heuristic (estimated) optimization tier — directional rules of thumb. */
export interface HeuristicOptimization {
  opportunities: {
    opportunity: string;
    savings: number;
    confidence: string;
    rationale: string;
  }[];
  monthly_savings: number;
  annual_savings: number;
}

/** A unified optimization opportunity (opt spec §18). `savings_type` is the
 * canonical taxonomy; the three totals are computed separately and never combined. */
export interface Opportunity {
  lever: string;
  title: string;
  source: "connector" | "sdk" | "heuristic";
  savings_type: "measured" | "modeled_ceiling" | "directional";
  confidence: string;
  confidence_reason: string;
  projected_monthly_savings: number;
  projected_annual_savings: number;
  evidence: string;
  fix: string | null;
  status: string;
  trail: {
    fingerprint?: string;
    provider?: string;
    model: string;
    note?: string;
    call_count?: number;
    calls?: number;
    prefix_tokens?: number;
    cached?: number;
  }[];
}

/** An applied optimization, reconciled projected-vs-realized (opt spec §11). */
export interface OptimizationAction {
  lever: string;
  applied_on: string;
  projected_monthly: number;
  current_avoidable: number;
  realized_monthly: number | null; // null until a later period can reconcile it
  status: "pending" | "measured";
}

export interface FeatureOpportunities {
  period: string;
  opportunities: Opportunity[];
  totals: { measured: number; modeled_ceiling: number; directional: number };
  cache_utilization: number | null;
  actions: OptimizationAction[];
}

export interface FeatureInference {
  window: string;
  total: number;
  by_model: { model: string; amount: number; pct: number; requests: number | null }[];
  trend: { period: string; amount: number }[];
}

/** A review period: a named month-range, or an explicit custom month span. */
export type RangeKind =
  | "this_month"
  | "last_month"
  | "last_3_months"
  | "last_6_months"
  | "last_12_months"
  | "custom";
export interface ReviewRange {
  kind: RangeKind;
  start?: string; // YYYY-MM (custom only)
  end?: string; // YYYY-MM (custom only)
}

export function rangeQuery(r?: ReviewRange): string {
  if (!r) return "";
  if (r.kind === "custom") {
    // Until both months are picked, fall back to the backend default.
    return r.start && r.end ? `?start=${r.start}&end=${r.end}` : "";
  }
  return `?range=${r.kind}`;
}

export interface ProviderSpend {
  start: string;
  end: string;
  total: number;
  by_provider: { provider: string; amount: number; pct: number; requests: number | null }[];
  trend: { period: string; amount: number }[];
  build_total: number;
  build_by_tool: { tool: string; amount: number; pct: number }[];
  build_trend: { period: string; amount: number }[];
  customer_total: number;
  by_customer: { customer_id: string; amount: number; pct: number; requests: number | null }[];
}

export interface SeatSource {
  id: string;
  provider: string;
  app_id: string;
  app_label: string | null;
  tool: string;
  plan: string;
}

export interface ComputePool {
  id: string;
  name: string;
  provider_label: string;
  monthly_cost: number;
}

export interface PoolAllocation {
  pool: string;
  provider_label: string;
  allocated: number;
  unattributed: number;
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
  dashboard: (range?: ReviewRange) => request<Dashboard>(`/dashboard${rangeQuery(range)}`),

  featureDetail: (id: string, period?: string) =>
    request<FeatureDetail>(`/features/${id}/detail${period ? `?period=${period}` : ""}`),

  featureInference: (id: string, window: "month" | "quarter" | "year") =>
    request<FeatureInference>(`/features/${id}/inference?window=${window}`),

  featureOpportunities: (id: string, period?: string) =>
    request<FeatureOpportunities>(
      `/features/${id}/opportunities${period ? `?period=${period}` : ""}`,
    ),

  applyOpportunity: (id: string, lever: string, projectedMonthly: number) =>
    request<{ lever: string; applied_on: string }>(`/features/${id}/opportunities/apply`, {
      method: "POST",
      body: JSON.stringify({ lever, projected_monthly: projectedMonthly }),
    }),

  unapplyOpportunity: (id: string, lever: string) =>
    request<void>(`/features/${id}/opportunities/apply?lever=${lever}`, { method: "DELETE" }),

  providerSpend: (range?: ReviewRange) =>
    request<ProviderSpend>(`/dashboard/providers${rangeQuery(range)}`),

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

  // ---- SSO/SCIM seat sources (Okta) ----
  listSeatSources: () => request<SeatSource[]>("/build/seat-sources"),

  registerSeatSource: (
    provider: string,
    appId: string,
    appLabel: string,
    tool: string,
    plan: string,
  ) =>
    request<SeatSource>("/build/seat-sources", {
      method: "POST",
      body: JSON.stringify({ provider, app_id: appId, app_label: appLabel, tool, plan }),
    }),

  syncIdpSeats: (period?: string) =>
    request<{
      total: number;
      total_seats: number;
      sources: { app_label: string; seats: number }[];
    }>("/build/seats/sync", { method: "POST", body: JSON.stringify({ period }) }),

  syncClaudeCodeSpend: (period?: string) =>
    request<{ total: number; members: number; spending_members: number }>(
      "/build/claude-code/sync",
      { method: "POST", body: JSON.stringify({ period }) },
    ),

  syncCursorSpend: (period?: string) =>
    request<{ total: number; members: number; spending_members: number }>("/build/cursor/sync", {
      method: "POST",
      body: JSON.stringify({ period }),
    }),

  syncCopilotSeats: (owner: string, period?: string) =>
    request<{ total: number; seats: number; plan: string; seat_price: number }>(
      "/build/copilot/sync",
      { method: "POST", body: JSON.stringify({ owner, period }) },
    ),

  recordTrainingCost: (featureId: string, amount: number, label: string, period?: string) =>
    request<{ total: number }>("/build/training", {
      method: "POST",
      body: JSON.stringify({ feature_id: featureId, amount, label, period }),
    }),

  // ---- Self-hosted compute pools (open-source inference) ----
  listComputePools: () => request<ComputePool[]>("/compute/pools"),

  createComputePool: (name: string, providerLabel: string, monthlyCost: number) =>
    request<ComputePool>("/compute/pools", {
      method: "POST",
      body: JSON.stringify({ name, provider_label: providerLabel, monthly_cost: monthlyCost }),
    }),

  allocateCompute: (period?: string, poolId?: string) =>
    request<PoolAllocation[]>("/compute/allocate", {
      method: "POST",
      body: JSON.stringify({ period, pool_id: poolId }),
    }),

  // ---- Metering hook (M7, optional precision tier) ----
  createHookToken: () => request<{ token: string }>("/hook/token", { method: "POST" }),
};
