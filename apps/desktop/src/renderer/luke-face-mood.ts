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
 * What Luke settles into, which is usually nothing whatever. A rest repeats for
 * as long as it is true, so the only motions allowed to be one are the three
 * that stay true while they hold: speech going into an open microphone, the
 * microphone open without it, and having nothing at all to watch.
 *
 * Everything else rests as a still face — the drawing, and no motion — and
 * spends its moments on gestures instead. Nothing here asks who is waiting on
 * you, and nothing here rocks along with the work: a loop that runs for as long
 * as something is true is a loop that is always running for anyone whose
 * sessions usually need them, and a face that never stops moving is one you
 * stop reading. What was a rest is a gesture now; see `asidePool`.
 */
export function restingMotion(context: FaceContext): FaceMotion | undefined {
  if (context.speaking) return FACE_MOTION.TALKING;
  if (context.microphoneLive) return FACE_MOTION.LISTENING;
  // Nothing to watch at all, which is a different thing from nothing happening.
  if (context.total === 0) return FACE_MOTION.SLEEPING;
  return undefined;
}

/**
 * What the face plays: the rest if it has one, the gesture if it does not, and
 * stillness if it has neither. A rest owns the face outright, because each of
 * the three says something that is true right now — and the microphone ones
 * carry the face's colour, which is the only report the capsule makes of an open
 * microphone. Deciding it here rather than in an effect that runs afterwards is
 * what keeps a microphone opened mid gesture from going untinted until the
 * gesture runs out.
 */
