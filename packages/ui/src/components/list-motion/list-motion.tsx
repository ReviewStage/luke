/**
 * list-motion.tsx -- how a list moves as its rows change: a row arriving slides in from the list's leading edge, a row leaving slides out toward it before it unmounts, and every row the change moved glides from where it was to where it now stands, out of one list into another included.
 *
 * Layout lands at once and motion replays it (docs/DESIGN.md): a commit puts
 * every row where the change stands it, and `ListMotion` replays the
 * journey FLIP-style on `transform`, from a snapshot taken in
 * `getSnapshotBeforeUpdate`, as `pane-motion.tsx` replays the panes. What
 * moves is every child of a list that opts in by wearing `data-motion-rows`
 * (`motionRows()`, or `List`'s `moves`), under the root `ListMotion` is
 * handed; a group of rows is itself a mover where the box around it opts in,
 * and carries its rows as it glides. A row that wears its key
 * (`data-motion-key`, `motionKey()`, or `ListRow`'s `motionKey`) is followed
 * by that key, so one taken out of one list and drawn in another, a task
 * pinned or moved to another group, glides across from where it stood rather
 * than leaving one and arriving in the other.
 *
 * A list keeps an entry it no longer lists drawn where it stood, leaving
 * (`useLeaving`), until its exit has played: "An element that unmounts is
 * held mounted through its own exit". The motion takes it out of the layout
 * at once, laid over the place it held, out of reach of the pointer and the
 * keyboard, and slides it out on the exit's tokens; it is let go once that
 * has played. What leaves goes first, so what it moved glides after it. An
 * entry listed again before its exit finished, an Undo, stands again and
 * comes back the way it went. A row arriving rides the pair every arriving
 * element rides, opacity over `--luke-duration-quick` and its travel on
 * `--luke-spring`, rows that arrive together a `--luke-row-stagger` apart. A
 * list that was not drawn before the change, a fold opened, draws its rows
 * at once, and nothing plays the first time a list is drawn. While what the
 * lists draw is still being read (`reading`), as an Inbox's reads land one
 * after another while the window opens, nothing a row draws is new to the
 * reader, so a row arriving fades in where it stands, with every other
 * arriving, rather than sliding in a stagger after the last.
 *
 * A change landing while rows still move, as reads landing one after
 * another while the window opens, stops nothing under way: each place is
 * read where the layout stands an element, not where its motion draws it, and
 * the glide that change asks for is added onto the ones still playing
 * (`composite: "add"`), so a row in flight carries on at the speed it had
 * rather than stopping dead and setting off again, and a row fading in
 * finishes its fade rather than showing at once.
 *
 * Every duration is read from the tokens where the list stands, so reduced
 * motion and a capture run, which zero them, hold the list still and let a
 * leaving row go on the frame it stopped being listed. A list wearing
 * `data-dragging` is the drag's to move while it lasts, and none of its rows
 * plays here.
 *
 * A list whose rows unroll (`LIST_MOTION_WAY.UNROLL`), as the rows a
 * setting reveals under it do (`reveal.tsx`), plays one gesture each way: a
 * row arriving is unrolled from its top edge by a clip as it fades in, on
 * the spring the rows under it glide down on, so its clip's foot and the
 * row under it travel as one edge; a row leaving is rolled up the same way
 * on the exit's tokens, and the rows under it close over it on those same
 * tokens at once, rather than after it, since what it goes into is the
 * room they close. Where rows arrive in its place in the same change, as a
 * choice's next rows do, they unroll on the spring as ever, and what they
 * move glides with them.
 *
 * Several motions over one root, each reveal of a page playing its own,
 * play a commit that changes more than one of them as one: each reads the
 * places the commit started from as the first read them, and the last to
 * hear the commit plays every exit they were handed before any glide, so a
 * row is never glided twice, nor to a place a row leaving below it is
 * about to give up.
 *
 * The one move the layout would still make above a leaving row is the
 * scroller's: a list scrolled to its end that grows shorter is scrolled back
 * by the browser as much as it shrank, which carries every row in sight
 * down. So the root holds its height while a row leaves, as far down as the
 * scroller shows it, through `--luke-list-held-height` (a root that reads
 * it as its `min-height`), and gives it back only as the reader scrolls up.
 */

