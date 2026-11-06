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

const ROWS_ATTRIBUTE = "data-motion-rows";

const KEY_ATTRIBUTE = "data-motion-key";

const ROOT_ATTRIBUTE = "data-motion-root";

const DRAGGING_ATTRIBUTE = "data-dragging";

const MOVER = `[${ROWS_ATTRIBUTE}] > *`;

const HELD_HEIGHT = "--ui-list-held-height";

const TRAVEL = "--ui-list-travel";

const STILL = 0.5;

const SCALED_AWAY = 0.6;

const STAGGER_STEPS = 6;

const ROLLED_UP = "inset(0 0 100% 0)";

const UNROLLED = "inset(0)";

export const LIST_MOTION_WAY = {
  SLIDE: "slide",
  SCALE: "scale",
  UNROLL: "unroll",
} as const;

export type ListMotionWay = (typeof LIST_MOTION_WAY)[keyof typeof LIST_MOTION_WAY];

export function motionRows(): { readonly "data-motion-rows": "" } {
  return { [ROWS_ATTRIBUTE]: "" };
}

export function motionKey(key: string): { readonly "data-motion-key": string } {
  return { [KEY_ATTRIBUTE]: key };
}

export const LIST_LEAVING_SELECTOR = "[data-leaving]";

export interface Drawn<T> {
  readonly key: string;
  readonly value: T;
  readonly leaving: boolean;
}

interface Leaver {
  readonly key: string;
  readonly onLeft: () => void;
}

interface Leaves {
  readonly pending: Leaver[];
  readonly returned: string[];
  readonly replay: () => void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Place extends Point {
  readonly seen: boolean;
}

interface Snapshot {
  readonly places: Map<Element, Place>;
  readonly keyed: Map<string, Element>;
  readonly lists: Set<Element>;
}

interface Batch {
  readonly before: Snapshot;
  waiting: number;
  readonly leavers: Leaver[];
}

interface Exit {
  readonly element: HTMLElement;
  readonly onLeft: () => void;
}

const LeavesContext = createContext<Leaves | undefined>(undefined);

const exits = new WeakMap<Element, Animation>();

const batches = new WeakMap<Element, Batch>();

function animates(element: Element): boolean {
  return "animate" in element;
}

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

export function useLeaving<T>(
  listed: readonly T[],
  keyOf: (value: T) => string,
): readonly Drawn<T>[] {
  const leaves = useContext(LeavesContext);
  const [held, setHeld] = useState(() => ({
    listed,
    drawn: drawnAfter<T>([], listed, keyOf),
  }));
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

const NO_REPLAY = (): void => undefined;

export function useListMotionReplay(): () => void {
  return useContext(LeavesContext)?.replay ?? NO_REPLAY;
}

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

function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return undefined;
}

function viewOf(root: HTMLElement): { readonly top: number; readonly bottom: number } {
  const scroller = scrollerOf(root)?.getBoundingClientRect();
  const height = root.ownerDocument.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY;
  return {
    top: Math.max(scroller?.top ?? 0, 0),
    bottom: Math.min(scroller?.bottom ?? height, height),
  };
}

function placesOf(root: HTMLElement, elements: readonly Element[]): Map<Element, Place> {
  const origin = root.getBoundingClientRect();
  const view = viewOf(root);
  const places = new Map<Element, Place>();
  const shifts = new Map<Element, Point>();
  const shiftOnce = (element: Element): Point => {
    const known = shifts.get(element);
    if (known !== undefined) return known;
    const shift = shiftOf(element);
    shifts.set(element, shift);
    return shift;
  };
  for (const element of elements) {
    const box = element.getBoundingClientRect();
    const seen = box.bottom >= view.top && box.top <= view.bottom;
    let x = box.left - origin.left;
    let y = box.top - origin.top;
    for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) {
      const shift = shiftOnce(at);
      x -= shift.x;
      y -= shift.y;
    }
    places.set(element, { x, y, seen });
  }
  return places;
}

function snapshotOf(root: HTMLElement): Snapshot {
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

function carrierOf(root: HTMLElement, element: Element): Element {
  const around = element.parentElement?.closest(MOVER);
  return around === null || around === undefined || !root.contains(around) ? root : around;
}

function standAgain(element: HTMLElement): void {
  exits.get(element)?.cancel();
  exits.delete(element);
  for (const property of ["position", "top", "left", "width", "margin", "display"]) {
    element.style.removeProperty(property);
  }
  element.removeAttribute("inert");
  element.removeAttribute("data-leaving");
}

function standingTop(root: HTMLElement, element: HTMLElement, before: Snapshot): number {
  const box = element.parentElement;
  const carrier = carrierOf(root, element);
  const was = before.places.get(element)?.y;
  const carrierWas = carrier === root ? 0 : before.places.get(carrier)?.y;
  if (box === null || was === undefined || carrierWas === undefined) return element.offsetTop;
  const boxInCarrier = box.getBoundingClientRect().top - carrier.getBoundingClientRect().top;
  return was - carrierWas - boxInCarrier - box.clientTop;
}

function awayOf(root: HTMLElement, way: ListMotionWay): Keyframe {
  if (way === LIST_MOTION_WAY.UNROLL) return { clipPath: ROLLED_UP };
  if (way === LIST_MOTION_WAY.SCALE) return { transform: `scale(${SCALED_AWAY})` };
  const travel = Number.parseFloat(getComputedStyle(root).getPropertyValue(TRAVEL)) || 0;
  return { transform: `translateX(${-travel}px)` };
}

function homeOf(way: ListMotionWay): Keyframe {
  return way === LIST_MOTION_WAY.UNROLL ? { clipPath: UNROLLED } : { transform: "none" };
}

function playExits(
  root: HTMLElement,
  leaving: readonly Exit[],
  before: Snapshot,
  exit: KeyframeAnimationOptions | undefined,
  way: ListMotionWay,
  replay: () => void,
): void {
  if (exit === undefined) {
    for (const each of leaving) each.onLeft();
    return;
  }
  const away = awayOf(root, way);
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
    out.onfinish = () => {
      onLeft();
      replay();
    };
    exits.set(element, out);
  }
}

