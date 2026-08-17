import { describe, expect, it } from "vitest";
import { conditionText, previewText, statusClass } from "./alertLabels";

describe("alertLabels", () => {
  it("builds a plain-language preview for a fixed-value rule", () => {
    expect(
      previewText({
        metric: "inference_cost",
        scope_type: "organization",
        condition_type: "exceeds",
        threshold: 100,
        window: "daily",
      }),
    ).toBe("Notify me when daily inference cost exceeds $100.");
  });

  it("names the scope reference when the rule is scoped", () => {
    expect(
      previewText({
        metric: "inference_cost",
        scope_type: "provider",
        scope_ref: "anthropic",
        condition_type: "increase_pct",
        threshold: 25,
        window: "weekly",
      }),
    ).toContain("for anthropic");
  });

  it("phrases the budget-percentage condition", () => {
    expect(
      previewText({
        metric: "combined_cost",
        scope_type: "organization",
        condition_type: "budget_pct",
        threshold: 90,
        window: "monthly",
      }),
    ).toBe("Notify me when monthly combined ai cost exceeds 90% of the monthly budget.");
  });

  it("summarizes the condition for the table", () => {
    expect(conditionText({ condition_type: "increase_pct", threshold: 40 } as never)).toBe(
      "+40% vs previous",
    );
  });

  it("maps status to a namespaced css class", () => {
    expect(statusClass("delivery_error")).toBe("alert-status alert-status-delivery_error");
  });
});
