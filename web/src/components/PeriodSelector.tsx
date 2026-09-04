/**
 * Review-period selector: a button showing the period in view, opening a panel
 * with the named ranges beside a calendar for picking a custom span.
 *
 * The data is bucketed by month, so the calendar picks months rather than days —
 * a day picker would offer a precision the numbers behind it do not have.
 *
 * The panel edits a draft and only commits on Apply, so a half-finished span
 * (a start with no end) never reloads the page behind it. Choosing a named
 * range is a complete choice on its own, so those apply and close immediately.
 */
import { useEffect, useRef, useState } from "react";
import type { RangeKind, ReviewRange } from "../api";
import { MONTHS, monthValue, spanLabel, spanOf } from "./periodRange";

const PRESETS: { kind: RangeKind; label: string }[] = [
  { kind: "this_month", label: "This month" },
  { kind: "last_month", label: "Last month" },
  { kind: "last_3_months", label: "Last 3 months" },
  { kind: "last_6_months", label: "Last 6 months" },
  { kind: "last_12_months", label: "Last 12 months" },
];

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="15"
      height="15"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="14"
      height="14"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={dir === "left" ? "M12 4.5 6.5 10l5.5 5.5" : "M8 4.5 13.5 10 8 15.5"} />
    </svg>
  );
}

export function PeriodSelector({
  value,
  onChange,
  resolved,
}: {
  value: ReviewRange;
  onChange: (r: ReviewRange) => void;
  /** The months actually in view, as the server resolved them — they differ
   *  from the selection whenever a range runs past the data. Both the button
   *  and the calendar show this, so the control tells one story. Absent until
   *  data arrives, when the selection's own span is all that is known. */
  resolved?: { start: string; end: string };
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReviewRange>(value);
  const [year, setYear] = useState(() => Number(spanOf(value).end.slice(0, 4)));
  const wrap = useRef<HTMLDivElement>(null);

  // Opening starts a fresh draft from what is currently applied, and shows the
  // year that range ends in — the one the user is most likely to edit.
  function toggle() {
    if (!open) {
      setDraft(value);
      setYear(Number(spanOf(value).end.slice(0, 4)));
    }
    setOpen((was) => !was);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const edited = draft !== value;
  const span = !edited && resolved ? resolved : spanOf(draft);
  const thisMonth = monthValue(0);

  /** Clicking a month: the first click starts a span, the second closes it.
   *  Updated from the previous draft rather than the rendered one, so two
   *  clicks in quick succession cannot both be read as a first click. */
  function pickMonth(month: string) {
    setDraft((prev) => {
      const started = prev.kind === "custom" && prev.start && !prev.end;
      if (!started) return { kind: "custom", start: month, end: undefined };
      const start = prev.start!;
      // Picking backwards is a legitimate way to select; it just means the span
      // runs the other way.
      return month < start
        ? { kind: "custom", start: month, end: start }
        : { kind: "custom", start, end: month };
    });
  }

  function choosePreset(kind: RangeKind) {
    onChange({ kind });
    setOpen(false);
  }

  function apply() {
    // An unfinished span means one month, which is what a single click reads as.
    const next: ReviewRange =
      draft.kind === "custom" && draft.start && !draft.end
        ? { kind: "custom", start: draft.start, end: draft.start }
        : draft;
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="period-selector" ref={wrap}>
      <button
        type="button"
        className="period-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <CalendarIcon />
        {spanLabel(span.start, span.end)}
      </button>

      {open && (
        <div className="period-pop" role="dialog" aria-label="Choose a review period">
          <div className="period-pop-body">
            <div className="period-cal">
              <div className="period-cal-head">
                <span className="period-cal-year">{year}</span>
                <span className="period-cal-nav">
                  <button
                    type="button"
                    aria-label="Previous year"
                    onClick={() => setYear(year - 1)}
                  >
                    <Chevron dir="left" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next year"
                    disabled={year >= Number(thisMonth.slice(0, 4))}
                    onClick={() => setYear(year + 1)}
                  >
                    <Chevron dir="right" />
                  </button>
                </span>
              </div>
              <div className="period-months">
                {MONTHS.map((name, i) => {
                  const month = `${year}-${String(i + 1).padStart(2, "0")}`;
                  const edge = month === span.start || month === span.end;
                  const inside = month > span.start && month < span.end;
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`period-month${edge ? " edge" : inside ? " inside" : ""}`}
                      aria-pressed={edge || inside}
                      // Months that have not happened cannot have spend in them.
                      disabled={month > thisMonth}
                      onClick={() => pickMonth(month)}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>

            <ul className="period-presets">
              {PRESETS.map((preset) => (
                <li key={preset.kind}>
                  <button
                    type="button"
                    className={value.kind === preset.kind ? "active" : ""}
                    aria-current={value.kind === preset.kind}
                    onClick={() => choosePreset(preset.kind)}
                  >
                    {preset.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="period-span">
            <label>
              Start
              <input
                type="month"
                value={draft.kind === "custom" ? (draft.start ?? "") : span.start}
                max={draft.end ?? thisMonth}
                onChange={(e) =>
                  setDraft({ kind: "custom", start: e.target.value, end: draft.end ?? span.end })
                }
              />
            </label>
            <label>
              End
              <input
                type="month"
                value={draft.kind === "custom" ? (draft.end ?? "") : span.end}
                min={draft.start}
                max={thisMonth}
                onChange={(e) =>
                  setDraft({
                    kind: "custom",
                    start: draft.start ?? span.start,
                    end: e.target.value,
                  })
                }
              />
            </label>
          </div>

          <div className="period-foot">
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
