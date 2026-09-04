/**
 * The dot field's geometry and motion, with no canvas in sight.
 *
 * Separated from the component so the behaviour can be tested directly: that a
 * dot flees the cursor rather than approaching it, that the push has a ceiling,
 * that a dot sitting exactly under the cursor does not divide by zero, and that
 * everything finds its way home once the cursor leaves.
 */

/** Grid pitch, in CSS pixels — the marketing site's own spacing. */
export const SPACING = 26;
/** Dot radius at rest. */
export const DOT_R = 1.75;
/** How close the cursor has to be to move a dot at all. */
export const INFLUENCE = 130;
/** How far the nearest dots are pushed, at most. */
export const MAX_PUSH = 24;
/** Per-frame easing towards the target offset — high enough to feel immediate,
 *  low enough that the return is a glide rather than a snap. */
export const EASE = 0.16;
/** Below this the dot is home, and the loop can stop caring about it. */
export const SETTLED = 0.05;

export interface Dot {
  /** Grid position. */
  hx: number;
  hy: number;
  /** Current displacement from it. */
  dx: number;
  dy: number;
}

/** The grid that fills a box, inset by half a cell so it is not clipped. */
export function buildGrid(width: number, height: number): Dot[] {
  const dots: Dot[] = [];
  for (let y = SPACING / 2; y < height; y += SPACING) {
    for (let x = SPACING / 2; x < width; x += SPACING) {
      dots.push({ hx: x, hy: y, dx: 0, dy: 0 });
    }
  }
  return dots;
}

/**
 * Advance every dot one frame, in place. Returns whether anything still moved,
 * which is what lets the animation loop stop instead of idling forever.
 *
 * Pure and exported so the behaviour can be tested without a canvas: that a dot
 * flees rather than approaches, that the push has a limit, that a dot directly
 * under the cursor does not divide by zero, and that everything comes home.
 */
export function settle(dots: Dot[], pointer: { x: number; y: number } | null): boolean {
  let moving = false;
  for (const dot of dots) {
    let tx = 0;
    let ty = 0;
    if (pointer) {
      const ax = dot.hx - pointer.x;
      const ay = dot.hy - pointer.y;
      const dist = Math.hypot(ax, ay);
      if (dist < INFLUENCE) {
        // Squared falloff: a tight core that pushes hard, a long soft edge.
        const force = (1 - dist / INFLUENCE) ** 2;
        // A dot exactly under the cursor has no direction to flee, so it is
        // nudged along a fixed diagonal rather than dividing by zero.
        const ux = dist ? ax / dist : Math.SQRT1_2;
        const uy = dist ? ay / dist : Math.SQRT1_2;
        tx = ux * force * MAX_PUSH;
        ty = uy * force * MAX_PUSH;
      }
    }
    dot.dx += (tx - dot.dx) * EASE;
    dot.dy += (ty - dot.dy) * EASE;
    if (Math.abs(dot.dx) > SETTLED || Math.abs(dot.dy) > SETTLED) moving = true;
    else {
      dot.dx = 0;
      dot.dy = 0;
    }
  }
  return moving;
}
