/**
 * Chart geometry for the Overview's Budget & forecast card.
 *
 * Calculation helpers only. Every figure the card shows — the budget, the
 * forecast, the variance, the as-of date — is computed on the server from the
 * organization's stored budget and its observed daily spend, and arrives here
 * as `BudgetForecast`. There is no budget or forecast fixture in this file, and
 * nothing here invents a number when one is missing: a null stays null and the
 * card renders a state that says so.
 */
import type { BudgetForecast, TrendMonth } from "./api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(period: string): string {
  return MONTHS[Number(period.slice(5, 7)) - 1];
}

/** A point on the cumulative-spend line. */
export interface ForecastPoint {
  /** Months from the start of the window. */
  x: number;
  /** Cumulative spend at that point. */
  y: number;
  /** What this point is, for the tooltip. */
  label: string;
}

export interface ForecastShape {
  /** Whole months in the window — the x axis's full width. */
  months: number;
  /** Cumulative spend that actually happened. */
  actual: ForecastPoint[];
  /** Where the line goes if nothing changes, or null for a closed period. */
  projected: ForecastPoint[] | null;
  /** The same tail with identified savings applied, or null. */
  optimizedTail: ForecastPoint[] | null;
  /** Month names under the axis. */
  labels: string[];
}

/**
 * Turn the window's monthly trend and the server's forecast into chart points.
 *
 * The last actual point lands part-way into its month — at the fraction of the
 * month the server says has elapsed — which is what leaves the projected tail
 * somewhere to go. A closed period has no tail at all: its line ends on the
 * final month boundary because that is where the data ends.
 *
 * Returns null when there is nothing to draw.
 */
export function forecastShape(
  trend: TrendMonth[],
  forecast: BudgetForecast,
): ForecastShape | null {
  const months = trend.length;
  if (months === 0) return null;

  const closed = forecast.status === "closed";
  const elapsed = closed ? 1 : monthElapsed(forecast);

  const actual: ForecastPoint[] = [{ x: 0, y: 0, label: "Start of period" }];
  let running = 0;
  trend.forEach((month, i) => {
    running += month.build_cost + month.inference_cost;
    const last = i === months - 1;
    actual.push({
      x: i + (last ? elapsed : 1),
      y: running,
      label: last && !closed ? `${monthLabel(month.period)} so far` : monthLabel(month.period),
    });
  });

  const lastActual = actual[actual.length - 1];
  const endLabel = monthLabel(trend[months - 1].period);

  return {
    months,
    actual,
    labels: trend.map((m) => monthLabel(m.period)),
    projected:
      closed || forecast.forecast === null
        ? null
        : [lastActual, { x: months, y: forecast.forecast, label: `${endLabel}, forecast` }],
    optimizedTail:
      closed || forecast.forecast_optimized === null
        ? null
        : [
            lastActual,
            {
              x: months,
              y: forecast.forecast_optimized,
              label: `${endLabel}, with savings applied`,
            },
          ],
  };
}

/**
 * The fraction of the window's final month that has elapsed, from the server's
 * as-of date — never from this browser's clock, which knows nothing about the
 * organization's timezone or about a demo tenant's pinned date.
 */
export function monthElapsed(forecast: BudgetForecast): number {
  const asOf = new Date(`${forecast.as_of}T00:00:00Z`);
  const day = asOf.getUTCDate();
  const inMonth = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (!inMonth) return 1;
  return Math.min(day / inMonth, 1);
}
