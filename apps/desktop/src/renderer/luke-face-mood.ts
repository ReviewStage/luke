import { useEffect, useRef, useState } from "react";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "./luke-face-art";

/**
 * Everything Luke reacts to. It is deliberately the same material the count
 * badge reports — sessions, and whether the microphone is open — because the
 * face is the one thing the capsule always has room for, and a face that knew
 * something the panel did not would be a second, quieter source of truth.
 */
export interface FaceContext {
  speaking: boolean;
  microphoneLive: boolean;
  attention: number;
  working: number;
  complete: number;
  total: number;
}

/**
 * What Luke settles into. These are loops rather than gestures: whatever is true
 * stays true, so the face has to be able to say it indefinitely without becoming
 * something you notice.
 */
export function restingMotion(context: FaceContext): FaceMotion {
  if (context.speaking) return FACE_MOTION.TALKING;
  if (context.microphoneLive) return FACE_MOTION.LISTENING;
  // Someone is needed. The fidget is the only rest that reads as impatience,
  // and it is the one rest nothing playful is allowed to interrupt.
  if (context.attention > 0) return FACE_MOTION.WAITING;
  if (context.working > 0) return FACE_MOTION.MONITORING;
  // Nothing to watch at all, which is a different thing from nothing happening.
  if (context.total === 0) return FACE_MOTION.SLEEPING;
  return FACE_MOTION.IDLE;
}

/** The rests an aside may interrupt: the ones where nobody is being kept waiting. */
const RESTFUL: ReadonlySet<FaceMotion> = new Set([
  FACE_MOTION.IDLE,
  FACE_MOTION.MONITORING,
  FACE_MOTION.SLEEPING,
]);

/**
 * Gestures Luke makes for no reason at all. They are what keeps a permanent
 * fixture from reading as a static one — a face that only ever blinks is a
 * screensaver — and they are all short, so the rest underneath is still what the
 * strip mostly says. Nothing here means anything; the ones that do are chosen by
 * `restingMotion` or fired at a session arriving or finishing.
 */
export const IDLE_ASIDES: readonly FaceMotion[] = [
  FACE_MOTION.WINK,
  FACE_MOTION.TEASE,
  FACE_MOTION.YES,
  FACE_MOTION.BOOP,
  FACE_MOTION.REVIEWING,
  FACE_MOTION.ATTENTION,
  FACE_MOTION.FLOATING,
  FACE_MOTION.HIDING,
];

/**
 * Far enough apart that an aside is a surprise rather than a rhythm. A fixture
 * that moves on a timetable is one you start reading as a clock.
 */
const ASIDE_MIN_MS = 9_000;
const ASIDE_MAX_MS = 26_000;
const asideDelay = () => ASIDE_MIN_MS + Math.random() * (ASIDE_MAX_MS - ASIDE_MIN_MS);

/** Never the same aside twice running: repetition is what makes a loop visible. */
export function nextAside(previous: FaceMotion | undefined): FaceMotion {
  const choices = IDLE_ASIDES.filter((motion) => motion !== previous);
  // There is always more than one aside to choose from, so dropping the last one
  // played can never empty the list; the fallback answers the type, not a case.
  return choices[Math.floor(Math.random() * choices.length)] ?? FACE_MOTION.WINK;
}

/** Reduced motion is a setting, not a media query the stylesheet alone can answer:
 * holding every loop still leaves the poses, and switching between poses is the
 * motion someone asked not to see. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/**
 * The motion Luke is playing: a rest, or a gesture that has taken the face for
 * one cycle. Gestures always give it back — nothing here can leave the face
 * stuck saying something that has stopped being true.
 */
export function useFaceMotion(context: FaceContext, still: boolean): FaceMotion {
  const resting = restingMotion(context);
  const [gesture, setGesture] = useState<FaceMotion>();
  const lastAside = useRef<FaceMotion | undefined>(undefined);
  const observed = useRef({ total: context.total, complete: context.complete });
  const { total, complete } = context;

  // A session arriving or finishing is worth reacting to once, rather than for
  // as long as it stays true. Seeded from the first render, so a panel that
  // opens onto four running sessions does not greet all four of them.
  useEffect(() => {
    const previous = observed.current;
    observed.current = { total, complete };
    if (still) return;
    if (complete > previous.complete) setGesture(FACE_MOTION.SUCCESS);
    else if (total > previous.total) setGesture(FACE_MOTION.NOTIFICATION);
  }, [total, complete, still]);

  // Every gesture is a one-shot. The artwork loops — each one is drawn with its
  // own rest built into the tail — so the cycle length is what says when it has
  // been seen.
  useEffect(() => {
    if (gesture === undefined) return;
    const timer = window.setTimeout(() => setGesture(undefined), FACE_MOTION_CYCLE_MS[gesture]);
    return () => window.clearTimeout(timer);
  }, [gesture]);

  const restful = RESTFUL.has(resting);
  useEffect(() => {
    if (still || !restful || gesture !== undefined) return;
    const timer = window.setTimeout(() => {
      const aside = nextAside(lastAside.current);
      lastAside.current = aside;
      setGesture(aside);
    }, asideDelay());
    return () => window.clearTimeout(timer);
  }, [gesture, restful, still]);

  // Held still, the face keeps one pose rather than a quieter set of them: the
  // stylesheet stops the loops, and this stops the poses changing underneath.
  if (still) return FACE_MOTION.IDLE;
  return gesture ?? resting;
}