export function playedMotion(
  resting: FaceMotion | undefined,
  gesture: FaceMotion | undefined,
): FaceMotion | undefined {
  return resting ?? gesture;
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

/** One thing Luke might do with a moment, and how much of the pool it takes. */
export interface WeightedAside {
  motion: FaceMotion;
  weight: number;
}

/**
 * Gestures Luke makes for no reason at all, and how often each is worth making.
 * They are what keeps a permanent fixture from reading as a dead one — a face
 * that never moves is a screenshot — and between them the face is simply still.
 *
 * Weights rather than a rotation, because these are not equals. Half the pool is
 * the blink, which is the smallest thing the face can do and the only one whose
 * job is just to be alive; the loud ones sit at the bottom, rare enough to stay
 * surprises — the duck behind the housing turns up about once every ten minutes.
 * Nothing here means anything: what does is chosen by `restingMotion` or fired
 * by `noticedMotion` at something that just changed.
 *
 * The same gesture twice running is allowed, and has to be. Two blinks a
 * half-minute apart is what a calm face does, and forbidding a repeat would
 * force something louder into every second moment.
 */
const IDLE_ASIDES: readonly WeightedAside[] = [
  { motion: FACE_MOTION.IDLE, weight: 44 },
  { motion: FACE_MOTION.WINK, weight: 10 },
  { motion: FACE_MOTION.BOOP, weight: 8 },
  { motion: FACE_MOTION.YES, weight: 7 },
  { motion: FACE_MOTION.TEASE, weight: 6 },
  { motion: FACE_MOTION.REVIEWING, weight: 5 },
  { motion: FACE_MOTION.FLOATING, weight: 5 },
  { motion: FACE_MOTION.ATTENTION, weight: 4 },
  { motion: FACE_MOTION.HIDING, weight: 1 },
];

/**
 * The sway is the one gesture in the pool that means something, so it is in the
 * pool only while what it means is true. It is how work still reads on the face
 * now that nothing rocks for as long as work runs: often enough to notice that
 * something is happening, seldom enough that the face is mostly still.
 */
const WORKING_ASIDE: WeightedAside = { motion: FACE_MOTION.MONITORING, weight: 18 };

/** What the next moment may be spent on, given what is true while it arrives. */
export function asidePool(working: boolean): readonly WeightedAside[] {
  return working ? [...IDLE_ASIDES, WORKING_ASIDE] : IDLE_ASIDES;
}

/**
 * One gesture, sampled by weight. `roll` is a number in [0, 1) — passed in
 * rather than drawn here so that what the face does with a moment is decided by
 * something a test can hold still.
 */
export function chooseAside(pool: readonly WeightedAside[], roll: number): FaceMotion {
  const total = pool.reduce((sum, aside) => sum + aside.weight, 0);
  let spent = roll * total;
  for (const aside of pool) {
    spent -= aside.weight;
    if (spent < 0) return aside.motion;
  }
  // Only reachable for a roll of exactly 1, which `Math.random` never returns;
  // the fallback answers the type rather than a case.
  return FACE_MOTION.IDLE;
}

/**
 * How long the face is still between gestures. Far enough apart that a gesture
 * is a surprise rather than a rhythm — a fixture that moves on a timetable is
 * one you start reading as a clock — and near enough together that a face
 * nobody has touched in half a minute still looks like it could move at all.
 */
const STILLNESS_MIN_MS = 7_000;
const STILLNESS_MAX_MS = 21_000;
const stillnessDelay = () =>
  STILLNESS_MIN_MS + Math.random() * (STILLNESS_MAX_MS - STILLNESS_MIN_MS);

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
 * The gesture holding the face, and which play of it this is. The count is what
 * lets the same gesture happen twice running: a motion now plays once rather
 * than looping, and a CSS animation does not start again because the element was
 * asked for the animation it is already wearing. The renderer draws the face
 * afresh for each play, and a fresh element starts its one play from the top.
 *
 * Repeats are not an edge case here. Half the pool is the blink, so the same
 * gesture twice is the likeliest thing to happen, and a second session starting
 * to ask while the first nudge is still playing has to bounce again.
 */
export interface PlayingGesture {
  motion: FaceMotion;
  play: number;
}

/** What the face is doing, and what the drawing needs to know to do it. */
export interface FacePlay {
  /** Absent while the face is still, which is most of the time. */
  motion?: FaceMotion;
  /** Set while the motion is a rest, which is the only kind that repeats. */
  repeat: boolean;
  /** Which play this is, so that asking twice for one motion plays it twice. */
  play: number;
}

/**
 * Everything the drawing is told, from the two things the model holds.
 *
 * Each gesture gets its own play, so each one is drawn afresh and each one is
 * therefore played. A rest keeps one play throughout, so its loop is never
 * rebuilt underneath itself — and a gesture the rest is covering is not being
 * played at all, so it does not get one either. Counting that one would restart
 * the microphone's tilt at a session it is meant to ignore, and again a frame
 * later when the rest dropped it.
 */
export function facePlay(
  resting: FaceMotion | undefined,
  gesture: PlayingGesture | undefined,
): FacePlay {
  return {
    motion: playedMotion(resting, gesture?.motion),
    repeat: resting !== undefined,
    play: resting === undefined ? (gesture?.play ?? 0) : 0,
  };
}

/**
 * What Luke is playing: a rest, a gesture that has the face for one play, or
 * nothing at all. Gestures always give the face back — nothing here can leave it
 * stuck saying something that has stopped being true — and what they give it
 * back to is stillness.
 */
export function useFaceMotion(context: FaceContext, still: boolean): FacePlay {
  const resting = restingMotion(context);
  const [gesture, setGesture] = useState<PlayingGesture>();
  const plays = useRef(0);
  const observed = useRef(observedFace(context));
  const { total, complete, attention, working } = context;

  // Which pool the next moment is drawn from, held in a ref rather than read in
  // the waiting effect below: work starting and stopping is exactly the churn
  // that would reschedule the wait forever and leave the face permanently still.
  const busy = useRef(working > 0);
  useEffect(() => {
    busy.current = working > 0;
  }, [working]);

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
    if (noticed === undefined) return;
    plays.current += 1;
    setGesture({ motion: noticed, play: plays.current });
  }, [attention, complete, total, still]);

  // The artwork plays each motion once and leaves the face at the pose it
  // started from, so this is only the bookkeeping that catches up with it: the
  // cycle length is when the drawing has finished, and handing `motion` back at
  // the same moment is what returns the face to stillness in the model too.
  useEffect(() => {
    if (gesture === undefined) return;
    const timer = window.setTimeout(
      () => setGesture(undefined),
      FACE_MOTION_CYCLE_MS[gesture.motion],
    );
    return () => window.clearTimeout(timer);
  }, [gesture]);

  // Stillness, and then something small. Waiting is only scheduled while nothing
  // is resting on the face and nothing is already playing, so the gaps never
  // overlap what they are gaps between.
  useEffect(() => {
    if (still || resting !== undefined || gesture !== undefined) return;
    const timer = window.setTimeout(() => {
      plays.current += 1;
      setGesture({
        motion: chooseAside(asidePool(busy.current), Math.random()),
        play: plays.current,
      });
    }, stillnessDelay());
    return () => window.clearTimeout(timer);
  }, [gesture, resting, still]);

  // A gesture a rest has taken the face back from is over, not paused: left set,
  // it would surface partway through its own timer the moment the rest ended,
  // which reads as a glitch rather than a gesture. Every such gesture, not only
  // the ones a rest arrived on top of — a session that starts asking into an
  // open microphone is a moment the face missed, rather than one it owes you the
  // instant the microphone closes.
  useEffect(() => {
    if (resting !== undefined && gesture !== undefined) setGesture(undefined);
  }, [resting, gesture]);

  // Held still, the face is simply the drawing: the stylesheet stops every loop,
  // and asking for no motion at all stops the poses changing underneath it.
  if (still) return { repeat: false, play: 0 };
  return facePlay(resting, gesture);
}
