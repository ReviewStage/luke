import { APP_PANEL_TAB, type AppPanelTab, type AppToolAction } from "@sidecar/core";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { LukeFace } from "./luke-face";
import { type AppSettingId, isAppSettingId } from "./luke-guide";
import { HIT_REGION, HIT_REGION_ATTRIBUTE, PANEL_PRESENTATION } from "./panel-state";
import { parseMilliseconds, parsePixels, STILL_MS } from "./session-motion";

/**
 * Luke signing his own work.
 *
 * A setting or a view changes two ways: a hand on the control, or Luke acting
 * on something asked of him. The control answers identically either way — and
 * a switch that flips with nobody near it reads as a glitch rather than as an
 * answer. So Luke goes and does it in the open: he leaves the strip under the
 * housing, dives to the very control that changed, taps it, and floats back.
 *
 * The dive and the tap are the whole of the emphasis. The way home is the
 * quietest motion that still reads as something moving under its own power,
 * because by then the point has been made and all that is left is to get out
 * of the way of the control he was pointing at.
 *
 * **There is only ever one Luke on screen.** The strip's own face is held
 * invisible for exactly as long as the flight lasts, so what crosses the panel
 * reads as the face itself having left its post rather than as a second copy
 * of it. The flying element is a stand-in — the strip's face is remounted
 * whenever a gesture plays, and an animation running on a node React is about
 * to replace would die mid-air — but it is an exact one: it sets off from the
 * face's own measured box, at the face's own measured size, wearing the colour
 * the face is wearing that moment, and it is parked back on top of the face
 * before the face fades back in underneath it. Neither handover has a frame
 * where two are drawn or none is.
 *
 * The colour is answered in the stylesheet off the same `data-voice` the face
 * takes its own from, rather than measured here and carried: it is the one
 * report the capsule makes of whose turn it is — blue while Luke is talking,
 * green while he is listening — and an errand flies out of a reply, so it
 * would be the wrong moment of all moments to drop it. Keyed off the one
 * attribute, the two cannot disagree even mid-flight, which is what the
 * handover needs: a colour snapshotted at launch would swap to a different one
 * the instant the face came back underneath.
 *
 * The errand is drawing and nothing else. It is armed by the tool-call carrier
 * alone — a row someone pressed themselves needs no attribution, and an act
 * that was refused has nothing to sign — and it decides nothing: it reads
 * where two elements are and moves between them. An act made while the panel
 * is away flies nowhere at all, because attribution is only worth anything to
 * someone who can see what was attributed.
 *
 * One flight at a time, and that is the caller's to guarantee: a reply may ask
 * for several acts at once, and a new errand handed over mid-flight abandons
 * the one in the air wherever it had got to. `errand-queue.ts` is where they
 * are made to take turns, and the reason each act carries its own hold.
 *
 * Everything moves with `transform` and `opacity` alone; the control it lands
 * on is read for its box and never restyled, so nothing about a settings row
 * changes because an errand happened to visit it. The one thing it does move
 * is a scroller, and only to bring the landing into view — the same thing the
 * keyboard does on the way to a control, and for the same reason. The beats
 * come from the motion tokens, which is what makes a capture run and reduced
 * motion — both of which zero them — get no errand rather than an instant one.
 */

/** How a control says an errand may land on it, and which one it answers to. */
export const ERRAND_TARGET_ATTRIBUTE = "data-errand-target";

/** How the stage says which shape is drawn, so a flight can watch it. */
export const PRESENTATION_ATTRIBUTE = "data-presentation";

/** How Luke's own face says an errand sets off from it. */
export const ERRAND_ORIGIN_ATTRIBUTE = "data-errand-origin";

/**
 * The landing places that are not a setting's own control. A setting is named
 * by the very id a spoken change names it by, so it needs no entry here; these
 * are the parts of the panel that say what you are looking at rather than what
 * it is set to.
 */
export const ERRAND_TARGET = {
  SESSIONS_TAB: "tab-sessions",
  SETTINGS_TAB: "tab-settings",
  LIST_OPTIONS: "list-options",
} as const;

export type ErrandTarget = AppSettingId | (typeof ERRAND_TARGET)[keyof typeof ERRAND_TARGET];

const TAB_ERRAND_TARGET = {
  [APP_PANEL_TAB.SESSIONS]: ERRAND_TARGET.SESSIONS_TAB,
  [APP_PANEL_TAB.SETTINGS]: ERRAND_TARGET.SETTINGS_TAB,
};

