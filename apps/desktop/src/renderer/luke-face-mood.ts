import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "@sidecar/surface";
import { type RefObject, useEffect, useRef, useState } from "react";

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
  /**
   * Whether announcements are held right now. A deterministic fact from the
   * main process — the developer's own announce switch off, or the clock against
   * observed meeting intervals — never anything a model decided.
   */
  announcementsHeld: boolean;
  /**
   * Whether the roster has been read at all yet. Until the first reading
   * lands, an empty total means "not looked yet" rather than "nothing to
   * watch", and the two must not wear the same face.
   */
  settled: boolean;
  attention: readonly string[];
  working: number;
  complete: number;
  total: number;
}

/** Whose turn the meter is drawing, when there is a turn to read. */
export const SPEECH_TURN = {
  DEVELOPER: "developer",
  LUKE: "luke",
} as const;

export type SpeechTurn = (typeof SPEECH_TURN)[keyof typeof SPEECH_TURN];

/**
 * What the face should read from a conversation.
 *
 * Once a call is up the turn says outright who is talking, and amplitude cannot:
 * the same meter draws Luke answering and the developer asking, so a face
 * following the bars would talk back at someone mid-sentence. Amplitude is only
 * consulted when there is no turn to read — a microphone opened from Settings
 * with no call behind it, and the fixture, which has no turn at all.
 */
export function speechFaceInputs(input: {
  turn?: SpeechTurn;
  hasAudioSignal: boolean;
  fixtureSpeaking: boolean;
  voiceActive: boolean;
}): Pick<FaceContext, "speaking" | "microphoneLive"> {
  if (input.turn === SPEECH_TURN.LUKE) return { speaking: true, microphoneLive: false };
  if (input.turn === SPEECH_TURN.DEVELOPER) return { speaking: false, microphoneLive: true };
  return {
    // Guarded rather than reset: a microphone that has been closed cannot still
    // be carrying speech, whatever the last frame the meter read said.
    speaking: input.hasAudioSignal && (input.fixtureSpeaking || input.voiceActive),
    microphoneLive: input.hasAudioSignal,
  };
}

/**
 * Whether Luke stands aside and lets the meter have his place.
 *
 * While you hold the turn, the one thing worth showing is that you are being
 * heard. The capsule has room for exactly one of them, and a face listening is
 * a weaker way of saying it than bars moving to your own voice — so for that
 * stretch the meter is drawn where the face was, and the face returns the
 * moment the turn does.
 *
 * Guarded on the meter existing: hiding one and drawing neither would leave the
 * capsule saying nothing at all, which is worse than either.
 */