import {
  Component,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MOTION_TOKEN, milliseconds, tokenTiming } from "../../motion-timing.js";

/** What a list whose children move wears. */
const ROWS_ATTRIBUTE = "data-motion-rows";

/** What a row followed by its key wears, the key as its value. */
const KEY_ATTRIBUTE = "data-motion-key";

/** What the root of a motion wears, so a motion around it leaves its lists to it. */
const ROOT_ATTRIBUTE = "data-motion-root";

/** What a list or a row wears while a drag moves it, which plays nothing here. */
const DRAGGING_ATTRIBUTE = "data-dragging";

/** Every element that moves: each child of a list that opts in. */
const MOVER = `[${ROWS_ATTRIBUTE}] > *`;

/** The property the root holds its height by while a row leaves. */
const HELD_HEIGHT = "--luke-list-held-height";

/** How far a row travels as it arrives or leaves, the list role's length. */
const TRAVEL = "--luke-list-travel";

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/** How small a row that scales out stands as it goes, and in as it arrives. */
const SCALED_AWAY = 0.6;

/** The most steps rows arriving together are staggered by; the rest arrive with the last. */
const STAGGER_STEPS = 6;

/** The clip a row unrolled away stands behind: cut from its foot to its top. */
const ROLLED_UP = "inset(0 0 100% 0)";

/** The clip a row unrolled whole stands behind. Note that it names its inset, because a clip cannot be interpolated from none. */
const UNROLLED = "inset(0)";

/** How a row arrives and leaves: sliding in from and out toward the list's leading edge, as a list's rows do, scaling in and out where it stands, as a row of chips does, or unrolling from and rolling up toward its top edge, as the rows a setting reveals do. */
export const LIST_MOTION_WAY = {
  SLIDE: "slide",
  SCALE: "scale",
  UNROLL: "unroll",
} as const;

export type ListMotionWay = (typeof LIST_MOTION_WAY)[keyof typeof LIST_MOTION_WAY];

/** The attributes a list whose children move wears, spread on it. */
export function motionRows(): { readonly "data-motion-rows": "" } {
  return { [ROWS_ATTRIBUTE]: "" };
}

/** The attribute a row followed by its key wears, spread on it. */
export function motionKey(key: string): { readonly "data-motion-key": string } {
  return { [KEY_ATTRIBUTE]: key };
}

/** What a leaving entry is to be drawn with, so it stands where it did. */
export const LIST_LEAVING_SELECTOR = "[data-leaving]";

/** One entry of a list as drawn: its key, its value as last listed, and whether it is leaving. */
export interface Drawn<T> {
  readonly key: string;
  readonly value: T;
  readonly leaving: boolean;
}

/** A leaving entry as handed to the motion: its key, and what lets it go once its exit has played. */
interface Leaver {
  readonly key: string;
  readonly onLeft: () => void;
}

/** What the lists under one motion hand it in a commit: the entries that began to leave, and the keys listed again before they had gone. */
interface Leaves {
  readonly pending: Leaver[];
  readonly returned: string[];
}

/** A point from the root's top left corner, in CSS pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where the layout stands a mover, and whether the reader could see it there: drawn at least in part inside what the scroller around the root shows. */
interface Place extends Point {
  readonly seen: boolean;
}

/** Where every mover under the root stood before a change, each keyed one by its key, and which lists stood. */
interface Snapshot {
  readonly places: Map<Element, Place>;
  readonly keyed: Map<string, Element>;
  readonly lists: Set<Element>;
}

/** What the motions over one root playing one commit share: where it started from, how many have still to hear it, and the exits handed them so far. */
interface Batch {
  readonly before: Snapshot;
  waiting: number;
  readonly leavers: Leaver[];
}

/** A leaving element as the motion takes it, and what lets its entry go. */
interface Exit {
  readonly element: HTMLElement;
  readonly onLeft: () => void;
}