/** Which landing place a tab is. Exhaustive over the tabs a spoken ask names. */
export function tabErrandTarget(tab: AppPanelTab): ErrandTarget {
  return TAB_ERRAND_TARGET[tab];
}

/**
 * What a control spreads onto itself to be somewhere an errand can land.
 *
 * Mark the element that is *drawn* as the control, not a box that happens to
 * hold it. The errand measures what it marks and outlines it in the element's
 * own corners, so a wrapper positioning something rounded — with no radius of
 * its own, because it draws nothing — earns a ring with square corners around
 * a control that has none. A control whose roundness lives on a child, or
 * behind it, either declares that radius itself or hands the mark down.
 */
export function errandTargetProps(target: ErrandTarget) {
  return { [ERRAND_TARGET_ATTRIBUTE]: target } satisfies Record<string, string>;
}

/** What Luke's own face spreads onto itself to be where one sets off from. */
export function errandOriginProps() {
  return { [ERRAND_ORIGIN_ATTRIBUTE]: "true" } satisfies Record<string, string>;
}

/**
 * Where an act should be signed, best first. More than one because the panel
 * does not always draw the best answer: the options button carries both the
 * narrowing and the ordering, but it is only offered beside a list with
 * something to choose between, so the tab stands behind it. The flight takes
 * the first candidate actually drawn, and an act with none flies nowhere.
 */
export function errandTargets(action: AppToolAction): readonly ErrandTarget[] {
  if (action.kind === "setting") {
    // The guide's ids travel as plain text, so one that names no setting of
    // Luke's is no landing place either.
    return isAppSettingId(action.setting.id) ? [action.setting.id] : [];
  }
  if (action.kind !== "panel") return [];
  const tab = tabErrandTarget(action.tab);
  // A narrowing or a re-ordering is the news; the tab is only where it
  // happened, and it may not have changed at all.
  if (action.filter !== undefined || action.sort !== undefined) {
    return [ERRAND_TARGET.LIST_OPTIONS, tab];
  }
  return [tab];
}

/**
 * What has to have finished happening before an errand can measure anything.
 *
 * Everything the flight reads — where the face is, where the control is, how
 * wide the shape is — is read off elements that may still be arriving, and a
 * measurement taken mid-arrival lands the mark where a row was passing rather
 * than where it came to rest. So the errand waits out whatever the act it is
 * signing has set in motion.
 */
export const ERRAND_WAIT = {
  /** The panel is up and already showing the control: a beat, and go. */
  AT_ONCE: "at-once",
  /** The panel opened for this, so a whole page of content is arriving. */
  CONTENT: "content",
  /** An instant page swap changed the black surface's height. */
  SURFACE: "surface",
} as const;

export type ErrandWait = (typeof ERRAND_WAIT)[keyof typeof ERRAND_WAIT];

/** One errand, as the app asks for it. */
export interface Errand {
  targets: readonly ErrandTarget[];
  wait: ErrandWait;
  /** Which run this is, so asking twice for one control flies twice. */
  run: number;
}

/** A box, as either a `DOMRect` or a plain reading of one. */
export interface ErrandBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a flight starts, where it lands, and what it lands on. */
export interface ErrandJourney {
  /** The mark's top-left at the strip, in the stage's own coordinates. */
  from: { x: number; y: number };
  /** The mark's top-left once centred on the control. */
  to: { x: number; y: number };
  /** The mark's size, taken from the face it peels off rather than chosen. */
  size: { width: number; height: number };
}

/**
 * One measured box in the stage's own coordinates. Everything is read against
 * the stage rather than the viewport because that is what the flight is drawn
 * in: the strip, the panel, the black itself, and both drawn elements share
 * one containing box, so a single subtraction puts every reading in one frame.
 */
export function errandBound(stage: ErrandBox, box: ErrandBox): ErrandBox {
  return {
    left: box.left - stage.left,
    top: box.top - stage.top,
    width: box.width,
    height: box.height,
  };
}

/** The flight, in the stage's coordinates. */
export function errandJourney(stage: ErrandBox, face: ErrandBox, target: ErrandBox): ErrandJourney {
  const landing = errandBound(stage, target);
  const home = errandBound(stage, face);
  return {
    from: { x: home.left, y: home.top },
    // Centred on the control, so a wide switch and a narrow tab are both
    // landed on rather than beside.
    to: {
      x: landing.left + (landing.width - home.width) / 2,
      y: landing.top + (landing.height - home.height) / 2,
    },
    size: { width: home.width, height: home.height },
  };
}

