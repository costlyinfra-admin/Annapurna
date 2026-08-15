/**
 * Monthly inference-spend trend as a STACKED bar chart, segmented by
 * classification (Production / Development-Test / Internal / Unclassified). Each
 * bar's segments sum to that month's active inference total — Ignore is already
 * excluded upstream, so it never appears here. Total is labelled above each bar,
 * a compact legend sits under the chart, and a hover tooltip breaks the month down.
 *
 * Classification (what kind of spend) is a different dimension from the By-provider
 * section below (where the spend comes from) — this chart only answers "what kind".
 */
import { type ClassificationTrendPoint } from "../api";
import { money } from "../format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Bottom-to-top stacking order + labels. Keys match the API buckets.
const BUCKETS = [
  { key: "production", label: "Production" },
  { key: "development", label: "Dev / Test" },
  { key: "internal", label: "Internal" },
  { key: "unclassified", label: "Unclassified" },
] as const;

function monthLabel(period: string): string {
  const month = Number(period.slice(5, 7)) - 1;
  const year = period.slice(0, 4);
  return `${MONTHS[month]} ${year}`;
}

function tooltip(t: ClassificationTrendPoint): string {
  const lines = [monthLabel(t.period)];
  for (const b of BUCKETS) {
    const v = t[b.key];
    if (v > 0) lines.push(`${b.label} — ${money(v)}`);
  }
  lines.push(`Total — ${money(t.total)}`);
  return lines.join("\n");
}

export function ClassificationTrendChart({ trend }: { trend: ClassificationTrendPoint[] }) {
  if (trend.length === 0) return <p className="muted">No data yet.</p>;
  const max = Math.max(...trend.map((t) => t.total), 1);

  return (
    <div>
      <div className="trend-chart">
        {trend.map((t) => {
          const month = Number(t.period.slice(5, 7)) - 1;
          return (
            <div className="trend-bar-wrap" key={t.period} title={tooltip(t)}>
              <span className="trend-value">{money(t.total)}</span>
              <div
                className="trend-bar trend-bar-stacked"
                style={{ height: `${Math.max(3, (t.total / max) * 100)}%` }}
              >
                {/* Top-to-bottom in DOM = Unclassified … Production, so Production
                    sits at the bottom of the stack. */}
                {[...BUCKETS]
                  .reverse()
                  .map((b) =>
                    t[b.key] > 0 ? (
                      <div
                        key={b.key}
                        className={`trend-seg trend-seg-${b.key}`}
                        style={{ height: `${(t[b.key] / t.total) * 100}%` }}
                      />
                    ) : null,
                  )}
              </div>
              <span className="trend-label">{MONTHS[month]}</span>
            </div>
          );
        })}
      </div>
      <ul className="trend-legend" aria-label="Classification legend">
        {BUCKETS.map((b) => (
          <li key={b.key} className="trend-legend-item">
            <span className={`trend-legend-swatch trend-seg-${b.key}`} aria-hidden />
            {b.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
