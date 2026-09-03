/**
 * Smooth curves for line charts — flowing, but incapable of inventing a value.
 *
 * The tension here is between two things a cost chart needs at once:
 *
 *   1. It should look like a curve, not a folded ribbon. That means Catmull-Rom
 *      style tangents, which aim each point at its NEIGHBOURS, so the line
 *      sweeps through a peak with a rounded shoulder.
 *   2. It must never draw money that was not spent. Plain Catmull-Rom fails
 *      this: it overshoots, arcing above a peak and dipping below a floor. On
 *      $0, $0, $900 it renders a negative spend that never happened.
 *
 * The resolution is to take Catmull-Rom's flowing tangents and then CLAMP each
 * segment's two control points into the y-range of the two points it joins. A
 * cubic Bézier is contained in the convex hull of its control points, so once
 * all four sit inside that range the drawn curve cannot leave it either. Where
 * the spline would have overshot it is pulled back to exactly the data value;
 * everywhere else it keeps its full curvature.
 *
 * Result: rounder than monotone cubic (which flattens the tangent at every
 * local extremum, and so corners at each peak), with the same guarantee.
 */

export type Pt = { px: number; py: number };

/** Catmull-Rom tangents: each point's direction is set by its neighbours. */
function tangents(pts: Pt[]): number[] {
  const n = pts.length;
  const m: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    const dx = next.px - prev.px;
    m[i] = dx === 0 ? 0 : (next.py - prev.py) / dx;
  }
  return m;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How far along each segment the control points reach, as a fraction of its
 * width. The textbook cubic Hermite uses 1/3; pushing it toward 1/2 makes the
 * curve hold its tangent for longer, which widens the rounded apex at a peak
 * from a couple of pixels into a visible shoulder. The no-overshoot guarantee is
 * unaffected — it comes from clamping the control points' Y, and holds for any
 * reach up to 1/2 (beyond that the controls would cross and the line could
 * double back on itself).
 */
const REACH = 0.5;

/** An SVG path through every point: smooth, and never outside the data. */
export function smoothLine(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].px},${pts[0].py}`;
  if (pts.length === 2) return `M${pts[0].px},${pts[0].py}L${pts[1].px},${pts[1].py}`;

  const m = tangents(pts);
  let d = `M${pts[0].px},${pts[0].py}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.px - a.px;
    // The two values this segment joins are the ceiling and floor for it.
    const lo = Math.min(a.py, b.py);
    const hi = Math.max(a.py, b.py);
    const reach = dx * REACH;
    const c1y = clamp(a.py + m[i] * reach, lo, hi);
    const c2y = clamp(b.py - m[i + 1] * reach, lo, hi);
    d += `C${a.px + reach},${c1y} ${b.px - reach},${c2y} ${b.px},${b.py}`;
  }
  return d;
}

/** The same curve, closed down to a baseline — the tinted area under the line. */
export function smoothArea(pts: Pt[], baselineY: number): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `M${first.px},${baselineY}L${smoothLine(pts).slice(1)}L${last.px},${baselineY}Z`;
}