const LeavesContext = createContext<Leaves | undefined>(undefined);

/** The exits under way, by the element leaving, stopped where its entry is listed again. */
const exits = new WeakMap<Element, Animation>();

/** The commit each root is being played in, by the root, until the last motion over it has heard it. */
const batches = new WeakMap<Element, Batch>();

/** Whether the DOM plays motions at all. Note that a test's DOM has no animation engine, and runs none. */
function animates(element: Element): boolean {
  return "animate" in element;
}

/**
 * The entries to draw once `listed` replaces what was drawn: every entry
 * listed, in its order, and every entry drawn that is no longer listed
 * still drawn, leaving, after the entry that stood before it.
 */
function drawnAfter<T>(
  drawn: readonly Drawn<T>[],
  listed: readonly T[],
  keyOf: (value: T) => string,
): Drawn<T>[] {
  const next: Drawn<T>[] = listed.map((value) => ({ key: keyOf(value), value, leaving: false }));
  const keys = new Set(next.map((entry) => entry.key));
  let before: string | undefined;
  for (const entry of drawn) {
    if (!keys.has(entry.key)) {
      const at = before === undefined ? 0 : next.findIndex((each) => each.key === before) + 1;
      next.splice(at, 0, entry.leaving ? entry : { ...entry, leaving: true });
    }
    before = entry.key;
  }
  return next;
}

/**
 * The entries of a list to draw: those it lists, and those it no longer
 * lists, leaving, until the `ListMotion` around it has played their exit.
 * A leaving entry's row wears `keyOf`'s key (`motionKey`), by which the
 * motion finds it, and draws as it did, though it should no longer hand
 * itself to what walks the list's rows. Without a motion around it, or with
 * no motion to play, an entry leaves at once.
 */
export function useLeaving<T>(
  listed: readonly T[],
  keyOf: (value: T) => string,
): readonly Drawn<T>[] {
  const leaves = useContext(LeavesContext);
  const [held, setHeld] = useState(() => ({
    listed,
    drawn: drawnAfter<T>([], listed, keyOf),
  }));
  // Note that what is drawn follows the list as it renders, React's way of
  // keeping what an earlier render drew, so a row leaves on the frame it
  // stops being listed rather than a frame later.
  let { drawn } = held;
  if (held.listed !== listed) {
    drawn = drawnAfter(held.drawn, listed, keyOf);
    setHeld({ listed, drawn });
  }
  const told = useRef(new Set<string>());
  useLayoutEffect(() => {
    const leaving = new Set(drawn.filter((entry) => entry.leaving).map((entry) => entry.key));
    for (const key of told.current) {
      if (leaving.has(key)) continue;
      told.current.delete(key);
      if (drawn.some((entry) => entry.key === key)) leaves?.returned.push(key);
    }
    for (const key of leaving) {
      if (told.current.has(key)) continue;
      told.current.add(key);
      const onLeft = () =>
        setHeld((now) => ({
          listed: now.listed,
          drawn: now.drawn.filter((entry) => !(entry.leaving && entry.key === key)),
        }));
      if (leaves === undefined) {
        onLeft();
        continue;
      }
      const leaver = { key, onLeft };
      leaves.pending.push(leaver);
      // A list that drew on its own, its motion not drawn with it, lets the entry go at once.
      queueMicrotask(() => {
        const at = leaves.pending.indexOf(leaver);
        if (at < 0) return;
        leaves.pending.splice(at, 1);
        onLeft();
      });
    }
  });
  return drawn;
}

/** Every mover under `root`, outside any list a drag moves and any motion of its own inside it. */
function moversOf(root: HTMLElement): HTMLElement[] {
  const own = root.hasAttribute(ROWS_ATTRIBUTE) ? [...root.children] : [];
  const movers = new Set([...own, ...root.querySelectorAll(MOVER)]);
  return [...movers].filter((mover): mover is HTMLElement => {
    const list = mover.parentElement;
    return (
      mover instanceof HTMLElement &&
      list !== null &&
      !list.hasAttribute(DRAGGING_ATTRIBUTE) &&
      (list.closest(`[${ROOT_ATTRIBUTE}]`) ?? root) === root
    );
  });
}

