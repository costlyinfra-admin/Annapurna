/**
 * Setup checklist shown on the Overview until the three sources are in place.
 * Derived from the dashboard data, so it disappears automatically once features
 * + build cost + inference cost all exist.
 */
import { Link } from "react-router-dom";

export function OnboardingChecklist({
  hasFeatures,
  hasBuild,
  hasInference,
}: {
  hasFeatures: boolean;
  hasBuild: boolean;
  hasInference: boolean;
}) {
  const items = [
    {
      done: hasFeatures,
      label: "Identify features",
      desc: "Connect GitHub and discover the features you've shipped from your merged PRs.",
      to: "/features",
      cta: "Discover features",
    },
    {
      done: hasBuild,
      label: "Add build cost",
      desc: "Sync your AI coding-tool spend — Claude Code, Copilot, Cursor, or a CSV.",
      to: "/cost-sources",
      cta: "Add build cost",
    },
    {
      done: hasInference,
      label: "Add inference cost",
      desc: "Connect your LLM provider's cost API (Anthropic, OpenAI, Bedrock, self-hosted…).",
      to: "/cost-sources",
      cta: "Add inference cost",
    },
  ];
  const done = items.filter((i) => i.done).length;

  return (
    <section className="checklist" aria-label="Setup checklist">
      <div className="checklist-head">
        <h2>Finish setting up</h2>
        <span className="muted">
          {done} of {items.length} done
        </span>
      </div>
      <ul className="checklist-items">
        {items.map((it) => (
          <li key={it.label} className={it.done ? "checklist-item done" : "checklist-item"}>
            <span className="checklist-mark" aria-hidden>
              {it.done ? "✓" : ""}
            </span>
            <div className="checklist-text">
              <strong>{it.label}</strong>
              <span className="muted">{it.desc}</span>
            </div>
            {it.done ? (
              <span className="badge connected">Done</span>
            ) : (
              <Link to={it.to} className="checklist-cta">
                {it.cta} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
