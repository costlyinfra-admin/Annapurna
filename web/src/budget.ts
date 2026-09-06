/**
 * Budget and forecast for the Overview's "Budget & forecast" card.
 *
 * Two inputs do not exist in the product yet: nobody can set a budget, and the
 * backend does not project. Both are mocked here, in one module, so there is a
 * single place to delete when the real fields arrive — see DEMO_ANNUAL_BUDGET
 * and DEMO_MONTH_ELAPSED below, which are the only invented numbers in the
 * feature.
 *
 * Everything downstream of them is arithmetic on the real trend and the real
 * Optimize figure, so the card exercises the code that will ship rather than a
 * table of pre-baked strings. The rules of the house hold here too: build and
 * inference are summed only to answer "how much in total", and a forecast is
 * always labelled as a forecast, never mixed into a figure of what was spent.
 */
import type { TrendMonth } from "./api";

/**
 * MOCK. The tenant's annual AI budget, prorated across whatever window the page
 * is showing. There is no budget setting in the product yet; when there is, this
 * becomes a field on the org and the proration stays.
 */
export const DEMO_ANNUAL_BUDGET = 200_000;

/**
 * MOCK. How much of the window's final month has elapsed, which is what turns
 * spend-to-date into a projection.
 *
 * Real code reads this from the clock against the month the data covers. The
 * demo's data is historical — every month in it is already complete — so the
 * clock would leave nothing to forecast and the card would have nothing to say.
 * 0.67 stands the demo two-thirds of the way through its last month.
 */
export const DEMO_MONTH_ELAPSED = 0.67;

/** A point on the cumulative-spend line. */
export interface ForecastPoint {
  /** Months from the start of the window. The last actual point lands part-way
   *  into its month, which is what leaves room for the projected tail. */
  x: number;
  /** Cumulative spend at that point. */
  y: number;
  /** What this point is, for the tooltip. */
  label: string;
}

export interface BudgetForecast {
  /** Months in the window — also the x axis's full width. */
  months: number;
  /** Prorated budget for the window. */
  budget: number;
  /** Actually spent so far. Never a projection. */
  spent: number;
  /** Projected spend for the whole window. */
  forecast: number;
  /** The forecast less identified savings, or null until Optimize has answered. */
  optimized: number | null;
  overBudget: boolean;
  /** Percent the forecast runs over budget; negative when it runs under. */
  overBy: number;
  /** True only when savings are known AND they close the whole gap. */
  savingsCloseTheGap: boolean;
  /** Spend to date, cumulative. */
  actual: ForecastPoint[];
  /** Where the line goes if nothing changes: from the last actual point on. */
  projected: ForecastPoint[];
  /** The same tail with identified savings applied, or null. */
  optimizedTail: ForecastPoint[] | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(period: string): string {
  return MONTHS[Number(period.slice(5, 7)) - 1];
}

/**
 * Project the window's spend and measure it against the budget.
 *
 * The projection completes the final month at the rate it has run so far and
 * leaves the earlier months alone, because those are billed and settled. The
 * optimized figure applies one month of identified savings to the forecast —
 * the savings figure is a monthly rate and the month being forecast is the one
 * still open, so it is what the window would come to had they been in place.
 *
 * Returns null when there is nothing to forecast from.
 */
export function budgetForecast(
  trend: TrendMonth[],
  /** Monthly potential savings from Optimize; null while that call is in flight. */
  potentialMonthly: number | null,
): BudgetForecast | null {
  const months = trend.length;
  if (months === 0) return null;

  const totals = trend.map((m) => m.build_cost + m.inference_cost);
  if (totals.reduce((sum, t) => sum + t, 0) <= 0) return null;

  const budget = (DEMO_ANNUAL_BUDGET / 12) * months;

  const actual: ForecastPoint[] = [{ x: 0, y: 0, label: "Start of period" }];
  let running = 0;
  totals.forEach((total, i) => {
    running += total;
    const last = i === months - 1;
    actual.push({
      x: i + (last ? DEMO_MONTH_ELAPSED : 1),
      y: running,
      label: last ? `${monthLabel(trend[i].period)} so far` : `End of ${monthLabel(trend[i].period)}`,
    });
  });

  const spent = running;
  const openMonth = totals[months - 1];
  // Guard the divide: a window whose last month has not started yet has nothing
  // to extrapolate from, so the forecast is simply what is on the books.
  const projectedOpenMonth = DEMO_MONTH_ELAPSED > 0 ? openMonth / DEMO_MONTH_ELAPSED : openMonth;
  const forecast = spent - openMonth + projectedOpenMonth;

  const optimized = potentialMonthly === null ? null : Math.max(forecast - potentialMonthly, 0);
  const lastActual = actual[actual.length - 1];
  const endLabel = `End of ${monthLabel(trend[months - 1].period)}`;

  return {
    months,
    budget,
    spent,
    forecast,
    optimized,
    overBudget: forecast > budget,
    overBy: budget > 0 ? ((forecast - budget) / budget) * 100 : 0,
    savingsCloseTheGap: optimized !== null && forecast > budget && optimized <= budget,
    actual,
    projected: [lastActual, { x: months, y: forecast, label: `${endLabel}, forecast` }],
    optimizedTail:
      optimized === null
        ? null
        : [lastActual, { x: months, y: optimized, label: `${endLabel}, with savings applied` }],
  };
}