/**
 * How far its own transform draws `element` from where the layout stands
 * it, a motion under way included: the transform's translation, and what a
 * scale about its origin moves its top left corner by.
 */
function shiftOf(element: Element): Point {
  const style = getComputedStyle(element);
  const matrix = /^matrix(3d)?\(([^)]*)\)$/u.exec(style.transform);
  if (matrix === null) return { x: 0, y: 0 };
  const m = (matrix[2] ?? "").split(",").map(Number);
  const [a, d, e, f] =
    matrix[1] === undefined ? [m[0], m[3], m[4], m[5]] : [m[0], m[5], m[12], m[13]];
  const [originX = 0, originY = 0] = style.transformOrigin.split(" ").map(Number.parseFloat);
  return {
    x: (e ?? 0) + originX * (1 - (a ?? 1)),
    y: (f ?? 0) + originY * (1 - (d ?? 1)),
  };
}

/** The nearest element above `element` that scrolls it, if one does. */
function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return undefined;
}

/** The band of the window, top to bottom, that shows what `root` draws: the scroller's box around it, cut to the window. */
function viewOf(root: HTMLElement): { readonly top: number; readonly bottom: number } {
  const scroller = scrollerOf(root)?.getBoundingClientRect();
  const height = root.ownerDocument.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY;
  return {
    top: Math.max(scroller?.top ?? 0, 0),
    bottom: Math.min(scroller?.bottom ?? height, height),
  };
}

/**
 * Where the layout stands each element, from the root's top left corner:
 * where it is drawn, less what its own transform and every one around it
 * under the root draw it by, so a motion under way moves no place; and
 * whether it is drawn where the reader can see it.
 */
function placesOf(root: HTMLElement, elements: readonly Element[]): Map<Element, Place> {
  const origin = root.getBoundingClientRect();
  const view = viewOf(root);
  const places = new Map<Element, Place>();
  for (const element of elements) {
    const box = element.getBoundingClientRect();
    const seen = box.bottom >= view.top && box.top <= view.bottom;
    let x = box.left - origin.left;
    let y = box.top - origin.top;
    for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) {
      const shift = shiftOf(at);
      x -= shift.x;
      y -= shift.y;
    }
    places.set(element, { x, y, seen });
  }
  return places;
}

/** Where every mover under `root` stands now, by element and by key, and the lists that stand. */
function snapshotOf(root: HTMLElement): Snapshot {
  // Note that a row already on its way out stood nowhere, so one listed again arrives.
  const movers = moversOf(root).filter((mover) => !exits.has(mover));
  const keyed = new Map<string, Element>();
  for (const mover of movers) {
    const key = mover.getAttribute(KEY_ATTRIBUTE);
    if (key !== null) keyed.set(key, mover);
  }
  const lists = new Set<Element>(root.querySelectorAll(`[${ROWS_ATTRIBUTE}]`));
  if (root.hasAttribute(ROWS_ATTRIBUTE)) lists.add(root);
  return { places: placesOf(root, movers), keyed, lists };
}

/** The mover that carries `element` as it glides, the group it stands in, or the root where none does. */
function carrierOf(root: HTMLElement, element: Element): Element {
  const around = element.parentElement?.closest(MOVER);
  return around === null || around === undefined || !root.contains(around) ? root : around;
}

/** An element whose exit was stopped, its entry listed again, standing as it did before it left. */
function standAgain(element: HTMLElement): void {
  exits.get(element)?.cancel();
  exits.delete(element);
  for (const property of ["position", "top", "left", "width", "margin", "display"]) {
    element.style.removeProperty(property);
  }
  element.removeAttribute("inert");
  element.removeAttribute("data-leaving");
}

/**
 * Where the layout stood a leaving element before the commit, as a top in
 * the box it is laid out in once it leaves the layout, its list (positioned,
 * list-motion.css): read from `before` rather than from where the commit put
 * it, since a row arriving above it in the same change moved it, and from
 * the mover that carries it, which glides it on from there. Where nothing
 * was read before, it stands where it is.
 */