interface MoveTiming {
  readonly wait: number;
  readonly travel: KeyframeAnimationOptions;
  readonly arrive: KeyframeAnimationOptions | undefined;
  readonly stagger: number;
  readonly way: ListMotionWay;
  readonly travels: boolean;
  readonly close: KeyframeAnimationOptions | undefined;
}

function arrive(mover: Element, step: number, away: Keyframe, timing: MoveTiming): void {
  if (timing.arrive === undefined) return;
  const delay = timing.wait + Math.min(step, STAGGER_STEPS) * timing.stagger;
  mover.animate([{ opacity: 0 }, { opacity: 1 }], { ...timing.arrive, delay, fill: "backwards" });
  if (!timing.travels) return;
  const unrolls = timing.way === LIST_MOTION_WAY.UNROLL;
  mover.animate([away, homeOf(timing.way)], {
    ...timing.travel,
    delay,
    fill: "backwards",
    composite: unrolls ? "replace" : "add",
  });
}

function playMoves(root: HTMLElement, before: Snapshot, timing: MoveTiming): void {
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
  replays: number;
  scene: unknown;
  way: ListMotionWay;
  reading: boolean;
}

type ListMotionPlayerState = Record<never, never>;

class ListMotionPlayer extends Component<
  ListMotionPlayerProps,
  ListMotionPlayerState,
  Batch | null
> {
  private release: (() => void) | undefined = undefined;

  override getSnapshotBeforeUpdate(previous: ListMotionPlayerProps): Batch | null {
    const root = this.props.root.current;
    if (root === null) return null;
    const asked = previous.replays !== this.props.replays;
    if (!asked && this.props.change !== undefined && previous.change === this.props.change) {
      return null;
    }
    if (previous.scene !== this.props.scene) {
      this.release?.();
      return null;
    }
    let batch = batches.get(root);
    if (batch === undefined) {
      const opened: Batch = { before: snapshotOf(root), waiting: 0, leavers: [] };
      batch = opened;
      batches.set(root, opened);
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

  private play(root: HTMLElement, batch: Batch, reading: boolean): void {
    const { before } = batch;
    const leaving = this.leavingOf(root, batch.leavers, before);
    if (leaving.length > 0) this.holdHeight(root);
    if (leaving.length === 0 && moversOf(root).length === 0) return;
    const engine = animates(root);
    const exit = engine
      ? tokenTiming(root, MOTION_TOKEN.DURATION_EXIT, MOTION_TOKEN.EASE_EXIT)
      : undefined;
    const { way } = this.props;
    playExits(root, leaving, before, exit, way, this.props.leaves.replay);
    const shape = engine
      ? tokenTiming(root, MOTION_TOKEN.DURATION_SHAPE, MOTION_TOKEN.SPRING)
      : undefined;
    if (shape === undefined) return;
    const left = leaving.length > 0 && exit !== undefined;
    const closes = left && way === LIST_MOTION_WAY.UNROLL;
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

  private standReturned(root: HTMLElement, keys: readonly string[]): void {
    if (keys.length === 0) return;
    const back = new Set(keys);
    for (const mover of moversOf(root)) {
      const key = mover.getAttribute(KEY_ATTRIBUTE);
      if (key !== null && back.has(key) && mover.hasAttribute("data-leaving")) standAgain(mover);
    }
  }

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

export function ListMotion({
  root,
  change,
  scene,
  way = LIST_MOTION_WAY.SLIDE,
  reading = false,
  children,
}: {
  root: RefObject<HTMLElement | null>;
  change?: unknown;
  scene?: unknown;
  way?: ListMotionWay;
  reading?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const [replays, setReplays] = useState(0);
  const [leaves] = useState<Leaves>(() => ({
    pending: [],
    returned: [],
    replay: () => setReplays((count) => count + 1),
  }));
  return (
    <LeavesContext.Provider value={leaves}>
      {children}
      <ListMotionPlayer
        root={root}
        leaves={leaves}
        change={change}
        replays={replays}
        scene={scene}
        way={way}
        reading={reading}
      />
    </LeavesContext.Provider>
  );
}
