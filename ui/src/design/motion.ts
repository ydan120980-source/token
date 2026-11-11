// The only motion values the React layer may use (docs/m2/UI-SPEC-20261025.md, "动效").
// Owner decision 2026-10-29 (docs/m2/UI-MOTION-APPLE-20261029.md): the kit follows Apple's motion
// system (HIG "Motion"; WWDC 2018 "Designing Fluid Interfaces"):
// - purposeful, brief and precise; frequent interactions get the least motion;
// - every animation is a spring that starts from the value on screen, so it can be interrupted;
// - feedback, controls and data are critically damped; surfaces keep a slight bounce and a gesture's
//   momentum adds a little more;
// - a gesture's release velocity carries into the spring, its landing point is projected from that
//   velocity, and edges resist progressively instead of stopping hard;
// - reduced motion drops movement and cross-fades instead (reducedFade); off jumps to the end.
import { spring } from "@/lib/springs";

export { spring };

// Data tier: bars growing, a ring sweeping, digits rolling, a line drawing. Critically damped springs,
// shorter than a surface: a chart's first appearance, then quicker in-place changes with no stagger.
export const data = {
  enter: { type: "spring" as const, duration: 0.5, bounce: 0 },
  // A change of value within the same chart continues from the geometry currently drawn.
  update: { type: "spring" as const, duration: 0.3, bounce: 0 },
  // A trend line drawing itself from the left edge after each switch (range, grain, Agent, view), owner 2026-11-01:
  // slower than a bar growing, so the eye can follow the line across the plot.
  sweep: { type: "spring" as const, duration: 0.9, bounce: 0 },
  // A trend line reshaping in place (a series shown or hidden, new data): the line is long, so it moves at the
  // entry pace rather than the quick value tier.
  reshape: { type: "spring" as const, duration: 0.5, bounce: 0 },
  // A highlight band or marker following the pointer: Apple's interactive spring, nearly 1:1.
  follow: { type: "spring" as const, duration: 0.15, bounce: 0 },
  // Delay between siblings entering together, capped so the whole set lands within enter + maxStagger.
  stagger: 0.015,
  maxStagger: 0.12,
} as const;

// Text too long for its place slides at this steady pace while pointed at (owner 2026-11-02), after a short
// pause so a pointer passing over it does not set it off.
export const marquee = { pixelsPerSecond: 32, pause: 0.5, gap: 32 } as const;

// Time for a chart's first appearance to land, in seconds (springs have no fixed duration).
export const dataSettle = data.enter.duration + data.maxStagger;

// Stagger delay for the index-th of several siblings entering together.
export function staggerDelay(index: number): number {
  return Math.min(index * data.stagger, data.maxStagger);
}

// Reduced motion (Apple: a gentler, non-vestibular equivalent): nothing moves, changes cross-fade.
export const reducedFade = { type: "tween" as const, duration: 0.2, ease: "easeOut" as const };

// No movement: switched-off motion jumps straight to the final state.
export const instant = { duration: 0 } as const;

// ── Gestures (Designing Fluid Interfaces) ─────────────────────────────────

// Where a flick comes to rest: Apple's deceleration projection, not v²/2a.
// velocity in px/s; decelerationRate 0.998 is scroll-like, 0.99 snappier.
export function project(velocity: number, decelerationRate = 0.998): number {
  return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

// Progressive resistance past an edge: the further past, the less the element follows.
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Release velocity from the last ~100 ms of pointer samples (px/s), so a drag ends with the speed
// the pointer actually had, not the speed of its last frame.
export function velocityTracker(window = 100) {
  let samples: { at: number; value: number }[] = [];
  return {
    reset(value: number, at = performance.now()) { samples = [{ at, value }]; },
    add(value: number, at = performance.now()) {
      samples.push({ at, value });
      while (samples.length > 2 && at - samples[0].at > window) samples.shift();
    },
    velocity(): number {
      if (samples.length < 2) return 0;
      const first = samples[0], last = samples[samples.length - 1], span = last.at - first.at;
      return span > 0 ? (last.value - first.value) / span * 1000 : 0;
    },
  };
}