function standingTop(root: HTMLElement, element: HTMLElement, before: Snapshot): number {
  const box = element.parentElement;
  const carrier = carrierOf(root, element);
  const was = before.places.get(element)?.y;
  const carrierWas = carrier === root ? 0 : before.places.get(carrier)?.y;
  if (box === null || was === undefined || carrierWas === undefined) return element.offsetTop;
  const boxInCarrier = box.getBoundingClientRect().top - carrier.getBoundingClientRect().top;
  return was - carrierWas - boxInCarrier - box.clientTop;
}

/** Where a row stands once gone, the way it arrives and leaves, read where the list stands. */
function awayOf(root: HTMLElement, way: ListMotionWay): Keyframe {
  if (way === LIST_MOTION_WAY.UNROLL) return { clipPath: ROLLED_UP };
  if (way === LIST_MOTION_WAY.SCALE) return { transform: `scale(${SCALED_AWAY})` };
  const travel = Number.parseFloat(getComputedStyle(root).getPropertyValue(TRAVEL)) || 0;
  return { transform: `translateX(${-travel}px)` };
}

/** Where a row stands once it has arrived, the way it arrives and leaves. */
function homeOf(way: ListMotionWay): Keyframe {
  return way === LIST_MOTION_WAY.UNROLL ? { clipPath: UNROLLED } : { transform: "none" };
}

/**
 * Takes each leaving element out of the layout, laid over the place it is
 * drawn at, and slides it out, letting its entry go once that has played;
 * at once where there is to be no motion, or where the reader could not
 * see it. Note that every place is read before any element leaves, since
 * each that leaves moves the rest, and that the exit takes over from
 * whatever motion of its own was under way, so it is laid where that motion
 * drew it rather than where the layout stood it.
 */
function playExits(
  root: HTMLElement,
  leaving: readonly Exit[],
  before: Snapshot,
  exit: KeyframeAnimationOptions | undefined,
  way: ListMotionWay,
): void {
  if (exit === undefined) {
    for (const each of leaving) each.onLeft();
    return;
  }
  const away = awayOf(root, way);
  // Note that a row out of sight plays nothing, so a list that loses thousands at once, the Inbox's All to its To do, animates no more than a screenful.
  const seen = leaving.filter(({ element }) => before.places.get(element)?.seen === true);
  for (const { element, onLeft } of leaving) {
    if (before.places.get(element)?.seen === true) continue;
    element.style.display = "none";
    onLeft();
  }
  const placed = seen.map((each) => {
    const { element } = each;
    const shift = shiftOf(element);
    return {
      each,
      top: standingTop(root, element, before) + shift.y,
      left: element.offsetLeft + shift.x,
      width: element.offsetWidth,
      opacity: getComputedStyle(element).opacity || "1",
    };
  });
  for (const { each, top, left, width, opacity } of placed) {
    const { element, onLeft } = each;
    element.style.position = "absolute";
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    element.style.width = `${width}px`;
    element.style.margin = "0";
    const out = element.animate(
      [
        { opacity, ...homeOf(way) },
        { opacity: 0, ...away },
      ],
      { ...exit, fill: "forwards" },
    );
    out.onfinish = onLeft;
    exits.set(element, out);
  }
}

/** The timings a change's moves play on, read where the list stands. */
interface MoveTiming {
  readonly wait: number;
  readonly travel: KeyframeAnimationOptions;
  readonly arrive: KeyframeAnimationOptions | undefined;
  readonly stagger: number;
  readonly way: ListMotionWay;
  /** Whether a row arriving travels in from where it would leave to, or only fades in where it stands. */
  readonly travels: boolean;
  /** What the rows a leaving row unrolled away from close over it on, where nothing arrives in its place: its exit's timing. */
  readonly close: KeyframeAnimationOptions | undefined;
}