/** The motion tokens a flight is timed by, already read as milliseconds. */
export interface ErrandTokens {
  surfaceMs: number;
  quick: number;
  exit: number;
  expand: number;
  stagger: number;
  /** How many rows the stack still staggers before it stops accumulating. */
  fanLimit: number;
}

/** When a flight sets off, how long it lasts, and where its moments fall in it. */
export interface ErrandBeats {
  delay: number;
  duration: number;
  /** The fraction of the flight at which the mark reaches the control. */
  arrival: number;
  /** The fraction at which it sets off home again. */
  departure: number;
  /**
   * The fraction at which it is back on the face's own box. It is parked there
   * for what is left, which is the window the strip's face fades back in
   * underneath it — so the handover has no frame with two Lukes drawn, and
   * none with neither.
   */
  home: number;
}

/**
 * Whether there is a flight to run at all. Read off the shape token itself
 * rather than off the total the beats add up to: a capture run zeroes the
 * tokens and reduced motion leaves each of them a millisecond, and three of
 * those summed would clear a floor that every one of them individually asked
 * to stay under. Neither wants a face crossing the panel at any speed.
 */
export function errandFlies(tokens: ErrandTokens): boolean {
  return tokens.surfaceMs >= STILL_MS;
}

/**
 * The flight's shape in time: out on the surface's own spring, a beat on the
 * control, and the same journey back. Nothing is written in milliseconds here
 * — every number is derived from a token — which is how a capture run and
 * reduced motion silence the errand without knowing it exists.
 *
 * The wait before setting off is the whole of what the act it signs has set in
 * motion. A panel that had to open costs the shape's travel plus the delay and
 * stagger its content arrives on. An instant page swap has no content motion,
 * but its flight still waits for the surface's edge when the destination page
 * changes its height.
 */
export function errandBeats(tokens: ErrandTokens, wait: ErrandWait): ErrandBeats {
  const duration = tokens.surfaceMs * 2 + tokens.quick;
  const arrival = tokens.surfaceMs / duration;
  const arriving = tokens.expand + tokens.stagger * tokens.fanLimit + tokens.surfaceMs;
  return {
    delay:
      wait === ERRAND_WAIT.AT_ONCE
        ? tokens.quick
        : wait === ERRAND_WAIT.SURFACE
          ? tokens.surfaceMs
          : arriving,
    duration,
    arrival,
    departure: (tokens.surfaceMs + tokens.quick) / duration,
    home: (duration - tokens.exit) / duration,
  };
}

/**
 * The turn the captions belong to. Mirrors `WAVEFORM_VOICE.LUKE` as the stage
 * spells it in `data-voice`, read here rather than imported because this only
 * ever asks the DOM a question about itself.
 */
const ERRAND_SPEAKING_VOICE = "luke";

/** How many points the drift is drawn with. Enough that the bow reads as curved. */
const DRIFT_SAMPLES = 8;

/**
 * How far off the straight run the drift bows, as a share of the way home.
 * Proportional, so a short hop and a long climb bow alike — and small, because
 * this is a drift rather than a manoeuvre: it is there to keep the way home
 * from being a ruled line, not to be noticed as a shape of its own.
 */
const DRIFT_SWAY_SHARE = 0.09;

/** No smaller than he is, or a short hop would bow invisibly. */
const DRIFT_SWAY_MIN_MARKS = 1;

/** One sampled point of the way home. */
export interface ErrandDriftStep {
  /** Where in the whole flight this point falls. */
  offset: number;
  point: { x: number; y: number };
}

/**
 * How far along the way home he is at a given moment of it. Smoothstep: level
 * at both ends and quickest in the middle, so he lifts off the control rather
 * than snapping away from it and settles onto the strip rather than arriving
 * at it. The speed is carried here rather than in the keyframes' easing
 * because the path is sampled — an easing per segment would ease at every
 * sample and read as a series of small hesitations.
 */
