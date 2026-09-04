/**
 * The one piece of chart maths worth sharing between charts.
 *
 * Kept out of any component so both the Overview's spend trend and the
 * classification chart pick a ceiling the same way — two charts of the same
 * numbers landing on different round figures would be its own small lie.
 */

/** A "nice" axis ceiling at or above `value` — 1/2/2.5/5/10 times a power of ten.
 *
 * An axis that topped out at the data would put the tallest bar flush against
 * the frame and give the reader no round number to measure against.
 */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / magnitude;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * magnitude;
}

/** The fractions of the ceiling a gridline is drawn at, bottom to top. */
export const GRID_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;
