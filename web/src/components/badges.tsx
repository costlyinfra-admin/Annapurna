/** Shared badges for confidence and the directional "Worth it?" indicator. */

export function ConfidenceBadge({ level }: { level: string | null }) {
  const l = level ?? "low";
  return <span className={`badge conf-${l}`}>{l}</span>;
}

const WORTH_LABEL: Record<string, string> = {
  healthy: "Healthy",
  watch: "Watch",
  unknown: "No usage",
};

export function WorthBadge({ value }: { value: string }) {
  return <span className={`badge worth-${value}`}>{WORTH_LABEL[value] ?? value}</span>;
}
