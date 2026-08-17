/** Shared display labels + helpers for the Alerts feature. */
import { money } from "./format";
import type { AlertRule } from "./api";

export const METRIC_LABELS: Record<string, string> = {
  inference_cost: "Inference cost",
  build_cost: "Build cost",
  combined_cost: "Combined AI cost",
  cost_per_user: "Cost per active user",
  token_usage: "Token usage",
  unattributed_cost: "Unattributed spend",
};

export const SCOPE_LABELS: Record<string, string> = {
  organization: "Entire organization",
  provider: "Provider",
  model: "Model",
  feature: "Feature",
};

export const CONDITION_LABELS: Record<string, string> = {
  exceeds: "Exceeds a fixed value",
  increase_pct: "Increases by more than %",
  budget_pct: "Exceeds % of monthly budget",
};

export const WINDOW_LABELS: Record<string, string> = {
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const COOLDOWN_LABELS: Record<string, string> = {
  none: "No cooldown",
  hour: "Once per hour",
  day: "Once per day",
  week: "Once per week",
};

export const CHANNEL_LABELS: Record<string, string> = {
  in_app: "In-app",
  email: "Email",
  slack: "Slack webhook",
  webhook: "Generic webhook",
};

export const STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  triggered: "Triggered",
  insufficient_data: "Insufficient data",
  delivery_error: "Delivery error",
  disabled: "Disabled",
};

export const EVENT_LABELS: Record<string, string> = {
  triggered: "Triggered",
  resolved: "Resolved",
  delivery_error: "Delivery error",
  test: "Test notification",
};

export function statusClass(status: string): string {
  return `alert-status alert-status-${status}`;
}

/** "Notify me when daily inference cost exceeds $100." */
export function previewText(r: {
  metric: string;
  scope_type: string;
  scope_ref?: string | null;
  scope_label?: string | null;
  condition_type: string;
  threshold: number;
  window: string;
}): string {
  const metric = (METRIC_LABELS[r.metric] ?? r.metric).toLowerCase();
  const scopeRef = r.scope_label ?? r.scope_ref;
  const scopePart = r.scope_type !== "organization" && scopeRef ? ` for ${scopeRef}` : "";
  let cond: string;
  if (r.condition_type === "exceeds") cond = `exceeds ${money(r.threshold)}`;
  else if (r.condition_type === "increase_pct")
    cond = `increases by more than ${r.threshold}% vs the previous ${r.window} period`;
  else cond = `exceeds ${r.threshold}% of the monthly budget`;
  return `Notify me when ${r.window} ${metric}${scopePart} ${cond}.`;
}

/**
 * The most relevant in-app cost view for a rule's scope — feature detail for a
 * feature-scoped alert, Cost Sources for provider/model, otherwise the Overview.
 */
export function costLink(scopeType: string, scopeRef?: string | null): string {
  if (scopeType === "feature" && scopeRef) return `/features/${scopeRef}`;
  if (scopeType === "provider" || scopeType === "model") return "/cost-sources";
  return "/";
}

/** How a rule's condition reads in the table. */
export function conditionText(r: AlertRule): string {
  if (r.condition_type === "exceeds") return `exceeds ${money(r.threshold)}`;
  if (r.condition_type === "increase_pct") return `+${r.threshold}% vs previous`;
  return `> ${r.threshold}% of budget`;
}
