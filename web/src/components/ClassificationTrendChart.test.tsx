import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClassificationTrendChart } from "./ClassificationTrendChart";

const DAILY = [
  {
    period: "2026-08-01",
    total: 9.39,
    production: 0,
    development: 9.39,
    internal: 0,
    unclassified: 0,
  },
  {
    period: "2026-08-02",
    total: 74.16,
    production: 0,
    development: 74.16,
    internal: 0,
    unclassified: 0,
  },
  {
    period: "2026-08-03",
    total: 209,
    production: 0,
    development: 90,
    internal: 0,
    unclassified: 119,
  },
];

describe("ClassificationTrendChart", () => {
  it("labels daily bars by day number and shows the month once", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    // Day-of-month ticks, not "Aug" repeated.
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("Aug")).not.toBeInTheDocument();
    // The actual month appears once, in the caption.
    expect(screen.getByText("August 2026")).toBeInTheDocument();
  });

  it("shows whole-dollar values (no cents)", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    expect(screen.getByText("$74")).toBeInTheDocument(); // not $74.16
    expect(screen.queryByText("$74.16")).not.toBeInTheDocument();
    expect(screen.getByText("$9")).toBeInTheDocument(); // not $9.39
  });

  it("toggles between bar and line views", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    // Bar mode by default: classification legend + stacked segments present.
    expect(screen.getByLabelText("Classification legend")).toBeInTheDocument();
    expect(document.querySelector(".trend-seg")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    // Line mode: the SVG line chart renders; the bar legend is gone.
    expect(screen.getByRole("img", { name: "Total inference cost trend" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Classification legend")).not.toBeInTheDocument();
    expect(document.querySelector(".trend-line-path")).not.toBeNull();
  });
});