function driftEase(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

/**
 * How much more of the panel the captions may take while a flight is out.
 *
 * Luke's words are drawn on the shape rather than in the panel's flow, so the
 * panel reserves their block under its own padding — and that block is
 * measured off wrapped text, which means it grows line by line for as long as
 * he is talking. A flight lasts about a second and an errand sets off out of a
 * reply, so it is airborne for exactly the stretch the reservation is growing
 * in. On a panel already at its full height that room comes out of the list
 * the control is in, and a control measured before it can be clipped out of
 * view by the time he lands on it.
 *
 * A muted Mac is what makes this the normal case rather than a corner: the
 * captions are drawn whatever the preference says, because then they are the
 * only part of the reply arriving at all. So the room is reserved before the
 * landing is chosen — all of it when no words have been measured yet, and
 * whatever is left of it once some have.
 */
export function captionRoom(input: {
  /** Whether a caption block is drawn right now. */
  drawn: boolean;
  /** Whether Luke holds the turn, which is when one can still appear. */
  speaking: boolean;
  /** The block's height as measured so far. */
  size: number;
  /** The most it is ever allowed to take. */
  max: number;
}): number {
  if (!input.drawn && !input.speaking) return 0;
  return Math.max(0, input.max - input.size);
}

/**
 * Where a scroller has to sit for the landing to still be visible once that
 * room is taken. Nothing if it already is; otherwise the least scrolling that
 * clears it — and never so much that the control's own top leaves the view,
 * because a switch you can see the bottom of is worse than one sitting low.
 */
export function errandScrollTop(input: {
  scrollTop: number;
  view: { top: number; bottom: number };
  target: { top: number; bottom: number };
  room: number;
}): number {
  const above = input.target.top - input.view.top;
  if (above < 0) return input.scrollTop + above;
  const below = input.target.bottom - (input.view.bottom - Math.max(0, input.room));
  if (below <= 0) return input.scrollTop;
  return input.scrollTop + Math.min(below, above);
}

/**
 * The shape as it will still be by the time the flight is over.
 *
 * A drift bounded by the shape as drawn is bounded by a shape that may be
 * about to get smaller: the captions take their room out of the panel while
 * Luke talks and give every pixel of it back when he stops, and a reply
 * ending mid-flight is the ordinary case rather than a strange one. The room
 * comes off the foot, so the settled shape is the drawn one less the block —
 * measured against that, the drift stays over black through the shrink
 * instead of being left on the desktop by it.
 */
export function errandSettledBound(bound: ErrandBox, captionSize: number): ErrandBox {
  return { ...bound, height: Math.max(0, bound.height - Math.max(0, captionSize)) };
}

/** The largest sway that keeps `base + sway * direction` between two edges. */
function roomFor(base: number, direction: number, low: number, high: number): number {
  if (direction > 0) return (high - base) / direction;
  if (direction < 0) return (low - base) / direction;
  return Number.POSITIVE_INFINITY;
}

/**
 * The way home, as a float rather than a line.
 *
 * The job on the way down is to be seen arriving at one control; the job on
 * the way back is only to get out of the way, so it is the quietest motion
 * that still reads as a thing moving under its own power. He eases off the
 * control, bows gently to one side, and settles onto the strip — one half of a
 * sine's worth of sway, zero at both ends, so the drift joins the straight run
 * without a corner at either.
 *
 * Which side he leans is chosen rather than fixed: toward the side the strip
 * is on rather than the side the desktop is on. `bound` is the drawn shape,
 * and it decides how far he may lean at all — the run itself is between two
 * points already on the black, so only the sway can leave it, and each sampled
 * point moves off the run by the sway times a fixed direction. The widest
 * drift the shape will hold is therefore just the tightest of those limits,
 * solved rather than guessed at.
 */
export function errandDrift(
  journey: ErrandJourney,
  beats: ErrandBeats,
  bound: ErrandBox,
): readonly ErrandDriftStep[] {
  const away = { x: journey.from.x - journey.to.x, y: journey.from.y - journey.to.y };
  const distance = Math.hypot(away.x, away.y);
  // Nowhere to go is no drift, and no flight: every step would be one point.
  if (distance === 0) return [];
  const along = { x: away.x / distance, y: away.y / distance };
  // A quarter turn off the run, taken on whichever side leans toward the strip.
  const acrossX = -along.y;
  const facing = away.x !== 0 && acrossX !== 0 && Math.sign(acrossX) !== Math.sign(away.x) ? -1 : 1;
  const across = { x: acrossX * facing, y: along.x * facing };

  const baseAt = (travelled: number) => ({
    x: journey.to.x + away.x * travelled,
    y: journey.to.y + away.y * travelled,
  });
  // Half a sine, so the bow is widest at the middle of the run and nothing at
  // either end of it.
  const leanAt = (travelled: number) => Math.sin(Math.PI * travelled);

  let sway = Math.max(distance * DRIFT_SWAY_SHARE, journey.size.width * DRIFT_SWAY_MIN_MARKS);
  for (let index = 0; index <= DRIFT_SAMPLES; index += 1) {
    const travelled = driftEase(index / DRIFT_SAMPLES);
    const base = baseAt(travelled);
    const lean = leanAt(travelled);
    sway = Math.min(
      sway,
      roomFor(base.x, across.x * lean, bound.left, bound.left + bound.width - journey.size.width),
      roomFor(base.y, across.y * lean, bound.top, bound.top + bound.height - journey.size.height),
    );
  }
  // A run whose own ends are outside the shape can ask for a negative sway.
  // Nothing is the right answer there: the drift collapses onto the run, which
  // is the one path already known to be on the black.
  sway = Math.max(0, sway);

  const steps: ErrandDriftStep[] = [];
  for (let index = 0; index <= DRIFT_SAMPLES; index += 1) {
    const progress = index / DRIFT_SAMPLES;
    const travelled = driftEase(progress);
    const base = baseAt(travelled);
    const lean = leanAt(travelled) * sway;
    steps.push({
      offset: beats.departure + (beats.home - beats.departure) * progress,
      point: { x: base.x + across.x * lean, y: base.y + across.y * lean },
    });
  }
  return steps;
}

const MOTION_TOKEN = {
  SPRING: "--spring",
  SPRING_FAST: "--spring-fast",
  SURFACE_DURATION: "--duration-shape",
  QUICK_DURATION: "--duration-quick",
  EXIT_DURATION: "--duration-exit",
  EXIT_EASING: "--motion-exit",
  EXPAND_DELAY: "--expand-delay",
  ROW_STAGGER: "--row-stagger",
  ROW_FAN_LIMIT: "--row-fan-limit",
  CAPTION_SIZE: "--caption-size",
  CAPTION_MAX: "--caption-max",
  VOLUME_HINT_SIZE: "--volume-hint-size",
} as const;

type MotionToken = (typeof MOTION_TOKEN)[keyof typeof MOTION_TOKEN];

/**
 * How far past its own size the mark swells as it lands. The tap is the whole
 * point of the landing, and a mark that only stopped would read as having
 * drifted there.
 */
const LANDING_SCALE = 1.32;

/** How far into its own life the ring is at full strength, as a fraction. */
const RING_BLOOM = 0.26;

/** How far past the control the ring has spread by the time it is gone. */
const RING_SPREAD = 1.16;

/**
 * Where a scroller's view really starts: a child pinned to its top — the
 * settings pages' header — covers the first strip of it, so a landing brought
 * flush with the scroller's own edge would arrive under the header rather
 * than below it. Measured off the children rather than assumed, because
 * which scroller pins what is the panel's business, not the errand's. The
 * strip one gap below a pinned child is covered too: that is the band where
 * rows dissolve under it, so a landing there is a landing mid-fade — and the
 * gap is what the scroller's own scroll padding already adds for the
 * keyboard, so the errand and a tabbed-to control agree on what clear means.
 */
function pinnedViewTop(scroller: HTMLElement, viewTop: number): number {
  let bottom = Number.NEGATIVE_INFINITY;
  for (const child of scroller.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (getComputedStyle(child).position !== "sticky") continue;
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
  }
  if (bottom === Number.NEGATIVE_INFINITY) return viewTop;
  const gap = Number.parseFloat(getComputedStyle(scroller).rowGap);
  return Math.max(viewTop, bottom + (Number.isNaN(gap) ? 0 : gap));
}

/**
 * Scrolls the landing clear of the room the captions may still take. Reads the
 * scroller off the control rather than being told which one: the errand knows
 * what it is flying to, not what the panel happens to have wrapped it in.
 */
function keepInView(stage: HTMLElement, target: HTMLElement, room: number): void {
  for (
    let node = target.parentElement;
    node !== null && node !== stage;
    node = node.parentElement
  ) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const view = node.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    node.scrollTop = errandScrollTop({
      scrollTop: node.scrollTop,
      view: { top: pinnedViewTop(node, view.top), bottom: view.bottom },
      target: { top: box.top, bottom: box.bottom },
      room,
    });
    return;
  }
}

