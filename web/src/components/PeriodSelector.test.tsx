import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeriodSelector } from "./PeriodSelector";
import type { ReviewRange } from "../api";

beforeEach(() => vi.setSystemTime(new Date("2026-09-04T08:00:00Z")));
afterEach(() => vi.useRealTimers());

function setup(
  value: ReviewRange = { kind: "this_month" },
  resolved?: { start: string; end: string },
) {
  const onChange = vi.fn();
  render(<PeriodSelector value={value} onChange={onChange} resolved={resolved} />);
  return onChange;
}

const openPanel = () => fireEvent.click(screen.getAllByRole("button")[0]);
const panel = () => screen.queryByRole("dialog", { name: /review period/i });

describe("PeriodSelector", () => {
  it("shows the period in view on the button", () => {
    setup({ kind: "this_month" });
    expect(screen.getByRole("button", { name: /Sep 2026/ })).toBeInTheDocument();
  });

  it("prefers the period the server actually returned", () => {
    // They differ whenever the range runs past the months that have data. The
    // button and the calendar both show what is on screen, not what was asked.
    setup({ kind: "this_month" }, { start: "2026-05", end: "2026-05" });
    expect(screen.getByRole("button", { name: /May 2026/ })).toBeInTheDocument();
    openPanel();
    expect(screen.getByRole("button", { name: "May" })).toHaveClass("edge");
    expect(screen.getByRole("button", { name: "Sep" })).not.toHaveClass("edge");
  });

  it("opens and closes the panel", () => {
    setup();
    expect(panel()).toBeNull();
    openPanel();
    expect(panel()).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel()).toBeNull();
  });

  it("applies a named range on one click, with no Apply needed", () => {
    const onChange = setup();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Last 3 months" }));

    expect(onChange).toHaveBeenCalledWith({ kind: "last_3_months" });
    expect(panel()).toBeNull(); // a complete choice closes the panel
  });

  it("marks the range currently in force", () => {
    setup({ kind: "last_6_months" });
    openPanel();
    expect(screen.getByRole("button", { name: "Last 6 months" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("shows what a named range covers on the calendar", () => {
    setup({ kind: "last_3_months" }); // Jul–Sep 2026
    openPanel();
    expect(screen.getByRole("button", { name: "Jul" })).toHaveClass("edge");
    expect(screen.getByRole("button", { name: "Aug" })).toHaveClass("inside");
    expect(screen.getByRole("button", { name: "Sep" })).toHaveClass("edge");
    expect(screen.getByRole("button", { name: "Jun" })).not.toHaveClass("inside");
  });

  it("builds a custom span from two clicks, and commits only on Apply", () => {
    const onChange = setup();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));
    fireEvent.click(screen.getByRole("button", { name: "May" }));
    // Nothing has reloaded the page behind the panel yet.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "custom",
      start: "2026-02",
      end: "2026-05",
    });
  });

  it("accepts a span picked backwards", () => {
    const onChange = setup();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "May" }));
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "custom", start: "2026-02", end: "2026-05" });
  });

  it("reads a single click as that one month, and says so while you decide", () => {
    const onChange = setup();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Mar" }));

    // A half-picked span shows as the one month picked, not as some other
    // period inferred from an incomplete selection.
    expect(screen.getByRole("button", { name: "Mar" })).toHaveClass("edge");
    expect(screen.getByRole("button", { name: "Aug" })).not.toHaveClass("inside");
    // The button still reports what is applied — this pick is not applied yet.
    expect(screen.getByRole("button", { name: /Sep 2026/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "custom", start: "2026-03", end: "2026-03" });
  });

  it("discards an unapplied edit", () => {
    const onChange = setup({ kind: "this_month" });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();

    // And reopening starts again from what is actually applied, not the discard.
    openPanel();
    expect(screen.getByRole("button", { name: "Sep" })).toHaveClass("edge");
    expect(screen.getByRole("button", { name: "Feb" })).not.toHaveClass("edge");
  });

  it("offers no month that has not happened yet", () => {
    setup();
    openPanel();
    expect(screen.getByRole("button", { name: "Sep" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Oct" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();
  });

  it("navigates to an earlier year", () => {
    setup();
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
    expect(screen.getByText("2025")).toBeInTheDocument();
    // Every month of a past year is fair game.
    expect(screen.getByRole("button", { name: "Oct" })).toBeEnabled();
  });
  it("updates the button as soon as a period is applied", () => {
    // The bug this covers: the button read the panel's draft, which is only
    // seeded when the panel opens — so after applying, it kept showing the
    // previous period until it was clicked a second time.
    function Harness() {
      const [range, setRange] = useState<ReviewRange>({ kind: "this_month" });
      return <PeriodSelector value={range} onChange={setRange} />;
    }
    render(<Harness />);

    expect(screen.getByRole("button", { name: /Sep 2026/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sep 2026/ }));
    fireEvent.click(screen.getByRole("button", { name: "Last 3 months" }));

    // No second click needed.
    expect(screen.getByRole("button", { name: /Jul – Sep 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates the button after a custom span is applied too", () => {
    function Harness() {
      const [range, setRange] = useState<ReviewRange>({ kind: "this_month" });
      return <PeriodSelector value={range} onChange={setRange} />;
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /Sep 2026/ }));
    fireEvent.click(screen.getByRole("button", { name: "Feb" }));
    fireEvent.click(screen.getByRole("button", { name: "May" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByRole("button", { name: /Feb – May 2026/ })).toBeInTheDocument();
  });

  it("shows the resolved period once the server answers", () => {
    // The parent passes what came back, which can differ from what was asked.
    const { rerender } = render(
      <PeriodSelector value={{ kind: "this_month" }} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Sep 2026/ })).toBeInTheDocument();

    rerender(
      <PeriodSelector
        value={{ kind: "this_month" }}
        onChange={vi.fn()}
        resolved={{ start: "2026-05", end: "2026-05" }}
      />,
    );
    expect(screen.getByRole("button", { name: /May 2026/ })).toBeInTheDocument();
  });
});
