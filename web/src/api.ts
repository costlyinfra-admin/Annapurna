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
  org_name?: string;
  is_admin?: boolean;
  impersonating?: { tenant_id: string; company: string } | null;
}

// Organization-level settings (shared by every user in the tenant).
export interface OrgSettings {
  org_name: string;
  timezone: string;
  currency: string;
  customer_id_storage: "names" | "aliases" | "hashed";
  store_prompts: boolean;
  data_retention: "30d" | "90d" | "1y" | "indefinite";
}

// ---- Internal admin portal (allow-listed admins only) ----
export interface AdminOverview {
  total_customers: number;
  connected_customers: number;
  pending_connections: number;
  total_ai_spend: number;
  total_opportunities: number;
  total_verified_savings: number;
}

export interface AdminCustomer {
  tenant_id: string;
  company: string;
  created_at: string | null;
  status: "connected" | "pending";
  connected_providers: string[];
  last_sync: string | null;
  monthly_spend: number;
  opportunities: number;
  verified_savings: number;
}

export interface AdminSyncRow {
  tenant_id: string;
  company: string;
  connector_type: string;
  action: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  records_imported: number | null;
  status: string;
  error_message: string | null;
}

export interface AdminCustomerDetail {
  tenant_id: string;
  company: string;
  created_at: string | null;
  users: string[];
  connectors: ConnectorStatus[];
  repositories: string[];
  optimization_runs: {
    lever: string;
    applied_on: string;
    projected_monthly: number;
    created_at: string;
  }[];
  recent_syncs: AdminSyncRow[];
  recent_errors: AdminSyncRow[];
}

export interface ConnectorActionResult {
  status: string;
  records_imported: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
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
  title?: string | null; // PR title (source evidence for the review UI)
  branch?: string | null; // PR head branch
  url?: string | null; // GitHub PR URL
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
  repos: string[]; // repos actually analyzed (the selected scope)
  repos_with_prs: string[];
  prs_by_repo: Record<string, number>;
  repos_scanned: number;
  proposals: number;
}

export interface RepoList {
  owner: string;
  repos: string[];
}

export interface DiscoveryScope {
  owner: string | null;
  repos: string[];
}

export interface SplitGroup {
  name: string;
  signal_ids: string[];
}

// ---- Alerts ----
export interface AlertChannel {
  id?: string;
  channel: string; // in_app | email | slack | webhook
  target?: string | null;
  label?: string;
  secret?: string; // write-only (never returned)
  configured?: boolean;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  metric: string;
  metric_label: string;
  scope_type: string;
  scope_ref: string | null;
  scope_label: string | null;
  condition_type: string;
  threshold: number;
  budget_amount: number | null;
  window: string;
  cooldown: string;
  recovery_notify: boolean;
  enabled: boolean;
  status: string; // healthy | triggered | insufficient_data | delivery_error | disabled
  last_observed: number | null;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  next_eval_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  channels: AlertChannel[];
}

export interface AlertSummary {
  triggered: number;
  healthy: number;
  delivery_errors: number;
  disabled: number;
  unread: number;
}

export interface AlertActivityEvent {
  id: string;
  alert_id: string;
  alert_name: string;
  metric: string;
  metric_label: string;
  scope_type: string;
  scope_ref: string | null;
  scope_label: string | null;
  event_type: string; // triggered | resolved | delivery_error | test
  observed_value: number | null;
  threshold: number | null;
  window: string | null;
  message: string | null;
  read: boolean;
  occurred_at: string | null;
  deliveries: { channel: string; status: string }[];
}

export interface AlertMeta {
  metrics: { value: string; label: string }[];
  scopes: string[];
  conditions: string[];
  windows: string[];
  cooldowns: string[];
  channels: string[];
  valid_conditions: Record<string, string[]>;
  valid_scopes: Record<string, string[]>;
  templates: { id: string; label: string; rule: Partial<AlertRule> }[];
}

export type AlertInput = {
  name: string;
  description?: string | null;
  metric: string;
  scope_type: string;
  scope_ref?: string | null;
  condition_type: string;
  threshold: number;
  budget_amount?: number | null;
  window: string;
  cooldown: string;
  recovery_notify: boolean;
  enabled: boolean;
  channels: { channel: string; target?: string | null; secret?: string }[];
};

// ---- Shared cost-source resource classification ----
export type Classification = "production" | "development" | "internal" | "ignore" | "unclassified";

export const CLASSIFICATION_OPTIONS: { value: Classification; label: string }[] = [
  { value: "production", label: "Production" },
  { value: "development", label: "Development / Test" },
  { value: "internal", label: "Internal" },
  { value: "ignore", label: "Ignore" },
  { value: "unclassified", label: "Unclassified" },
];

export interface SourceResourceRow {
  resource_type: string;
  resource_id: string | null;
  name: string | null;
  group: string | null;
  classification: Classification;
  cost: number;
}