/** Only a control a reader can actually see is worth flying to. */
function drawn(element: HTMLElement): boolean {
  return element.checkVisibility({ opacityProperty: true });
}

/**
 * The first candidate the panel is actually drawing. Read as one pass over the
 * marked elements rather than a selector per candidate, so the document is
 * queried once and the candidates are matched by their own ids.
 */
function landingPlace(
  stage: HTMLElement,
  targets: readonly ErrandTarget[],
): HTMLElement | undefined {
  const marked = new Map<string, HTMLElement>();
  for (const element of stage.querySelectorAll<HTMLElement>(`[${ERRAND_TARGET_ATTRIBUTE}]`)) {
    const target = element.getAttribute(ERRAND_TARGET_ATTRIBUTE);
    if (target !== null && !marked.has(target) && drawn(element)) marked.set(target, element);
  }
  for (const target of targets) {
    const element = marked.get(target);
    if (element !== undefined) return element;
  }
  return undefined;
}

export interface LukeErrandProps {
  errand?: Errand;
  /**
   * The tap has landed, which is the moment the control it flew to should be
   * seen to move. Called once per errand and always — at once when there is
   * no flight to make — so whatever is waiting on it is never left held.
   *
   * Neither beat says which errand it belongs to, because there is only ever
   * one it could belong to: a second act waits its turn rather than overtaking
   * the flight in the air, so no beat is ever a stale flight's.
   */
  onLanded?: () => void;
  /**
   * The flight is over, or was abandoned. Called once per errand and always,
   * on the same terms, so a panel that was stood up for an errand knows when
   * it may stand back down — and so the act waiting behind this one knows it
   * may set off.
   */
  onReturned?: () => void;
}