/** Plays a row's arrival, the way it would leave played back on the spring, added onto any motion of its own, as it fades in, `step` staggers after the first; only the fade where it does not travel. */
function arrive(mover: Element, step: number, away: Keyframe, timing: MoveTiming): void {
  if (timing.arrive === undefined) return;
  const delay = timing.wait + Math.min(step, STAGGER_STEPS) * timing.stagger;
  mover.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing.arrive, delay, fill: "backwards" });
  if (!timing.travels) return;
  // Note that a clip is no offset to add onto one under way, so an unroll replaces any clip of its own.
  const unrolls = timing.way === LIST_MOTION_WAY.UNROLL;
  mover.animate([away, homeOf(timing.way)], {
    ...timing.travel,
    delay,
    fill: "backwards",
    composite: unrolls ? "replace" : "add",
  });
}

/**
 * Replays from `before` what the commit moved under `root`: each mover
 * glides from where it stood, or where the row of its key stood in another
 * list, less what the group around it moved, which carries it, added onto
 * any glide of its own still under way; a mover new to a list that stood
 * fades in. Both wait out the exit when something left, as what leaves goes
 * first. Only a mover the reader could see, before the change or after it,
 * plays: one out of sight just stands where the change put it, so a change
 * of thousands of rows plays a screenful of them.
 */
function playMoves(root: HTMLElement, before: Snapshot, timing: MoveTiming): void {
  // Note that a row leaving with no exit to play, out of sight or moved to another list, is hidden until its entry goes, and glides nowhere.
  const movers = moversOf(root).filter(
    (mover) => !exits.has(mover) && !mover.hasAttribute("data-leaving"),
  );
  const now = placesOf(root, movers);
  const wasOf = (mover: Element): Place | undefined => {
    const own = before.places.get(mover);
    if (own !== undefined) return own;
    const key = mover.getAttribute(KEY_ATTRIBUTE);
    const was = key === null ? undefined : before.keyed.get(key);
    return was === undefined ? undefined : before.places.get(was);
  };
  const movedBy = (mover: Element): Point => {
    const was = wasOf(mover);
    const is = now.get(mover);
    return was === undefined || is === undefined
      ? { x: 0, y: 0 }
      : { x: was.x - is.x, y: was.y - is.y };
  };
  const arriving = movers.filter((mover) => {
    const list = mover.parentElement;
    return wasOf(mover) === undefined && list !== null && before.lists.has(list);
  });
  const away = awayOf(root, timing.way);
  const seenArriving = arriving.filter((mover) => now.get(mover)?.seen === true);
  for (const [step, mover] of seenArriving.entries()) arrive(mover, step, away, timing);
  // Note that rows arriving in a leaving row's place, a choice's next rows, set the beat what they move glides on.
  const glide = arriving.length === 0 ? (timing.close ?? timing.travel) : timing.travel;
  for (const mover of movers) {
    const was = wasOf(mover);
    if (was === undefined || !(was.seen || now.get(mover)?.seen === true)) continue;
    const carrier = carrierOf(root, mover);
    const own = movedBy(mover);
    const carried = carrier === root ? { x: 0, y: 0 } : movedBy(carrier);
    const x = own.x - carried.x;
    const y = own.y - carried.y;
    if (Math.abs(x) < STILL && Math.abs(y) < STILL) continue;
    mover.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], {
      ...glide,
      delay: timing.wait,
      fill: "backwards",
      composite: "add",
    });
  }
}

/** How tall what `root` lays out stands, from its top to under its last element in the layout. */
function laidOutHeight(root: HTMLElement): number {
  const top = root.getBoundingClientRect().top;
  let bottom = 0;
  for (const child of root.children) {
    if (exits.has(child) || getComputedStyle(child).position === "absolute") continue;
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom - top);
  }
  return bottom + Number.parseFloat(getComputedStyle(root).paddingBottom || "0");
}

interface ListMotionPlayerProps {
  root: RefObject<HTMLElement | null>;
  leaves: Leaves;
  change: unknown;
  way: ListMotionWay;
  reading: boolean;
}

/** It holds no state of its own. */
type ListMotionPlayerState = Record<never, never>;

