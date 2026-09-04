import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monthValue, presetSpan, spanLabel, spanOf } from "./periodRange";

// A fixed "now" — otherwise every assertion here drifts with the calendar.
beforeEach(() => vi.setSystemTime(new Date("2026-09-04T08:00:00Z")));
afterEach(() => vi.useRealTimers());

describe("period months", () => {
  it("counts back by whole months", () => {
    expect(monthValue(0)).toBe("2026-09");
    expect(monthValue(1)).toBe("2026-08");
    // Across a year boundary, which is where naive month maths breaks.
    expect(monthValue(9)).toBe("2025-12");
    expect(monthValue(12)).toBe("2025-09");
  });

  it("covers what each named range says it covers", () => {
    expect(presetSpan("this_month")).toEqual({ start: "2026-09", end: "2026-09" });
    // Last month is one month, not "everything up to last month".
    expect(presetSpan("last_month")).toEqual({ start: "2026-08", end: "2026-08" });
    expect(presetSpan("last_3_months")).toEqual({ start: "2026-07", end: "2026-09" });
    expect(presetSpan("last_6_months")).toEqual({ start: "2026-04", end: "2026-09" });
    expect(presetSpan("last_12_months")).toEqual({ start: "2025-10", end: "2026-09" });
  });

  it("counts inclusively, so a span of N months contains N of them", () => {
    for (const [kind, months] of [
      ["this_month", 1],
      ["last_month", 1],
      ["last_3_months", 3],
      ["last_6_months", 6],
      ["last_12_months", 12],
    ] as const) {
      const { start, end } = presetSpan(kind);
      const count =
        (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
        (Number(end.slice(5, 7)) - Number(start.slice(5, 7))) +
        1;
      expect(count).toBe(months);
    }
  });

  it("takes a custom span at its word", () => {
    expect(spanOf({ kind: "custom", start: "2026-01", end: "2026-03" })).toEqual({
      start: "2026-01",
      end: "2026-03",
    });
    // Half-picked: the one month chosen so far, not some invented span.
    expect(spanOf({ kind: "custom", start: "2026-01" })).toEqual({
      start: "2026-01",
      end: "2026-01",
    });
    // Nothing picked at all: a sensible span to start editing from.
    expect(spanOf({ kind: "custom" })).toEqual(presetSpan("last_3_months"));
  });

  it("writes one month as one month and a span as a span", () => {
    expect(spanLabel("2026-09", "2026-09")).toBe("Sep 2026");
    expect(spanLabel("2026-07", "2026-09")).toBe("Jul – Sep 2026");
    expect(spanLabel("2025-12", "2026-01")).toBe("Dec 2025 – Jan 2026");
  });
});
