import { describe, expect, it } from "vitest";
import { INFLUENCE, MAX_PUSH, SPACING, buildGrid, settle, type Dot } from "./dotPhysics";

const dot = (hx: number, hy: number): Dot => ({ hx, hy, dx: 0, dy: 0 });
const shift = (d: Dot) => Math.hypot(d.dx, d.dy);

/** Run the ease until it stops moving, or give up (which is itself a failure). */
function run(dots: Dot[], pointer: { x: number; y: number } | null, frames = 400): number {
  for (let i = 0; i < frames; i++) if (!settle(dots, pointer)) return i;
  return frames;
}

describe("dot field motion", () => {
  it("fills its box on the site's grid, inset rather than clipped", () => {
    const dots = buildGrid(100, 100);
    expect(dots[0]).toMatchObject({ hx: SPACING / 2, hy: SPACING / 2 });
    expect(Math.max(...dots.map((d) => d.hx))).toBeLessThan(100);
    expect(dots.length).toBe(16); // 4 x 4 at a 26px pitch
  });

  it("pushes a dot away from the cursor, not towards it", () => {
    const d = dot(120, 100);
    run([d], { x: 100, y: 100 });
    // The cursor is to its left, so it flees right and does not drift vertically.
    expect(d.dx).toBeGreaterThan(0);
    expect(Math.abs(d.dy)).toBeLessThan(0.01);
  });

  it("never pushes further than the cap, however close the cursor gets", () => {
    for (const gap of [0, 1, 5, 20, 60]) {
      const d = dot(100 + gap, 100);
      run([d], { x: 100, y: 100 });
      expect(shift(d)).toBeLessThanOrEqual(MAX_PUSH + 0.001);
    }
  });

  it("moves near dots more than far ones", () => {
    const near = dot(120, 100);
    const mid = dot(180, 100);
    const far = dot(240, 100);
    run([near, mid, far], { x: 100, y: 100 });
    expect(shift(near)).toBeGreaterThan(shift(mid));
    expect(shift(mid)).toBeGreaterThan(shift(far));
  });

  it("leaves dots beyond its reach alone", () => {
    const d = dot(100 + INFLUENCE, 100);
    run([d], { x: 100, y: 100 });
    expect(shift(d)).toBe(0);
  });

  it("moves a dot sitting exactly under the cursor, without going NaN", () => {
    // A zero-length vector has no direction; the naive version divides by zero.
    const d = dot(100, 100);
    run([d], { x: 100, y: 100 });
    expect(Number.isFinite(d.dx)).toBe(true);
    expect(Number.isFinite(d.dy)).toBe(true);
    expect(shift(d)).toBeCloseTo(MAX_PUSH, 1);
  });

  it("brings everything home once the cursor leaves", () => {
    const dots = buildGrid(200, 200);
    run(dots, { x: 100, y: 100 });
    expect(dots.some((d) => shift(d) > 0)).toBe(true);

    const frames = run(dots, null);
    expect(frames).toBeLessThan(400); // it settles rather than easing forever
    // Exactly home, not merely close: a residue would keep the loop awake.
    expect(dots.every((d) => d.dx === 0 && d.dy === 0)).toBe(true);
  });

  it("reports when it is still moving, so the loop knows to keep going", () => {
    const d = dot(110, 100);
    expect(settle([d], { x: 100, y: 100 })).toBe(true);
    // Undisturbed and unpushed: nothing to animate.
    expect(settle([dot(1000, 1000)], null)).toBe(false);
  });
});
