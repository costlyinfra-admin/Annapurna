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
    workspaces: [
      { workspace: "automations", amount: 150 },
      { workspace: "mcs-dev", amount: 59 },
    ],
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

  it("shows a breakdown card as the cursor moves along the line", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    // Idle: the peak's amount is labelled in-chart ($209, whole dollars).
    expect(document.querySelector(".trend-line-label")?.textContent).toBe("$209");

    // Hovering a band opens the card for that point, with its date and total.
    const bands = document.querySelectorAll('.trend-line-svg rect[fill="transparent"]');
    fireEvent.mouseEnter(bands[1]);
    const card = document.querySelector(".trend-hover-card");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Aug 2, 2026");
    expect(card?.textContent).toContain("$74.16");
    // A guide line tracks the highlighted point.
    expect(document.querySelector(".trend-line-guide")).not.toBeNull();
  });

  it("breaks the hovered point down by classification and workspace", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    const bands = document.querySelectorAll('.trend-line-svg rect[fill="transparent"]');
    fireEvent.mouseEnter(bands[2]); // the day with both buckets + workspaces

    const card = document.querySelector(".trend-hover-card")!;
    // Classification split (only non-zero buckets).
    expect(card.textContent).toContain("Dev / Test");
    expect(card.textContent).toContain("Unclassified");
    expect(card.textContent).not.toContain("Internal");
    // Workspace split for the same point.
    expect(card.textContent).toContain("By workspace");
    expect(card.textContent).toContain("automations");
    expect(card.textContent).toContain("mcs-dev");
  });

  it("opens the same breakdown card when hovering a bar", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    // Bar mode is the default — no card until the cursor lands on a bar.
    expect(document.querySelector(".trend-hover-card")).toBeNull();

    const bars = document.querySelectorAll(".trend-bar-wrap");
    fireEvent.mouseEnter(bars[2]);
    const card = document.querySelector(".trend-hover-card")!;
    expect(card.textContent).toContain("Aug 3, 2026");
    expect(card.textContent).toContain("$209");
    // Same breakdown the line view shows: classification + workspace.
    expect(card.textContent).toContain("Dev / Test");
    expect(card.textContent).toContain("By workspace");
    expect(card.textContent).toContain("automations");
    // The hovered bar is marked so the others can dim.
    expect(bars[2].className).toContain("active");
  });

  it("thins bar labels when daily bars would collide", () => {
    // 31 daily points: labelling every bar overlaps, so only the peak is labelled
    // until the cursor picks one out.
    const many = Array.from({ length: 31 }, (_, i) => ({
      period: `2026-08-${String(i + 1).padStart(2, "0")}`,
      total: i === 20 ? 900 : 100,
      production: 0,
      development: i === 20 ? 900 : 100,
      internal: 0,
      unclassified: 0,
    }));
    render(<ClassificationTrendChart trend={many} granularity="day" />);

    const labels = [...document.querySelectorAll(".trend-value")].map((e) => e.textContent);
    expect(labels).toEqual(["$900"]); // the peak only
    // Hovering another bar labels it too, without restoring the rest.
    fireEvent.mouseEnter(document.querySelectorAll(".trend-bar-wrap")[0]);
    expect([...document.querySelectorAll(".trend-value")].map((e) => e.textContent)).toEqual([
      "$100",
      "$900",
    ]);
  });

  it("labels every bar when there is room", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    expect(document.querySelectorAll(".trend-value")).toHaveLength(DAILY.length);
  });

  it("draws a dollar y-axis with gridlines", () => {
    render(<ClassificationTrendChart trend={DAILY} granularity="day" />);
    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    // Dotted gridlines with whole-dollar axis labels, topped by a "nice" ceiling.
    expect(document.querySelectorAll(".trend-grid-line").length).toBe(5);
    const labels = [...document.querySelectorAll(".trend-axis-label")].map((e) => e.textContent);
    expect(labels).toEqual(["$0", "$63", "$125", "$188", "$250"]); // ceiling above $209
  });
});
