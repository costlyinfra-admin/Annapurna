/**
 * Smooth curves for line charts, using MONOTONE cubic interpolation.
 *
 * The choice matters on a cost chart. The usual smoothing splines (Catmull-Rom,
 * cardinal) overshoot: run one through $0, $0, $900 and it dips below zero
 * before the climb, and run one through a peak and it arcs above the highest
 * point. On a spend trend that draws money that was never spent, which is
 * exactly the kind of invented number this product refuses to show.
 *
 * Monotone cubic (Fritsch–Carlson) fixes the tangents so each segment stays
 * within the two values it joins: the curve is smooth, but it never invents a
 * peak, a trough, or a negative. Same guarantee as d3's curveMonotoneX.
 */

export type Pt = { px: number; py: number };

/** Tangents at each point, limited so no segment can overshoot its endpoints. */
function tangents(pts: Pt[]): number[] {
  const n = pts.length;
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].px - pts[i].px;
    secant.push(dx === 0 ? 0 : (pts[i + 1].py - pts[i].py) / dx);
  }

  const m: number[] = new Array(n);
  m[0] = secant[0];
  m[n - 1] = secant[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A sign change means this point is a local peak or trough: flatten the
    // tangent so the curve turns AT the data point rather than sailing past it.
    m[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  }

  // Fritsch–Carlson limiter: keep each tangent inside a circle of radius 3
  // around its secant, which is the condition for monotonicity.
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / secant[i];
    const b = m[i + 1] / secant[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * secant[i];
      m[i + 1] = t * b * secant[i];
    }
  }
  return m;
}

/** An SVG path through every point, smooth and free of overshoot. */
export function smoothLine(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].px},${pts[0].py}`;
  if (pts.length === 2) return `M${pts[0].px},${pts[0].py}L${pts[1].px},${pts[1].py}`;

  const m = tangents(pts);
  let d = `M${pts[0].px},${pts[0].py}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].px - pts[i].px;
    // Hermite tangents converted to the two cubic control points.
    const c1x = pts[i].px + dx / 3;
    const c1y = pts[i].py + (m[i] * dx) / 3;
    const c2x = pts[i + 1].px - dx / 3;
    const c2y = pts[i + 1].py - (m[i + 1] * dx) / 3;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].px},${pts[i + 1].py}`;
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