export interface SourceDetail {
  provider: string;
  period?: string | null;
  // When true, rows span all synced history and `cost` is the total across it.
  all_time?: boolean;
  classifiable: boolean;
  columns?: { group: string; name: string };
  rows: SourceResourceRow[];
  message?: string;
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
  // When cost data was last ingested (NOT when the page loaded). Null before any
  // sync/import has run.
  data_updated_at: string | null;
  inference_updated_at: string | null;
  build_updated_at: string | null;
  totals: {
    build_cost: number;
    inference_cost: number;
    // Portion of inference_cost that is estimated (not yet billed), for labelling.
    estimated_inference: number;
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
  start: string;
  end: string;
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
  engineering_effort: "very_low" | "low" | "medium" | "high";
  priority_score: number;
  evidence: string;
  fix: string | null;
  validation_guidance: string;
  verification: string;
  status: string;
  overlaps: string | null; // set when superseded by an overlapping lever (opt spec §22)
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
  status: "pending" | "measured" | "verified";
}

export interface FeatureOpportunities {
  period: string;
  opportunities: Opportunity[];
  totals: { measured: number; modeled_ceiling: number; directional: number };
  cache_utilization: number | null;
  actions: OptimizationAction[];
}

/** Tenant-wide optimization Overview (opt spec §21). Measured, modeled and verified
 * savings are three distinct figures — never combined. */
export interface CopilotOverview {
  period: string;
  totals: { measured: number; modeled_ceiling: number; directional: number };
  verified_monthly_savings: number;
  verified_annual_savings: number;
  top_recommendations: (Opportunity & { feature_id: string; feature_name: string })[];
  by_feature: {
    feature_id: string;
    name: string;
    measured: number;
    modeled_ceiling: number;
    directional: number;
  }[];
  by_lever: {
    lever: string;
    title: string;
    savings_type: string;
    monthly: number;
    count: number;
  }[];
  applied: (OptimizationAction & { feature_id: string; feature_name: string })[];
}

export interface FeatureInference {
  start: string;
  end: string;
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

// One month of inference spend, split by classification. Buckets sum to `total`
// (Ignore is excluded upstream).
export interface ClassificationTrendPoint {
  period: string;
  total: number;
  production: number;
  development: number;
  internal: number;
  unclassified: number;
  // Where the period's spend came from (providers that expose workspace identity).
  workspaces?: { workspace: string; amount: number }[];
}

export interface ProviderSpend {
  start: string;
  end: string;
  total: number;
  by_provider: {
    provider: string;
    amount: number;
    pct: number;
    requests: number | null;
    by_model: { model: string; amount: number; pct: number }[];
  }[];
  // Inference trend, segmented by classification per month (a stacked bar).
  trend: ClassificationTrendPoint[];
  // Same shape at DAY resolution (used for short ranges); empty for older data.
  daily_trend: ClassificationTrendPoint[];
  build_total: number;
  build_by_tool: { tool: string; amount: number; pct: number }[];
  build_by_developer: {
    developer_id: string;
    // Display label: "Name (handle)", or whichever identity is available.
    label: string;
    amount: number;
    pct: number;
    by_tool: { tool: string; amount: number; pct: number }[];
  }[];
  build_trend: { period: string; amount: number }[];
  customer_total: number;
  by_customer: { customer_id: string; amount: number; pct: number; requests: number | null }[];
  // Billed dollars split across token types (input / cache write / cache read /
  // output), weighted by each type's real rate. Sums to token_total.
  token_total: number;
  by_token_type: {
    token_type: string;
    label: string;
    amount: number;
    pct: number;
    tokens: number;
  }[];
  workspace_total: number;
  by_workspace: {
    workspace: string;
    amount: number;
    pct: number;
    by_key: { api_key: string; amount: number; pct: number }[];
  }[];
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

  getSettings: () => request<OrgSettings>("/settings"),

