import { useEffect, useRef, useState } from "react";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "./luke-face-art";

/**
 * Everything Luke reacts to. It is deliberately the same material the count
 * badge reports — sessions, and whether the microphone is open — because the
 * face is the one thing the capsule always has room for, and a face that knew
 * something the panel did not would be a second, quieter source of truth.
 *
 * The sessions asking for a person arrive as ids rather than as a count,
 * because what the face owes them is one nudge each as they start asking, and a
 * count cannot tell one starting from another being answered in the same poll.
 */
export interface FaceContext {
  speaking: boolean;
  microphoneLive: boolean;
  attention: readonly string[];
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
  // Nothing here asks who is waiting on you. A rest holds for as long as it
  // stays true, and for anyone whose sessions are usually waiting on them a
  // fidget that never stops is a face permanently mid-nag: it says what the
  // count badge is already saying, and says it so constantly that the one
  // moment worth catching — a session that has just started asking — arrives
  // indistinguishable from the hour before it. That moment is a gesture
  // instead; see `noticedMotion`.
  if (context.working > 0) return FACE_MOTION.MONITORING;
  // Nothing to watch at all, which is a different thing from nothing happening.
  if (context.total === 0) return FACE_MOTION.SLEEPING;
  return FACE_MOTION.IDLE;
}

/** The rests a gesture may interrupt: every one the microphone does not own. */
const RESTFUL: ReadonlySet<FaceMotion> = new Set([
  FACE_MOTION.IDLE,
  FACE_MOTION.MONITORING,
  FACE_MOTION.SLEEPING,
]);

/**
 * What the face actually plays. A gesture holds it only while the rest beneath
 * can spare it: the moment the microphone opens, the rest takes the face
 * straight back rather than waiting the gesture out.
 *
 * Scheduling a gesture only while the rest is restful is not enough, because the
 * rest can change under one that is already playing — and this is decided here
 * rather than in an effect that runs afterwards because a microphone opened mid
 * gesture would not tint the face at all until the gesture ran out, leaving the
 * capsule silent about an open microphone for as long as five seconds.
 */
export function playedMotion(resting: FaceMotion, gesture: FaceMotion | undefined): FaceMotion {
  return gesture !== undefined && RESTFUL.has(resting) ? gesture : resting;
}

/**
 * What the face has already reacted to. Sessions arriving and finishing are
 * counted, because one arrival is the same news as any other; the ones asking
 * for a person are remembered by id, because three still asking is not the news
 * that one of them being answered as a fourth starts asking is, and the count
 * those two states share is the same number.
 */
export interface FaceObservation {
  attention: ReadonlySet<string>;
  complete: number;
  total: number;
}

function observedFace(
  context: Pick<FaceContext, "attention" | "complete" | "total">,
): FaceObservation {
  return {
    attention: new Set(context.attention),
    complete: context.complete,
    total: context.total,
  };
}

/**
 * The one-shot a change has earned, if any. A session that has just started
 * asking outranks the other two: it is the only one of them that is about to
 * cost someone their attention, and the fidget is the face saying so — once, at
 * the moment it becomes true, rather than for however long it stays true.
 */
export function noticedMotion(
  previous: FaceObservation,
  current: FaceObservation,
): FaceMotion | undefined {
  for (const session of current.attention) {
    if (!previous.attention.has(session)) return FACE_MOTION.WAITING;
  }
  if (current.complete > previous.complete) return FACE_MOTION.SUCCESS;
  if (current.total > previous.total) return FACE_MOTION.NOTIFICATION;
  return undefined;
}

/**
 * Gestures Luke makes for no reason at all. They are what keeps a permanent
 * fixture from reading as a static one — a face that only ever blinks is a
 * screensaver — and they are all short, so the rest underneath is still what the
 * strip mostly says. Nothing here means anything; the ones that do are chosen by
 * `restingMotion` or fired by `noticedMotion` at something that just changed.
 *
 * They matter more than they did when a waiting session held the face: for
 * anyone with sessions perpetually asking for them, this list is now most of
 * what the face does between one nudge and the next.
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
 * The gesture holding the face, boxed rather than held as a bare motion. The
 * same motion can be earned twice running — a second session starting to ask
 * while the first nudge is still playing — and setting state to the value it
 * already holds is a change React is entitled to drop, which would leave the
 * second nudge swallowed by the still tail of the first. A new box is a new
 * cycle, whatever motion is in it.
 */
interface PlayingGesture {
  motion: FaceMotion;
}

/**
 * The motion Luke is playing: a rest, or a gesture that has taken the face for
 * one cycle. Gestures always give it back — nothing here can leave the face
 * stuck saying something that has stopped being true.
 */
export function useFaceMotion(context: FaceContext, still: boolean): FaceMotion {
  const resting = restingMotion(context);
  const [gesture, setGesture] = useState<PlayingGesture>();
  const lastAside = useRef<FaceMotion | undefined>(undefined);
  const observed = useRef(observedFace(context));
  const { total, complete, attention } = context;

  // A session arriving, finishing, or turning to ask for you is worth reacting
  // to once, rather than for as long as it stays true. Seeded from the first
  // render, so a panel that opens onto four running sessions does not greet all
  // four of them — nor bounce at the three that were already waiting.
  //
  // The list of askers is a fresh array every render, so this runs far more
  // often than anything actually changes; what makes that free is that the
  // comparison is against the sessions seen last time rather than against the
  // last render.
  useEffect(() => {
    const previous = observed.current;
    const current = observedFace({ attention, complete, total });
    observed.current = current;
    if (still) return;
    const noticed = noticedMotion(previous, current);
    if (noticed !== undefined) setGesture({ motion: noticed });
  }, [attention, complete, total, still]);

  // Every gesture is a one-shot. The artwork loops — each one is drawn with its
  // own rest built into the tail — so the cycle length is what says when it has
  // been seen, and a gesture played again starts its cycle again rather than
  // finishing the one already running.
  useEffect(() => {
    if (gesture === undefined) return;
    const timer = window.setTimeout(
      () => setGesture(undefined),
      FACE_MOTION_CYCLE_MS[gesture.motion],
    );
    return () => window.clearTimeout(timer);
  }, [gesture]);

  const restful = RESTFUL.has(resting);
  useEffect(() => {
    if (still || !restful || gesture !== undefined) return;
    const timer = window.setTimeout(() => {
      const aside = nextAside(lastAside.current);
      lastAside.current = aside;
      setGesture({ motion: aside });
    }, asideDelay());
    return () => window.clearTimeout(timer);
  }, [gesture, restful, still]);

  // A gesture the rest will not spare the face for is over, not paused: left
  // set, it would surface partway through its own timer whenever the rest
  // turned restful again, which reads as a glitch rather than a gesture. Every
  // such gesture, not only the ones a change of rest interrupted — a session
  // that starts asking into an open microphone is a moment the face missed
  // rather than one it owes you the instant the microphone closes.
  useEffect(() => {
    if (!restful && gesture !== undefined) setGesture(undefined);
  }, [restful, gesture]);

  // Held still, the face keeps one pose rather than a quieter set of them: the
  // stylesheet stops the loops, and this stops the poses changing underneath.
  if (still) return FACE_MOTION.IDLE;
  return playedMotion(resting, gesture?.motion);
}