export function faceYieldsToMeter(input: { turn?: SpeechTurn; hasAudioSignal: boolean }): boolean {
  return input.turn === SPEECH_TURN.DEVELOPER && input.hasAudioSignal;
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
  // A meeting the calendar is holding announcements through. Sleeping is the
  // one visual report the hold makes — Luke is deliberately not speaking —
  // and it stays true for exactly as long as the meeting covers now, which is
  // what a rest must do. Speech still outranks it: a developer who opens a
  // turn mid-hold is talking to a face, not to a pillow.
  if (context.announcementsHeld) return FACE_MOTION.SLEEPING;
  // Nothing to watch at all, which is a different thing from nothing
  // happening — and different again from not having looked yet. Until the
  // first roster reading lands, the zero is the reading's absence, and Luke
  // waits for it awake and still: falling asleep at launch would report an
  // empty desk he has not actually seen.
  if (context.total === 0 && context.settled) return FACE_MOTION.SLEEPING;
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
 * pool only while what it means is true. It is how work reads on a face that
 * plays no continuous motion while work runs: often enough to notice that
 * something is happening, seldom enough that the face is mostly still.
 */
const WORKING_ASIDE: WeightedAside = { motion: FACE_MOTION.MONITORING, weight: 18 };

/** What the next moment may be spent on, given what is true while it arrives. */
export function asidePool(working: boolean): readonly WeightedAside[] {
  return working ? [...IDLE_ASIDES, WORKING_ASIDE] : IDLE_ASIDES;
}

/**
 * Tricks for the pointer coming to rest on Luke himself. The flyoff is the
 * showpiece and takes most of the pool; the rest are the loudest of the idle
 * asides, because a hover has earned something bigger than a blink. Nothing
 * here may carry meaning — a hand crosses the strip whenever it likes, and a
 * face that hopped like a task had just finished would be lying about the
 * sessions.
 */
export const HOVER_ASIDES: readonly WeightedAside[] = [
  { motion: FACE_MOTION.FLYOFF, weight: 46 },
  { motion: FACE_MOTION.REFRESH, weight: 16 },
  { motion: FACE_MOTION.HIDING, weight: 12 },
  { motion: FACE_MOTION.BOOP, weight: 10 },
  { motion: FACE_MOTION.WINK, weight: 8 },
  { motion: FACE_MOTION.TEASE, weight: 8 },
];

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

/**
 * How far past the drawn face a hover still counts. The face is 18px in a
 * strip at the very top of the screen, and asking for the pixel is asking to
 * miss: a pointer resting anywhere near Luke means Luke. Wide enough to be
 * forgiving, narrow enough that the reach stays his — it must not swallow the
 * marks beside him or read the whole strip as a face.
 */
const HOVER_REACH_PX = 8;

/**
 * Whether the pointer is resting on Luke himself, give or take the reach. Read
 * from the window's own pointer stream rather than from the face element,
 * because the wing takes no pointer at all: the strip under the housing is one
 * button, and a face that answered enter and leave itself would swallow the
 * press that opens the panel. The box is measured at each move rather than
 * cached, because it travels with the shape while never being what animates — a
 * motion transforms layers inside the svg, so a face mid-flyoff is still
 * hovered where it took off from.
 */
export function useFaceHover(face: RefObject<HTMLElement | null>): boolean {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const moved = (event: MouseEvent) => {
      const rect = face.current?.getBoundingClientRect();
      // No box is no reading, not a leave. The meter takes the face's place
      // for a turn, and a pointer that never moved off the capsule must not be
      // told it left — the trick would rearm and fire again, unasked, the
      // moment the face returned. Only a measured miss rearms it.
      if (rect === undefined || rect.width === 0) return;
      setHovered(
        event.clientX >= rect.left - HOVER_REACH_PX &&
          event.clientX <= rect.right + HOVER_REACH_PX &&
          event.clientY >= rect.top - HOVER_REACH_PX &&
          event.clientY <= rect.bottom + HOVER_REACH_PX,
      );
    };
    // The pointer can leave the window without a final move inside it, and a
    // hover that survived that would replay a trick on the way back in.
    const left = () => setHovered(false);
    window.addEventListener("mousemove", moved);
    document.documentElement.addEventListener("mouseleave", left);
    return () => {
      window.removeEventListener("mousemove", moved);
      document.documentElement.removeEventListener("mouseleave", left);
    };
  }, [face]);

  return hovered;
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
export function useFaceMotion(context: FaceContext, still: boolean, hovered = false): FacePlay {
  const resting = restingMotion(context);
  const [gesture, setGesture] = useState<PlayingGesture>();
  const plays = useRef(0);
  const observed = useRef(observedFace(context));
  const { total, complete, attention, working, settled } = context;

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
  // The first reading to settle is a baseline, not news: its sessions were
  // already running before Luke looked, so greeting them would announce
  // arrivals that never happened — the same reason the very first render
  // seeds silently. Tracked against the settling seen last time, like the
  // observations, so nothing else changing can replay the exemption.
  const settledBefore = useRef(settled);
  useEffect(() => {
    const previous = observed.current;
    const current = observedFace({ attention, complete, total });
    observed.current = current;
    const firstReading = settled && !settledBefore.current;
    settledBefore.current = settled;
    if (still || firstReading) return;
    const noticed = noticedMotion(previous, current);
    if (noticed === undefined) return;
    plays.current += 1;
    setGesture({ motion: noticed, play: plays.current });
  }, [attention, complete, total, still, settled]);

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

  // The pointer arriving on the face is greeted once, at the arrival, and
  // staying put earns nothing more: leaving and coming back is what asks again.
  // Tracked against the pointer seen last time rather than the last render, for
  // the same reason the observations above are — so nothing else changing under
  // a held hover can replay the trick.
  const hoveredBefore = useRef(false);
  useEffect(() => {
    const arrived = hovered && !hoveredBefore.current;
    hoveredBefore.current = hovered;
    if (!arrived || still) return;
    plays.current += 1;
    setGesture({ motion: chooseAside(HOVER_ASIDES, Math.random()), play: plays.current });
  }, [hovered, still]);

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