  updateSettings: (patch: Partial<OrgSettings>) =>
    request<OrgSettings>("/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  // ---- Alerts ----
  alertsMeta: () => request<AlertMeta>("/alerts/meta"),
  listAlerts: () => request<{ rules: AlertRule[]; summary: AlertSummary }>("/alerts"),
  alertsSummary: () => request<AlertSummary>("/alerts/summary"),
  getAlert: (id: string) => request<AlertRule & { history: unknown }>(`/alerts/${id}`),
  createAlert: (body: AlertInput) =>
    request<AlertRule>("/alerts", { method: "POST", body: JSON.stringify(body) }),
  updateAlert: (id: string, body: AlertInput) =>
    request<AlertRule>(`/alerts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAlert: (id: string) => request<void>(`/alerts/${id}`, { method: "DELETE" }),
  enableAlert: (id: string, enabled: boolean) =>
    request<AlertRule>(`/alerts/${id}/enable`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  duplicateAlert: (id: string) => request<AlertRule>(`/alerts/${id}/duplicate`, { method: "POST" }),
  testAlert: (id: string) =>
    request<{ ok: boolean; deliveries: { channel: string; status: string }[] }>(
      `/alerts/${id}/test`,
      { method: "POST" },
    ),
  alertsActivity: () => request<{ events: AlertActivityEvent[] }>("/alerts/activity"),
  markAlertsRead: (event_ids: string[]) =>
    request<{ marked: number }>("/alerts/activity/read", {
      method: "POST",
      body: JSON.stringify({ event_ids }),
    }),
  markAllAlertsRead: () =>
    request<{ marked: number }>("/alerts/activity/read-all", { method: "POST" }),

  connectors: () => request<ConnectorStatus[]>("/connectors"),

  saveCredential: (connectorType: string, secret: string, label?: string) =>
    request<void>(`/connectors/${connectorType}/credential`, {
      method: "POST",
      body: JSON.stringify({ secret, label }),
    }),

  // ---- Discovery + features (wizard step 2) ----
  discoveryRepos: (owner: string) =>
    request<RepoList>(`/discovery/repos?owner=${encodeURIComponent(owner)}`),

  discoveryScope: () => request<DiscoveryScope>("/discovery/scope"),

  runDiscovery: (owner: string, repos: string[] = [], days = 90) =>
    request<DiscoverySummary>("/discovery/run", {
      method: "POST",
      body: JSON.stringify({ owner, repos, days }),
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

  featureDetail: (id: string, range?: ReviewRange) =>
    request<FeatureDetail>(`/features/${id}/detail${rangeQuery(range)}`),

  featureInference: (id: string, range?: ReviewRange) =>
    request<FeatureInference>(`/features/${id}/inference${rangeQuery(range)}`),

  featureOpportunities: (id: string, range?: ReviewRange) =>
    request<FeatureOpportunities>(`/features/${id}/opportunities${rangeQuery(range)}`),

  applyOpportunity: (id: string, lever: string, projectedMonthly: number) =>
    request<{ lever: string; applied_on: string }>(`/features/${id}/opportunities/apply`, {
      method: "POST",
      body: JSON.stringify({ lever, projected_monthly: projectedMonthly }),
    }),

  unapplyOpportunity: (id: string, lever: string) =>
    request<void>(`/features/${id}/opportunities/apply?lever=${lever}`, { method: "DELETE" }),

  copilotOverview: (period?: string) =>
    request<CopilotOverview>(`/copilot/overview${period ? `?period=${period}` : ""}`),

  // ---- Internal admin portal ----
  adminOverview: () => request<AdminOverview>("/admin/overview"),
  adminCustomers: () => request<AdminCustomer[]>("/admin/customers"),
  adminCustomer: (tenantId: string) => request<AdminCustomerDetail>(`/admin/customers/${tenantId}`),
  adminSaveConnector: (tenantId: string, connectorType: string, secret: string, label?: string) =>
    request<{ ok: boolean }>(`/admin/customers/${tenantId}/connectors`, {
      method: "POST",
      body: JSON.stringify({ connector_type: connectorType, secret, label: label ?? null }),
    }),
  adminTestConnector: (tenantId: string, connectorType: string) =>
    request<ConnectorActionResult>(
      `/admin/customers/${tenantId}/connectors/${connectorType}/test`,
      { method: "POST" },
    ),
  adminSyncConnector: (tenantId: string, connectorType: string) =>
    request<ConnectorActionResult>(
      `/admin/customers/${tenantId}/connectors/${connectorType}/sync`,
      { method: "POST" },
    ),
  adminDisconnectConnector: (tenantId: string, connectorType: string) =>
    request<void>(`/admin/customers/${tenantId}/connectors/${connectorType}`, { method: "DELETE" }),
  adminSyncHistory: () => request<AdminSyncRow[]>("/admin/sync-history"),
  adminErrors: () => request<AdminSyncRow[]>("/admin/errors"),
  impersonate: (tenantId: string) =>
    request<{ tenant_id: string; company: string }>(`/admin/impersonate/${tenantId}`, {
      method: "POST",
    }),
  stopImpersonate: () => request<void>("/admin/impersonate", { method: "DELETE" }),

  providerSpend: (range?: ReviewRange) =>
    request<ProviderSpend>(`/dashboard/providers${rangeQuery(range)}`),

  setUsage: (id: string, activeUsers: number, period?: string) =>
    request<Feature>(`/features/${id}/usage`, {
      method: "PUT",
      body: JSON.stringify({ active_users: activeUsers, period }),
    }),

  ingestInference: (provider: string, period?: string, months?: number) =>
    request<{
      total: number;
      estimated?: number;
      months?: number;
      by_month?: { period: string; total: number; rows: number }[];
      errors?: { period: string; error: string }[];
    }>("/inference/ingest", {
      method: "POST",
      body: JSON.stringify({ provider, period, months }),
    }),

  /** Pull the current month from every connected inference provider. */
  refreshInference: () =>
    request<{
      providers: number;
      synced: { provider: string; total: number }[];
      errors: { provider: string; error: string }[];
      total: number;
    }>("/inference/refresh", { method: "POST" }),

  sourceDetail: (provider: string, period?: string) =>
    request<SourceDetail>(`/cost-sources/${provider}/detail${period ? `?period=${period}` : ""}`),

  classifyResource: (
    provider: string,
    body: { resource_type: string; resource_id: string; classification: Classification },
  ) =>
    request<{ classification: Classification }>(`/cost-sources/${provider}/classify`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  importBuildCost: (csv: string, tool?: string, period?: string) =>
    request<{ total: number; months_imported?: number }>("/build/import", {
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