/**
 * Luke on his way to a control, and the ring he leaves when he gets there.
 * Both are always mounted and both rest invisible: an element that arrived
 * with the flight would have no size or place to set off from, and mounting
 * one is a commit the panel does not need in the middle of a spoken answer.
 * Neither is a second Luke — the strip's own face is held invisible for
 * exactly as long as this one is drawn.
 *
 * The two callbacks are what let the act look like Luke's doing rather than
 * something he arrived to inspect. Both fire exactly once per errand, on every
 * path out — the flight running its course, a target that was never drawn,
 * tokens held still, a panel closing underneath it — because each of them
 * releases something the app is holding, and a hold nobody releases is worse
 * than a beat landing early.
 */
export function LukeErrand({ errand, onLanded, onReturned }: LukeErrandProps): React.JSX.Element {
  const mark = useRef<HTMLSpanElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (errand === undefined) return;
    // Each beat is released once and only once, however this effect leaves —
    // and releasing one that never came due is better than leaving the app
    // holding a switch that will never be allowed to move.
    let landed = false;
    let returned = false;
    const land = () => {
      if (landed) return;
      landed = true;
      onLanded?.();
    };
    const returnHome = () => {
      land();
      if (returned) return;
      returned = true;
      onReturned?.();
    };

    const markElement = mark.current;
    const ringElement = ring.current;
    if (markElement === null || ringElement === null) return returnHome();
    // The stage is the mark's own containing box, so it is found rather than
    // handed down: the two are the same element by construction.
    const stage = markElement.offsetParent;
    if (!(stage instanceof HTMLElement)) return returnHome();

    const style = getComputedStyle(stage);
    const token = (name: MotionToken) => style.getPropertyValue(name);
    const tokens: ErrandTokens = {
      surfaceMs: parseMilliseconds(token(MOTION_TOKEN.SURFACE_DURATION)),
      quick: parseMilliseconds(token(MOTION_TOKEN.QUICK_DURATION)),
      exit: parseMilliseconds(token(MOTION_TOKEN.EXIT_DURATION)),
      expand: parseMilliseconds(token(MOTION_TOKEN.EXPAND_DELAY)),
      stagger: parseMilliseconds(token(MOTION_TOKEN.ROW_STAGGER)),
      // A count rather than a length, but the same reading of a number off a
      // token, so it shares the reader.
      fanLimit: parsePixels(token(MOTION_TOKEN.ROW_FAN_LIMIT)),
    };
    if (!errandFlies(tokens)) return returnHome();
    const beats = errandBeats(tokens, errand.wait);
    const spring = token(MOTION_TOKEN.SPRING).trim() || "ease";
    const springFast = token(MOTION_TOKEN.SPRING_FAST).trim() || "ease";
    const exitEasing = token(MOTION_TOKEN.EXIT_EASING).trim() || "ease";

    const flight: Animation[] = [];
    let beat: number | undefined;
    let settle: number | undefined;
    let watch: MutationObserver | undefined;

    /**
     * Everything this flight is holding, put down at once. Called when the
     * shape goes out from under it, when a second errand overtakes it, and
     * when the panel unmounts — all of which are the flight being over rather
     * than paused. Both drawn elements rest invisible, so cancelling is the
     * whole of putting them away; the beats are released regardless, because
     * the change being carried has to be drawn whether or not anyone got to
     * watch it arrive.
     */
    const abandon = () => {
      window.clearTimeout(launch);
      if (beat !== undefined) window.clearTimeout(beat);
      if (settle !== undefined) window.clearTimeout(settle);
      watch?.disconnect();
      for (const animation of flight) animation.cancel();
      returnHome();
    };

    const launch = window.setTimeout(() => {
      // Read at the launch rather than when the errand was armed: the panel may
      // have closed behind the answer, and everything below is measured off a
      // shape that has finished moving.
      if (stage.dataset.presentation !== PANEL_PRESENTATION.PANEL) return returnHome();
      const face = stage.querySelector<HTMLElement>(`[${ERRAND_ORIGIN_ATTRIBUTE}]`);
      const target = landingPlace(stage, errand.targets);
      // No face is the meter standing in Luke's place, and no target is a
      // control this build does not draw. Either way there is no journey.
      if (face === null || !drawn(face) || target === undefined) return returnHome();
      // A control below the fold of a settings page is scrolled to first, so
      // the flight lands somewhere a reader is looking — and far enough above
      // the foot that the captions still to come cannot take the view back.
      // An already-visible control with room to spare is left exactly where it
      // is, which is the usual case.
      // The room the reply takes off the panel's foot is the caption block
      // plus the volume hint's band below it — two stacked elements, summed
      // here the same way the shape's growth sums them.
      const captionSize =
        parsePixels(token(MOTION_TOKEN.CAPTION_SIZE)) +
        parsePixels(token(MOTION_TOKEN.VOLUME_HINT_SIZE));
      keepInView(
        stage,
        target,
        captionRoom({
          drawn: stage.dataset.caption === "true",
          speaking: stage.dataset.voice === ERRAND_SPEAKING_VOICE,
          size: captionSize,
          max: parsePixels(token(MOTION_TOKEN.CAPTION_MAX)),
        }),
      );

      const stageBox = stage.getBoundingClientRect();
      const journey = errandJourney(
        stageBox,
        face.getBoundingClientRect(),
        target.getBoundingClientRect(),
      );
      // The black itself, which is what the drift may not be drawn past. The
      // surface is the one element that is the shape at whatever size it is
      // currently drawn, and it already names itself for the pointer, so the
      // flight asks the same element the same question — then takes back the
      // room the captions are only borrowing, because the shape the drift has
      // to stay inside is the one that will still be there when it gets home.
      const surface = stage.querySelector<HTMLElement>(
        `[${HIT_REGION_ATTRIBUTE}="${HIT_REGION.SURFACE}"]`,
      );
      const bound = errandSettledBound(
        errandBound(stageBox, (surface ?? stage).getBoundingClientRect()),
        captionSize,
      );
      const drift = errandDrift(journey, beats, bound);
      // A control drawn exactly where the face is has no journey to make.
      if (drift.length === 0) return returnHome();

      markElement.style.width = `${journey.size.width}px`;
      markElement.style.height = `${journey.size.height}px`;

      // Translate, then swell: the origin is the mark's own centre, so the tap
      // happens about the middle of the face rather than dragging it off
      // wherever it has travelled to.
      const at = (point: { x: number; y: number }, scale: number) =>
        `translate3d(${point.x}px, ${point.y}px, 0) scale(${scale})`;

      // Kept one at a time, so a malformed token throwing out of a later
      // `animate` still leaves nothing running: a half-built flight would send
      // the mark across the panel over a face that never went invisible.
      const play = (
        element: HTMLElement,
        keyframes: Keyframe[],
        options: KeyframeAnimationOptions,
      ) => {
        flight.push(element.animate(keyframes, options));
      };

      // Nothing moving is the better failure, and there is nothing else to
      // unwind because both of these elements rest invisible.
      try {
        play(
          markElement,
          [
            // Out on the surface's own spring, which is what makes the dive
            // read as part of the same object as the panel.
            { offset: 0, transform: at(journey.from, 1), easing: spring },
            // The tap: he overshoots his own size on landing and settles out
            // of it over the beat, so the arrival is a press rather than a
            // drift to a halt. This is the moment that carries the meaning,
            // and it is the only emphatic one in the flight.
            { offset: beats.arrival, transform: at(journey.to, LANDING_SCALE), easing: springFast },
            // The float home. Linear between the drift's own steps, because
            // its speed is already in where those steps fall — an easing per
            // segment would ease at every sample and read as a series of small
            // hesitations rather than as one unhurried drift.
            ...drift.map((step) => ({
              offset: step.offset,
              transform: at(step.point, 1),
              easing: "linear",
            })),
            // Parked on the face's own box for what is left, while the face
            // fades back in under him.
            { offset: 1, transform: at(journey.from, 1) },
          ],
          { duration: beats.duration },
        );
        // Drawn for exactly as long as the flight lasts and cut on the frame
        // it ends, rather than faded out: by then he is parked on a face that
        // is already fully drawn underneath him, so there is nothing for a
        // fade to cover and a fade would only make two of him visible.
        play(markElement, [{ opacity: 1 }, { opacity: 1 }], { duration: beats.duration });
        // The other half of the same trick, and the reason there is only ever
        // one Luke: the strip's face is held invisible for the flight and
        // brought back over the window he spends parked on top of it. The
        // wrapper rather than the drawing, because the drawing is remounted
        // for every gesture and an animation on it would die with the node.
        play(
          face,
          [
            { offset: 0, opacity: 0 },
            { offset: beats.home, opacity: 0, easing: exitEasing },
            { offset: 1, opacity: 1 },
          ],
          { duration: beats.duration },
        );
      } catch {
        for (const animation of flight) animation.cancel();
        returnHome();
        return;
      }

      // The two beats the app is waiting on, timed off the same flight rather
      // than guessed at alongside it. The tap is where the control is allowed
      // to move — before it, the change has been made and is simply not drawn
      // yet — and the end of the flight is where a panel stood up for this
      // errand may stand back down.
      beat = window.setTimeout(() => {
        // The control changes shape at the tap and not before: the options
        // button grows a label as the list narrows — by a provider's whole
        // name and mark, which is the widest it gets — and a pop-up is as wide
        // as the value it is showing. So the ring is measured after the change
        // is in the DOM rather than at the launch, when it would be the
        // outline of a control that is about to stop existing.
        //
        // Flushed rather than waited a frame for. The release is a React state
        // change made from a timer, which React is free to commit on its own
        // schedule — and a frame is not that schedule, so a ring drawn in the
        // next one measured the button as it was. This is the one place the
        // errand needs the DOM to have caught up before it reads it, so it is
        // the one place that says so outright.
        flushSync(land);
        const landing = errandBound(stage.getBoundingClientRect(), target.getBoundingClientRect());
        // A control the change took off the panel has no outline worth
        // drawing, and a zero box would draw a ring at the stage's corner.
        if (landing.width === 0 || landing.height === 0) return;
        ringElement.style.left = `${landing.left}px`;
        ringElement.style.top = `${landing.top}px`;
        ringElement.style.width = `${landing.width}px`;
        ringElement.style.height = `${landing.height}px`;
        // The ring is the control's own outline, so it takes the control's own
        // corners rather than a radius of its own.
        ringElement.style.borderRadius = getComputedStyle(target).borderRadius;
        try {
          play(
            ringElement,
            [
              { offset: 0, opacity: 0, transform: "scale(0.84)", easing: springFast },
              { offset: RING_BLOOM, opacity: 1, transform: "scale(1)", easing: exitEasing },
              { offset: 1, opacity: 0, transform: `scale(${RING_SPREAD})` },
            ],
            { duration: beats.duration * (1 - beats.arrival) },
          );
        } catch {
          // The mark is already home and dry without it; a ring that cannot be
          // drawn is not worth taking the rest of the flight down for.
        }
      }, beats.duration * beats.arrival);
      settle = window.setTimeout(returnHome, beats.duration);

      // The shape can go while he is out over it. Escape, the pointer leaving,
      // the capsule pressed, a spoken request, another window's lifecycle event —
      // any of them collapses the panel to the capsule, and a flight measured
      // against the shape it set off from would carry on across a surface that
      // is no longer under it and be drawn on the desktop. Nothing else here
      // watches the presentation: it is read once at the launch, and the
      // launch is over.
      //
      // Watched rather than passed down, and watched rather than re-run: the
      // presentation as a dependency would tear this effect down and build it
      // again on every change, which is a second flight rather than the end of
      // this one.
      watch = new MutationObserver(() => {
        if (stage.dataset.presentation === PANEL_PRESENTATION.PANEL) return;
        abandon();
      });
      watch.observe(stage, { attributes: true, attributeFilter: [PRESENTATION_ATTRIBUTE] });
    }, beats.delay);

    return abandon;
  }, [errand, onLanded, onReturned]);

  return (
    <>
      {/* Under him, so the tap is drawn over the ring it makes. */}
      <span className="luke-errand-ring" ref={ring} aria-hidden="true" />
      <span className="luke-errand-mark" ref={mark} aria-hidden="true">
        <LukeFace />
      </span>
    </>
  );
}
