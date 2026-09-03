/** Shared badges for confidence, the "Worth it?" indicator, and AI/non-AI kind. */

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

/** Where an AI/non-AI verdict came from — shown on hover, because a keyword
 *  guess and a billing fact deserve different amounts of trust. */
const AI_KIND_BASIS: Record<string, string> = {
  user: "Set by hand",
  inference: "Has inference cost — this feature calls models",
  discovery: "Guessed from AI keywords in its pull requests",
};

export function AiKindBadge({ kind, source }: { kind: string | null; source?: string | null }) {
  if (!kind) {
    return (
      <span className="badge ai-unknown" title="Nothing has determined this yet">
        unknown
      </span>
    );
  }
  return (
    <span
      className={kind === "ai" ? "badge ai-yes" : "badge ai-no"}
      title={source ? AI_KIND_BASIS[source] : undefined}
    >
      {kind === "ai" ? "AI" : "Non-AI"}
    </span>
  );
}
