/**
 * The month arithmetic behind the review-period selector.
 *
 * Separate from the component because it is the part with answers that can be
 * wrong: which months a named range covers, and how a span is written out.
 */
import type { RangeKind, ReviewRange } from "../api";

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** YYYY-MM for a date offset by `monthsBack` from today. */
export function monthValue(monthsBack: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The months a named range covers, so the calendar can show what it means. */
export function presetSpan(kind: Exclude<RangeKind, "custom">): { start: string; end: string } {
  // Last month is one month, not everything up to it.
  if (kind === "last_month") return { start: monthValue(1), end: monthValue(1) };
  const months = { this_month: 0, last_3_months: 2, last_6_months: 5, last_12_months: 11 }[kind];
  return { start: monthValue(months), end: monthValue(0) };
}

/** The span a range covers, named or custom. */
export function spanOf(range: ReviewRange): { start: string; end: string } {
  if (range.kind !== "custom") return presetSpan(range.kind);
  // A half-picked span is the single month picked so far — which is exactly
  // what one click means until a second one extends it. Falling back to a
  // named range here would make the button and the calendar announce a period
  // nobody asked for, the moment a first month was clicked.
  if (range.start) return { start: range.start, end: range.end ?? range.start };
  return presetSpan("last_3_months");
}

/** "Sep 2026"; a span as "Jul – Sep 2026", or "Dec 2025 – Jan 2026" across a
 *  year boundary. The year is written once when both ends share it — it is the
 *  months that carry the meaning. Accepts "YYYY-MM" or a full ISO date. */
export function spanLabel(start: string, end: string): string {
  const month = (value: string) => MONTHS[Number(value.slice(5, 7)) - 1];
  const year = (value: string) => value.slice(0, 4);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${month(start)} ${year(start)}`;
  return year(start) === year(end)
    ? `${month(start)} – ${month(end)} ${year(end)}`
    : `${month(start)} ${year(start)} – ${month(end)} ${year(end)}`;
}