/**
 * Plays the lists' changes over the root: the exits of what leaves, the
 * glides of what that moved, and the root's height held at the scroller's
 * end. Note that this is a class, as `PaneGlide` is, because
 * `getSnapshotBeforeUpdate` is the one moment React gives to read the
 * layout a commit is about to change; it draws nothing of its own, and is
 * drawn after the lists, so they have handed it their leaving entries by
 * the time it plays.
 */
class ListMotionPlayer extends Component<
  ListMotionPlayerProps,
  ListMotionPlayerState,
  Batch | null
> {
  /** Gives back the root's held height and stops following the scroller; none while nothing is held. */
  private release: (() => void) | undefined = undefined;

  override getSnapshotBeforeUpdate(previous: ListMotionPlayerProps): Batch | null {
    const root = this.props.root.current;
    if (root === null) return null;
    if (this.props.change !== undefined && previous.change === this.props.change) return null;
    let batch = batches.get(root);
    if (batch === undefined) {
      const opened: Batch = { before: snapshotOf(root), waiting: 0, leavers: [] };
      batch = opened;
      batches.set(root, opened);
      // Note that a commit no motion heard the end of is not one the next commit starts from.
      queueMicrotask(() => {
        if (batches.get(root) === opened) batches.delete(root);
      });
    }
    batch.waiting += 1;
    return batch;
  }

  override componentDidUpdate(
    previous: ListMotionPlayerProps,
    _state: ListMotionPlayerState,
    batch: Batch | null,
  ): void {
    const { pending, returned } = this.props.leaves;
    const leavers = pending.splice(0);
    const root = this.props.root.current;
    root?.setAttribute(ROOT_ATTRIBUTE, "");
    if (root !== null) this.standReturned(root, returned.splice(0));
    if (root === null || batch === null) {
      for (const leaver of leavers) leaver.onLeft();
      return;
    }
    batch.leavers.push(...leavers);
    batch.waiting -= 1;
    // Note that the last motion over the root to hear the commit plays it, with every exit the others were handed.
    if (batch.waiting > 0) return;
    if (batches.get(root) === batch) batches.delete(root);
    this.play(root, batch, this.props.reading || previous.reading);
  }

  override componentDidMount(): void {
    this.props.root.current?.setAttribute(ROOT_ATTRIBUTE, "");
  }

  override componentWillUnmount(): void {
    this.release?.();
  }

  override render(): null {
    return null;
  }

  /**
   * Plays a commit over the root: the exits of what leaves, the glides of
   * what that moved, and the root's height held at the scroller's end.
   * Note that the rows a leaving row unrolled away from close over it as it
   * rolls up, on its exit's tokens, where the rest glide after it.
   */
  private play(root: HTMLElement, batch: Batch, reading: boolean): void {
    const { before } = batch;
    const leaving = this.leavingOf(root, batch.leavers, before);
    if (leaving.length > 0) this.holdHeight(root);
    // Note that a root holding no mover and losing none has nothing to play, as a message box's row of files does while it holds none, so its tokens are never read on every keystroke.
    if (leaving.length === 0 && moversOf(root).length === 0) return;
    // Note that a DOM with no animation engine, a test's, marks what leaves and lets it go at once.
    const engine = animates(root);
    const exit = engine
      ? tokenTiming(root, MOTION_TOKEN.DURATION_EXIT, MOTION_TOKEN.EASE_EXIT)
      : undefined;
    const { way } = this.props;
    playExits(root, leaving, before, exit, way);
    const shape = engine
      ? tokenTiming(root, MOTION_TOKEN.DURATION_SHAPE, MOTION_TOKEN.SPRING)
      : undefined;
    if (shape === undefined) return;
    const left = leaving.length > 0 && exit !== undefined;
    const closes = left && way === LIST_MOTION_WAY.UNROLL;
    // Note that the change that ends the read lands the last of it, which arrives as the rest of it did.
    playMoves(root, before, {
      wait: left && !closes ? Number(exit.duration) : 0,
      travel: shape,
      close: closes ? exit : undefined,
      arrive: tokenTiming(root, MOTION_TOKEN.DURATION_QUICK, MOTION_TOKEN.EASE_EXIT),
      stagger: reading
        ? 0
        : milliseconds(getComputedStyle(root).getPropertyValue(MOTION_TOKEN.ROW_STAGGER)),
      way,
      travels: !reading,
    });
  }

  /** Stands again each element whose entry was listed again before its exit finished. */
  private standReturned(root: HTMLElement, keys: readonly string[]): void {
    if (keys.length === 0) return;
    const back = new Set(keys);
    for (const mover of moversOf(root)) {
      const key = mover.getAttribute(KEY_ATTRIBUTE);
      if (key !== null && back.has(key) && mover.hasAttribute("data-leaving")) standAgain(mover);
    }
  }

  /**
   * The element each leaving entry is drawn as, marked out of reach at once,
   * before the lists' own effects run, so a row holding the keyboard is seen
   * to have lost it. An entry whose row now stands in another list moved
   * rather than left: its old element is let go at once, and the new one
   * glides across from it. An entry no element was found for goes at once.
   */
  private leavingOf(root: HTMLElement, leavers: readonly Leaver[], before: Snapshot): Exit[] {
    const keyedNow = new Map<string, Element[]>();
    for (const mover of moversOf(root)) {
      const key = mover.getAttribute(KEY_ATTRIBUTE);
      if (key !== null) keyedNow.set(key, [...(keyedNow.get(key) ?? []), mover]);
    }
    const leaving: Exit[] = [];
    for (const { key, onLeft } of leavers) {
      const element = before.keyed.get(key);
      if (!(element instanceof HTMLElement) || !element.isConnected) {
        onLeft();
        continue;
      }
      element.toggleAttribute("inert", true);
      element.setAttribute("data-leaving", "");
      if ((keyedNow.get(key) ?? []).some((other) => other !== element)) {
        element.style.display = "none";
        onLeft();
        continue;
      }
      leaving.push({ element, onLeft });
    }
    return leaving;
  }

  /**
   * Holds the root as tall as the scroller shows it, so the scroller is
   * never scrolled back as the list shrinks, and gives the height back as
   * the reader scrolls up, all of it once what the root lays out reaches
   * the scroller's foot again or the scroller stands at its top. Note that a
   * scroller at its top is never scrolled back, so nothing is held there.
   */
  private holdHeight(root: HTMLElement): void {
    this.release?.();
    const scroller = scrollerOf(root);
    if (scroller === undefined || scroller.scrollTop <= 0) return;
    const reach = () => scroller.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
    let held = Math.min(root.offsetHeight, reach());
    if (held <= 0) return;
    root.style.setProperty(HELD_HEIGHT, `${held}px`);
    const follow = () => {
      held = Math.min(held, reach());
      if (scroller.scrollTop <= 0 || held <= laidOutHeight(root)) this.release?.();
      else root.style.setProperty(HELD_HEIGHT, `${held}px`);
    };
    scroller.addEventListener("scroll", follow, { passive: true });
    this.release = () => {
      scroller.removeEventListener("scroll", follow);
      root.style.removeProperty(HELD_HEIGHT);
      this.release = undefined;
    };
  }
}

/**
 * The motion of every list under `root`, which `children` draw: the box
 * `root` names stands among them, and each list under it that opts in
 * (`motionRows`) moves as this file's header says. `change`, where given,
 * is what the lists draw, and a commit that keeps it plays nothing; without
 * it every commit is read. `way` is how a row arrives and leaves, and
 * `reading` whether what the lists draw is still being read, which fades a
 * row arriving in where it stands.
 */
export function ListMotion({
  root,
  change,
  way = LIST_MOTION_WAY.SLIDE,
  reading = false,
  children,
}: {
  root: RefObject<HTMLElement | null>;
  change?: unknown;
  way?: ListMotionWay;
  reading?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [leaves] = useState<Leaves>(() => ({ pending: [], returned: [] }));
  return (
    <LeavesContext.Provider value={leaves}>
      {children}
      <ListMotionPlayer root={root} leaves={leaves} change={change} way={way} reading={reading} />
    </LeavesContext.Provider>
  );
}
