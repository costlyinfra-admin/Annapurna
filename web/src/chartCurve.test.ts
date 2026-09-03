import { describe, expect, it } from "vitest";
import { smoothArea, smoothLine, type Pt } from "./chartCurve";

/** Walk a cubic path and return every y it actually reaches. */
function sampleY(d: string): number[] {
  const nums = (s: string) =>
    s
      .trim()
      .split(/[\s,]+/)
      .map(Number);
  const segs = d.match(/[MLC][^MLCZ]*/g) ?? [];
  let cur: [number, number] = [0, 0];
  const ys: number[] = [];
  for (const seg of segs) {
    const v = nums(seg.slice(1));
    if (seg[0] === "M" || seg[0] === "L") {
      cur = [v[0], v[1]];
      ys.push(cur[1]);
    } else {
      const [, c1y, , c2y, ex, ey] = v; // only the y controls matter here
      for (let t = 0; t <= 1; t += 0.02) {
        const u = 1 - t;
        ys.push(u * u * u * cur[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey);
      }
      cur = [ex, ey];
    }
  }
  return ys;
}

const pts = (ys: number[]): Pt[] => ys.map((py, i) => ({ px: i * 100, py }));

describe("smoothLine", () => {
  it("passes exactly through every data point", () => {
    const d = smoothLine(pts([100, 40, 90, 20]));
    // Each point appears as a curve endpoint, so the line is smoothed, not fitted.
    expect(d.startsWith("M0,100")).toBe(true);
    expect(d).toContain("100,40");
    expect(d).toContain("200,90");
    expect(d.endsWith("300,20")).toBe(true);
  });

  it("never overshoots a peak or a trough", () => {
    // The reason for monotone cubic. A Catmull-Rom through these would arc past
    // the peak and dip under the floor — on a spend chart, money never spent.
    // (SVG y is inverted: a smaller y is a taller bar.)
    const data = [150, 150, 20, 150];
    const ys = sampleY(smoothLine(pts(data)));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(Math.min(...data) - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(Math.max(...data) + 1e-9);
  });

  it("stays flat across equal values instead of rippling", () => {
    const ys = sampleY(smoothLine(pts([80, 80, 80, 80])));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1e-9);
  });

  it("does not dip below zero climbing off a flat floor", () => {
    // $0, $0, then a spike: the classic case that sends a naive spline negative.
    const floor = 200; // y for $0
    const ys = sampleY(smoothLine(pts([floor, floor, 10])));
    expect(Math.max(...ys)).toBeLessThanOrEqual(floor + 1e-9);
  });

  it("handles the degenerate sizes a short range produces", () => {
    expect(smoothLine([])).toBe("");
    expect(smoothLine(pts([50]))).toBe("M0,50");
    expect(smoothLine(pts([50, 20]))).toBe("M0,50L100,20");
  });
});

describe("smoothArea", () => {
  it("closes the same curve down to the baseline", () => {
    const d = smoothArea(pts([100, 40, 90]), 200);
    expect(d.startsWith("M0,200L")).toBe(true); // up from the baseline
    expect(d.endsWith("L200,200Z")).toBe(true); // and back down to it
    expect(d).toContain("C"); // via the curve, not straight segments
  });

  it("is empty when there is nothing to draw", () => {
    expect(smoothArea([], 200)).toBe("");
  });
});
