/**
 * token-spring.ts -- the transitions Motion plays on, read from the motion tokens where it plays: a physical spring fitted to the brand's sampled one, and a fade on the exit easing.
 *
 * The brand's springs are sampled curves (`--luke-spring` as a `linear()`
 * list) played over a duration token, so a stylesheet's spring always takes
 * the same time and starts from rest. Motion's spring is a physical one, a
 * stiffness and a damping, which can start moving: it carries the speed a
 * gesture let go at. This reads the sampled curve and its duration as they
 * stand at the element and fits the one damped spring that overshoots as
 * far, as late: the overshoot gives the damping ratio and its moment the
 * frequency. So a fling released at rest lands as a stylesheet's travel
 * would, and one released moving carries on from where the finger left it.
 *
 * Reduced motion and a capture run zero the durations; `motionHeld` reads
 * them, never Motion's own `useReducedMotion`, which a capture run does not
 * touch, and the transition answered is then instant.
 */

import type { Transition } from "motion/react";
import { MOTION_TOKEN, milliseconds, motionHeld } from "../motion-timing.js";

/** What a move plays on where motion is held still, or before anything has asked it to move: nothing, at once. */
export const HELD_TRANSITION = { duration: 0 } as const satisfies Transition;

/** A damped spring, as Motion takes it: a unit mass, its stiffness and its damping. */
interface SpringShape {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

/** A sampled curve's numbers, the `linear()` easing's points in order; none where it is none. */
function samplesOf(value: string): readonly number[] {
  const inner = /linear\(([^)]*)\)/u.exec(value)?.[1];
  if (inner === undefined) return [];
  return inner.split(",").map((point) => Number.parseFloat(point));
}

/**
 * Where a sampled curve stands highest, as a fractional index and its value:
 * the vertex of the parabola through the highest sample and its neighbours,
 * since the true peak falls between samples.
 */
function peakOf(samples: readonly number[]): { readonly at: number; readonly value: number } {
  let top = 1;
  for (let index = 2; index < samples.length - 1; index++) {
    if ((samples[index] ?? 0) > (samples[top] ?? 0)) top = index;
  }
  const before = samples[top - 1] ?? 0;
  const at = samples[top] ?? 0;
  const after = samples[top + 1] ?? 0;
  const bend = before - 2 * at + after;
  if (bend === 0) return { at: top, value: at };
  const offset = (0.5 * (before - after)) / bend;
  return { at: top + offset, value: at - 0.25 * (before - after) * offset };
}

/**
 * The damped spring whose step response overshoots as far, and as late, as
 * the sampled curve played over `durationMs`; none for a curve with no
 * overshoot, which is no spring this can fit, as the brand's never are.
 */
function springFromSamples(
  samples: readonly number[],
  durationMs: number,
): SpringShape | undefined {
  if (samples.length < 3 || durationMs <= 1) return undefined;
  const peak = peakOf(samples);
  const overshoot = peak.value - 1;
  if (!(overshoot > 0)) return undefined;
  const decay = Math.log(overshoot);
  const ratio = -decay / Math.sqrt(Math.PI * Math.PI + decay * decay);
  const peakSeconds = (peak.at / (samples.length - 1)) * (durationMs / 1000);
  const frequency = Math.PI / (peakSeconds * Math.sqrt(1 - ratio * ratio));
  return { stiffness: frequency * frequency, damping: 2 * ratio * frequency, mass: 1 };
}

/**
 * The spring a travel plays on at `element`, fitted to the spring and
 * duration tokens named as they stand there, or an instant move where motion
 * is held still or the token is no sampled spring. The speed it starts at is
 * the value's own, so one a gesture let go of carries its fling.
 */
export function tokenSpring(
  element: Element,
  durationToken: string = MOTION_TOKEN.DURATION_SHAPE,
  springToken: string = MOTION_TOKEN.SPRING,
): Transition {
  if (motionHeld(element)) return HELD_TRANSITION;
  const style = getComputedStyle(element);
  const samples = samplesOf(style.getPropertyValue(springToken));
  const spring = springFromSamples(samples, milliseconds(style.getPropertyValue(durationToken)));
  return spring === undefined ? HELD_TRANSITION : { type: "spring", ...spring };
}

/** A `cubic-bezier()` easing's four numbers, as Motion takes them; none where it is none. */
function bezierOf(value: string): [number, number, number, number] | undefined {
  const points = /cubic-bezier\(([^)]*)\)/u.exec(value)?.[1]?.split(",").map(Number.parseFloat);
  if (points?.length !== 4 || points.some((point) => !Number.isFinite(point))) return undefined;
  return [points[0] ?? 0, points[1] ?? 0, points[2] ?? 0, points[3] ?? 0];
}

/**
 * The fade an arrival or a leaving plays on at `element`, over the duration
 * and easing tokens named, or an instant one where motion is held still.
 */
export function tokenFade(
  element: Element,
  durationToken: string = MOTION_TOKEN.DURATION_QUICK,
  easingToken: string = MOTION_TOKEN.EASE_EXIT,
): Transition {
  if (motionHeld(element)) return HELD_TRANSITION;
  const style = getComputedStyle(element);
  const ease = bezierOf(style.getPropertyValue(easingToken));
  const duration = milliseconds(style.getPropertyValue(durationToken)) / 1000;
  return ease === undefined ? { duration } : { duration, ease };
}

/**
 * How far a fling released at `velocity`, in pixels a second, carries in one
 * beat of the duration token named at `element`: where the gesture would be
 * had it kept its speed, which is what a release is judged by. Held still,
 * there is no beat, so a fling carries nowhere and its distance alone counts.
 */
export function tokenReach(
  element: Element,
  velocity: number,
  durationToken: string = MOTION_TOKEN.DURATION_FAST,
): number {
  if (motionHeld(element)) return 0;
  const beat = milliseconds(getComputedStyle(element).getPropertyValue(durationToken)) / 1000;
  return velocity * beat;
}
