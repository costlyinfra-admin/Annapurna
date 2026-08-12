/**
 * A small monthly bar chart of spend over time. Shared by the feature
 * drill-down (per-feature inference) and the Overview's by-provider tab.
 */
import { money } from "../format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function TrendChart({ trend }: { trend: { period: string; amount: number }[] }) {
  if (trend.length === 0) return <p className="muted">No data yet.</p>;
  const max = Math.max(...trend.map((t) => t.amount), 1);
  return (
    <div className="trend-chart">
      {trend.map((t) => {
        const month = Number(t.period.slice(5, 7)) - 1;
        return (
          <div
            className="trend-bar-wrap"
            key={t.period}
            title={`${MONTHS[month]} · ${money(t.amount)}`}
          >
            <span className="trend-value">{money(t.amount)}</span>
            <div
              className="trend-bar"
              style={{ height: `${Math.max(3, (t.amount / max) * 100)}%` }}
            />
            <span className="trend-label">{MONTHS[month]}</span>
          </div>
        );
      })}
    </div>
  );
}
