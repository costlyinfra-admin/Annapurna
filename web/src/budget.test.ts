import { describe, expect, it } from "vitest";
import { forecastShape, monthElapsed } from "./budget";
import type { BudgetForecast, TrendMonth } from "./api";

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

function forecast(over: Partial<BudgetForecast> = {}): BudgetForecast {
  return {
    status: "open",
    as_of: "2026-05-21",
    as_of_is_fixed: false,
    window_start: "2026-03-01",
    window_end: "2026-05-31",
    actual: 45142,
    actual_build: 0,
    actual_inference: 45142,
    budget: 50000,
    budget_detail: null,
    budget_cadence: "annual",
    currency: "USD",
    forecast: 58366,
    forecast_optimized: 49611,
    identified_savings: 8755,
    variance: 8366,
    variance_pct: 16.73,
    method: "recent_weighted",
    confidence: "high",
    observed_days: 21,
    ...over,
  };
}

const TREND = [
  month("2026-03-01", 8548.68),
  month("2026-04-01", 9745.39),
  month("2026-05-01", 26847.95),
];

describe("monthElapsed", () => {
  it("reads the server's as-of date, not this browser's clock", () => {
    // 21 May of 31. Nothing here consults Date.now().
    expect(monthElapsed(forecast({ as_of: "2026-05-21" }))).toBeCloseTo(21 / 31, 6);
    // February 2028 is a leap February, so the 29th is the whole month.
    expect(monthElapsed(forecast({ as_of: "2028-02-29" }))).toBe(1);
    expect(monthElapsed(forecast({ as_of: "2027-02-28" }))).toBe(1);
  });
});

describe("forecastShape", () => {
  it("stops the solid line part-way into the open month, leaving room for the tail", () => {
    const shape = forecastShape(TREND, forecast())!;
    const lastActual = shape.actual[shape.actual.length - 1];

    // Settled months land on whole months; the open one stops where the data does.
    expect(shape.actual[1].x).toBe(1);
    expect(lastActual.x).toBeCloseTo(2 + 21 / 31, 6);
    expect(lastActual.y).toBeCloseTo(45142.02, 2);
    expect(shape.projected![0]).toBe(lastActual);
    expect(shape.projected![1]).toMatchObject({ x: 3, y: 58366 });
    expect(shape.optimizedTail![1]).toMatchObject({ x: 3, y: 49611 });
  });

  it("draws no projection at all for a closed period", () => {
    const shape = forecastShape(TREND, forecast({ status: "closed" }))!;

    expect(shape.projected).toBeNull();
    expect(shape.optimizedTail).toBeNull();
    // The line runs to the end of the final month, because that is where the
    // data ends — not part-way, which would imply a month still running.
    expect(shape.actual[shape.actual.length - 1].x).toBe(3);
  });

  it("draws no tail when the server could not forecast", () => {
    const shape = forecastShape(
      TREND,
      forecast({ status: "insufficient", forecast: null, forecast_optimized: null }),
    )!;
    expect(shape.projected).toBeNull();
    expect(shape.optimizedTail).toBeNull();
  });

  it("omits the optimized tail when Optimize had nothing to offer", () => {
    const shape = forecastShape(TREND, forecast({ forecast_optimized: null }))!;
    expect(shape.projected).not.toBeNull();
    expect(shape.optimizedTail).toBeNull();
  });

  it("has nothing to draw without a trend", () => {
    expect(forecastShape([], forecast())).toBeNull();
  });

  it("labels the months it draws", () => {
    expect(forecastShape(TREND, forecast())!.labels).toEqual(["Mar", "Apr", "May"]);
  });
});
