// Motion tokens, Apple motion system (owner 2026-10-29, docs/m2/UI-MOTION-APPLE-20261029.md).
// Each tier's value is the ENTER transition — a spring: the small tiers are critically damped,
// surfaces keep a slight bounce and momentum follows a gesture's velocity. Its `.exit` is the
// matching EXIT transition — a plain tween one tier quicker, so a dismissal reads as crisp and final
// rather than replaying the entrance.
//
//   transition={spring.fast}                              // enter
//   exit={{ opacity: 0, transition: spring.fast.exit }}   // leave
//
// The bigger the thing that moves, the slower the spring. Never hand-write a duration — always reach
// for a tier. Springs start from the value on screen, so every tier is interruptible.
export const spring = {
  // Feedback: focus rings, colour and fill changes, fades, tooltips. Brief and precise.
  fast: {
    type: "spring" as const,
    duration: 0.1,
    bounce: 0,
    exit: { duration: 0.08 },
  },
  // Controls: segmented indicators, switch thumbs, menus and dropdowns, disclosures.
  moderate: {
    type: "spring" as const,
    duration: 0.2,
    bounce: 0,
    exit: { duration: 0.14 },
  },
  // Surfaces: sheets, panels, slides, large rearrangements, with the slight bounce the owner kept.
  slow: {
    type: "spring" as const,
    duration: 0.32,
    bounce: 0.12,
    exit: { duration: 0.2 },
  },
  // A sheet attached to a window edge: the surface pace without the overshoot, which would lift it off the edge.
  edge: {
    type: "spring" as const,
    duration: 0.32,
    bounce: 0,
    exit: { duration: 0.2 },
  },
  // Momentum: only after a flick or drag release, started with the gesture's velocity (Apple's
  // drawer/sheet spring, damping ~0.8). Never for something that merely opened.
  momentum: {
    type: "spring" as const,
    duration: 0.4,
    bounce: 0.15,
    exit: { duration: 0.2 },
  },
} as const;

// Fallback delay (ms) for deferred-unmount timers that guard an exit tween:
// popups keep their portal mounted until onAnimationComplete fires, but a
// throttled/background tab can stall the animation, so a timer force-unmounts
// after the tier's exit duration plus a safety buffer. Deriving it here keeps
// the timers in step with the tokens above.
export const exitFallbackMs = (tier: { exit: { duration: number } }) =>
  Math.round(tier.exit.duration * 1000) + 100;
