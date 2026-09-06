import { describe, expect, it } from "vitest";
import { budgetForecast, DEMO_ANNUAL_BUDGET, DEMO_MONTH_ELAPSED } from "./budget";
import type { TrendMonth } from "./api";

function month(period: string, total: number): TrendMonth {
  return {
    period,
    build_cost: 0,
    inference_cost: total,
    tokens_in: 0,
    cached_tokens_in: 0,
    tokens_out: 0,
    cache_rate: 0,
  };
}

describe("budgetForecast", () => {
  it("completes the open month at the rate it has run so far", () => {
    const plan = budgetForecast([month("2026-04-01", 1000), month("2026-05-01", 2000)], null)!;

    // The settled month is left alone; only the open one is extrapolated.
    expect(plan.spent).toBe(3000);
    expect(plan.forecast).toBeCloseTo(1000 + 2000 / DEMO_MONTH_ELAPSED, 4);
    // Spent is never quietly replaced by the projection.
    expect(plan.spent).toBeLessThan(plan.forecast);
  });

  it("prorates the annual budget across the window on show", () => {
    const three = budgetForecast(
      [month("2026-03-01", 10), month("2026-04-01", 10), month("2026-05-01", 10)],
      null,
    )!;
    const one = budgetForecast([month("2026-05-01", 10)], null)!;

    expect(three.budget).toBeCloseTo((DEMO_ANNUAL_BUDGET / 12) * 3, 6);
    expect(one.budget).toBeCloseTo(DEMO_ANNUAL_BUDGET / 12, 6);
  });

  it("reproduces the demo's figures, which is where the card's copy comes from", () => {
    const plan = budgetForecast(
      [
        month("2026-03-01", 8548.68),
        month("2026-04-01", 9745.39),
        month("2026-05-01", 26847.95),
      ],
      8755,
    )!;

    expect(plan.spent).toBeCloseTo(45142.02, 2);
    expect(plan.budget).toBe(50000);
    expect(plan.forecast).toBeCloseTo(58365.64, 1);
    expect(plan.optimized).toBeCloseTo(49610.64, 1);
    expect(Math.round(plan.overBy)).toBe(17);
    expect(plan.overBudget).toBe(true);
    expect(plan.savingsCloseTheGap).toBe(true);
  });

  it("does not claim savings close a gap they only narrow", () => {
    const plan = budgetForecast([month("2026-05-01", 40_000)], 100)!;

    expect(plan.overBudget).toBe(true);
    expect(plan.savingsCloseTheGap).toBe(false);
  });

  it("says nothing about savings until Optimize has answered", () => {
    const plan = budgetForecast([month("2026-05-01", 40_000)], null)!;

    // Not zero: an unknown saving and a saving of nothing are different answers.
    expect(plan.optimized).toBeNull();
    expect(plan.optimizedTail).toBeNull();
    expect(plan.savingsCloseTheGap).toBe(false);
  });

  it("never forecasts a negative total, however large the identified savings", () => {
    const plan = budgetForecast([month("2026-05-01", 100)], 10_000)!;

    expect(plan.optimized).toBe(0);
  });

  it("has nothing to draw without spend to draw from", () => {
    expect(budgetForecast([], 100)).toBeNull();
    expect(budgetForecast([month("2026-05-01", 0)], 100)).toBeNull();
  });

  it("leaves the projected tail room on the x axis", () => {
    const plan = budgetForecast([month("2026-04-01", 10), month("2026-05-01", 10)], null)!;
    const lastActual = plan.actual[plan.actual.length - 1];

    // Settled months land on whole months; the open one stops part-way, which
    // is what leaves the dashed tail somewhere to go.
    expect(plan.actual[1].x).toBe(1);
    expect(lastActual.x).toBeCloseTo(1 + DEMO_MONTH_ELAPSED, 6);
    expect(plan.projected[0]).toBe(lastActual);
    expect(plan.projected[1].x).toBe(plan.months);
  });
});
