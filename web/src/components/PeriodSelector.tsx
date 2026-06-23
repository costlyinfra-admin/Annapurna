/**
 * Review-period selector for the Overview. Named month-ranges (data is bucketed
 * by month, so these are exact) plus a Custom month span. Emits a ReviewRange.
 */
import type { RangeKind, ReviewRange } from "../api";

const PRESETS: { kind: RangeKind; label: string }[] = [
  { kind: "this_month", label: "This month" },
  { kind: "last_month", label: "Last month" },
  { kind: "last_3_months", label: "Last 3 months" },
  { kind: "last_6_months", label: "Last 6 months" },
  { kind: "last_12_months", label: "Last 12 months" },
  { kind: "custom", label: "Custom…" },
];

/** YYYY-MM for a date offset by `monthsBack` from today. */
function monthValue(monthsBack: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function PeriodSelector({
  value,
  onChange,
}: {
  value: ReviewRange;
  onChange: (r: ReviewRange) => void;
}) {
  return (
    <div className="period-selector">
      <select
        aria-label="Review period"
        value={value.kind}
        onChange={(e) => {
          const kind = e.target.value as RangeKind;
          if (kind === "custom") {
            // Seed a sensible default span (last 3 months) the user can adjust.
            onChange({ kind, start: monthValue(2), end: monthValue(0) });
          } else {
            onChange({ kind });
          }
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.kind} value={p.kind}>
            {p.label}
          </option>
        ))}
      </select>

      {value.kind === "custom" && (
        <span className="period-custom">
          <input
            type="month"
            aria-label="Start month"
            value={value.start ?? ""}
            max={value.end}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
          />
          <span className="muted">to</span>
          <input
            type="month"
            aria-label="End month"
            value={value.end ?? ""}
            min={value.start}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
          />
        </span>
      )}
    </div>
  );
}
