/**
 * The dot grid that scatters away from the cursor, as on costlyinfra.com's hero.
 *
 * A canvas rather than CSS, because the dots have to move independently — and a
 * canvas because there are a few thousand of them and each is two drawing
 * operations, which is nothing for a canvas and a great deal of DOM.
 *
 * Three things keep it from being a battery tax:
 *   * the loop only runs while something is actually moving — a pointer inside
 *     the field, or dots still easing home after it left;
 *   * it is `pointer-events: none`, so it never intercepts a click on the form
 *     it sits behind;
 *   * `prefers-reduced-motion` gets the grid drawn once and left alone.
 *
 * Geometry matches the marketing site: a 26px grid of ~3.5px dots. Displaced
 * dots tint towards lime and swell slightly, which is what makes the scatter
 * read as an effect rather than as a rendering glitch.
 */
import { useEffect, useRef } from "react";
import { DOT_R, MAX_PUSH, buildGrid, settle, type Dot } from "./dotPhysics";

function readColours() {
  const style = getComputedStyle(document.documentElement);
  return {
    dot: style.getPropertyValue("--dot-ink").trim() || "rgba(26, 28, 23, 0.22)",
    lime: style.getPropertyValue("--lime").trim() || "#ddf859",
  };
}

export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    // jsdom has no canvas; the field is decorative, so absence is not a failure.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let colours = readColours();
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;

    function layout() {
      const rect = parent!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = buildGrid(width, height);
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      for (const dot of dots) {
        const shift = Math.hypot(dot.dx, dot.dy);
        const t = Math.min(1, shift / MAX_PUSH);
        ctx!.beginPath();
        ctx!.arc(dot.hx + dot.dx, dot.hy + dot.dy, DOT_R * (1 + t * 0.4), 0, Math.PI * 2);
        ctx!.fillStyle = colours.dot;
        ctx!.fill();
        if (t > 0.04) {
          // The further a dot has been pushed, the more of the brand it picks up.
          ctx!.globalAlpha = t * 0.85;
          ctx!.fillStyle = colours.lime;
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
      }
    }

    function tick() {
      const moving = settle(dots, pointer);
      draw();
      // Keep going while the pointer is here (it may move) or dots are returning.
      frame = moving || pointer ? requestAnimationFrame(tick) : 0;
    }

    function wake() {
      if (!frame && !still) frame = requestAnimationFrame(tick);
    }

    function onMove(event: PointerEvent) {
      const rect = parent!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      pointer = x < 0 || y < 0 || x > rect.width || y > rect.height ? null : { x, y };
      wake();
    }

    function onLeave() {
      pointer = null;
      wake();
    }

    layout();
    draw();

    const resize = new ResizeObserver(() => {
      layout();
      draw();
    });
    resize.observe(parent);

    // The palette flips with the theme, and the canvas has to be told.
    const theme = new MutationObserver(() => {
      colours = readColours();
      draw();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    if (!still) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
      window.addEventListener("blur", onLeave);
    }

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return <canvas ref={ref} className="dot-field" aria-hidden />;
}
