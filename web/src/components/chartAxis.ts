/**
 * The one piece of chart maths worth sharing between charts.
 *
 * Kept out of any component so both the Overview's spend trend and the
 * classification chart pick a ceiling the same way — two charts of the same
 * numbers landing on different round figures would be its own small lie.
 */

/** The default ladder: coarse, so a bar chart's axis reads at a glance. */
export const COARSE_STEPS = [1, 2, 2.5, 5, 10] as const;

/** A finer ladder, for a chart where a reference line has to sit somewhere
 *  legible against the data — a budget at $50K under a $58K forecast is lost on
 *  an axis that jumps straight from $50K to $100K. */
export const FINE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;

/** A "nice" axis ceiling at or above `value` — one of `steps` times a power of ten.
 *
 * An axis that topped out at the data would put the tallest bar flush against
 * the frame and give the reader no round number to measure against.
 */
export function niceCeil(value: number, steps: readonly number[] = COARSE_STEPS): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / magnitude;
  const step = steps.find((s) => n <= s) ?? 10;
  return step * magnitude;
}

/** The fractions of the ceiling a gridline is drawn at, bottom to top. */
export const GRID_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;
