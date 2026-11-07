/**
 * use-idle-tabs.ts -- tabs the developer has not looked at for a day close themselves, as Arc's do, onto the stack ⇧⌘T opens again.
 *
 * Each strip, the task's column (`use-main-tabs.ts`) and the side panel
 * (`use-side-panel.ts`), keeps per task when each of its tabs was last
 * viewed. A tab is viewed while it is the one its strip shows and the
 * task's page is on screen, nothing standing over it: it is stamped as it
 * stops being shown, whether another tab takes its place, the task is left,
 * or a page covers it, and while it stays shown, again each hour, so a window
 * quit on it still says when it was last on screen. A tab no stamp names
 * yet, whether just opened or kept by a version from before the stamps,
 * counts as viewed the first time it is seen here, so nothing closes the
 * moment it is first counted. A wake forked on `@repo/ui`'s edge sleeps until
 * the next moment something falls due, a tab's day unviewed or the shown
 * tab's hour, and wakes the tidy then, rather than ticking while nothing
 * can; on each wake and on a task opening, every tab of the open task's
 * strips not viewed for a day closes, last in its strip first, through the
 * strip's own close, so ⇧⌘T and the "+" bring each back where it stood.
 *
 * What a strip keeps open however long it goes unviewed is the strip's
 * caller's to say (`keeps`): a tab pinned to the sidebar, an agent's while
 * it works, waits on the developer, or ended unseen, and a tab whose close
 * nothing could undo. The shown tab is kept too. An agent's tab closed here
 * opens again as the agent wakes, a new turn or a new Inbox item of its
 * (`onWake`), where one the developer closed by hand stays closed.
 */

import { effectServices, forkEffect, streamInto } from "@repo/ui";
import {
  idleTabs,
  type StripTab,
  sameTab,
  type ViewedAt,
  viewedAtOf,
} from "@repo/ui/tab-strip-model";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { Clock, Context, Duration, Effect, Stream } from "effect";
import { useEffect, useRef } from "react";

/** How long a tab may go unviewed before it closes itself. */
const TAB_IDLE = Duration.hours(24);

/**
 * How often a tab that stays shown is stamped again. Note that it is not
 * every tick, because each stamp is a write of the strip's whole record.
 */
const RESTAMP_EVERY = Duration.hours(1);

/** The moment named when nothing in the open task's strips falls due. */
const NEVER_DUE = Number.POSITIVE_INFINITY;

/** Sleeps until `due`, then answers the time, on whatever clock it runs under. */
const wokenAt = (due: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.sleep(Duration.millis(Math.max(0, due - now)));
    return yield* Clock.currentTimeMillis;
  });

/** The time now, and again once `due` passes, unless it names no moment. */
const wakes = (due: number): Stream.Stream<number> =>
  due === NEVER_DUE
    ? Stream.fromEffect(Clock.currentTimeMillis)
    : Stream.concat(Stream.fromEffect(Clock.currentTimeMillis), Stream.fromEffect(wokenAt(due)));

/** One strip as the tidy reads and closes it. */
interface IdleStrip<T extends StripTab> {
  /** The open task's tabs, in the strip's order. */
  readonly tabs: readonly T[];
  /** The tab on screen, which is viewed now and never closes; none while the strip shows none. */
  readonly shown: T | undefined;
  /** When each tab was last viewed. */
  readonly viewedAt: readonly ViewedAt<T>[];
  /** Stamps `viewed` viewed at `at` on the task given, and each of `standing` not stamped yet. */
  readonly onViewedAt: (
    taskId: string,
    viewed: readonly T[],
    standing: readonly T[],
    at: number,
  ) => void;
  /** Closes the tab for being idle, onto the stack ⇧⌘T opens again. */
  readonly onIdle: (tab: T) => void;
  /** Whether the tab stays open however long it goes unviewed. */
  readonly keeps: (tab: T) => boolean;
}

/** What the tidy reads of the window. */
export interface IdleTabsInput<Column extends StripTab, Panel extends StripTab> {
  /** The open task whose strips are tidied; none while no task is open or the tidy stands down, as a fixture run's does. */
  readonly taskId: string | undefined;
  /** The task's column, none while its agents are unread, which leaves what its tabs are unknown. */
  readonly column: IdleStrip<Column> | undefined;
  /** The side panel, none while it stands beside something other than the task's page. */
  readonly panel: IdleStrip<Panel> | undefined;
  /** The agents awake now: working, or with an Inbox item waiting on the developer. */
  readonly awake: readonly string[];
  /** Opens again the tabs of the agents given that closed for being idle. */
  readonly onWake: (agents: readonly string[]) => void;
}

/**
 * The time the tidy woke at, moved once `due` passes; none until the
 * clock's first reading lands. Note that the wake is forked again as `due`
 * changes, so a new moment interrupts the sleep standing rather than
 * waiting it out.
 */
function useWokenAt(due: number): number | undefined {
  const woken = useCreateStore<number | undefined>(undefined);
  useEffect(() => forkEffect(streamInto(wakes(due), woken)), [due, woken]);
  return useSelector(woken);
}

/** Reads the time on the renderer's clock as it stands at the call, for a stamp, which is the moment it is made. */
function clockNow(): number {
  return Context.get(effectServices.state, Clock.Clock).currentTimeMillisUnsafe();
}

/** The next moment one of the strip's tabs falls due: the shown tab's hour since its stamp, or another's day unviewed where the strip does not keep it. */
function nextDueOf<T extends StripTab>(strip: IdleStrip<T> | undefined): number {
  if (strip === undefined) return NEVER_DUE;
  const { shown } = strip;
  const restamp = shown === undefined ? undefined : viewedAtOf(strip.viewedAt, shown);
  let due = restamp === undefined ? NEVER_DUE : restamp + Duration.toMillis(RESTAMP_EVERY);
  for (const tab of strip.tabs) {
    if (sameTab(tab, shown) || strip.keeps(tab)) continue;
    const at = viewedAtOf(strip.viewedAt, tab);
    if (at !== undefined) due = Math.min(due, at + Duration.toMillis(TAB_IDLE));
  }
  return due;
}

/** A tab a strip showed, with the strip's own stamp, which still writes to its task once the strip is gone or another task's. */
interface ShownTab<T extends StripTab> {
  readonly tab: T;
  readonly onViewedAt: IdleStrip<T>["onViewedAt"];
}

/** The tabs the strips showed on a task, as the stamps last saw them. */
interface Shown<Column extends StripTab, Panel extends StripTab> {
  readonly taskId: string;
  readonly column: ShownTab<Column> | undefined;
  readonly panel: ShownTab<Panel> | undefined;
}

/** The strip's shown tab with its stamp, none where it shows none. */
function shownOf<T extends StripTab>(strip: IdleStrip<T> | undefined): ShownTab<T> | undefined {
  return strip?.shown === undefined
    ? undefined
    : { tab: strip.shown, onViewedAt: strip.onViewedAt };
}

/**
 * Stamps the tab `was` showed on `wasOn` viewed at `now` where it is no
 * longer the one shown: the task left, the strip gone or covered, or
 * another tab shown in its place. It is stamped through the stamp it was
 * shown with, so a task left for one whose strip is not read yet still
 * hears when it was last on screen. Note that a tab gone from the open
 * task's strip is not, because a close lets its stamp go so the tab opened
 * again counts as viewed anew.
 */
function stampLeft<T extends StripTab>(
  strip: IdleStrip<T> | undefined,
  wasOn: string,
  was: ShownTab<T> | undefined,
  taskId: string | undefined,
  now: number,
): void {
  if (was === undefined) return;
  const here = wasOn === taskId && strip !== undefined;
  if (here && sameTab(was.tab, strip.shown)) return;
  if (here && !strip.tabs.some((tab) => sameTab(tab, was.tab))) return;
  was.onViewedAt(wasOn, [was.tab], here ? strip.tabs : [], now);
}

/** Stamps the strip's tabs on the task not stamped yet viewed at `now`, and its shown tab where its stamp is an hour old. */
function stampStanding<T extends StripTab>(
  strip: IdleStrip<T> | undefined,
  taskId: string,
  now: number,
): void {
  if (strip === undefined) return;
  const { shown } = strip;
  const at = shown === undefined ? undefined : viewedAtOf(strip.viewedAt, shown);
  const stale = at === undefined || now - at >= Duration.toMillis(RESTAMP_EVERY);
  strip.onViewedAt(taskId, shown !== undefined && stale ? [shown] : [], strip.tabs, now);
}

/** Closes each of the strip's tabs idle at `now`, the shown one and those it keeps aside. */
function tidy<T extends StripTab>(strip: IdleStrip<T> | undefined, now: number): void {
  if (strip === undefined) return;
  const { shown } = strip;
  const keeps = (tab: T) => sameTab(tab, shown) || strip.keeps(tab);
  const idle = idleTabs(strip.tabs, strip.viewedAt, now, Duration.toMillis(TAB_IDLE), keeps);
  for (const tab of idle) strip.onIdle(tab);
}

/** Stamps the open task's tabs as they are viewed, closes those idle for a day, and opens again the tabs of agents that wake. */
export function useIdleTabs<Column extends StripTab, Panel extends StripTab>(
  input: IdleTabsInput<Column, Panel>,
): void {
  const woken = useWokenAt(Math.min(nextDueOf(input.column), nextDueOf(input.panel)));
  // Note that the effects read the strips through a ref, because their
  // callbacks are new each render and only the moments below should run them.
  const latest = useRef(input);
  latest.current = input;
  const { taskId, column, panel, awake, onWake } = input;
  const columnShown = column?.shown;
  const panelShown = panel?.shown;
  const columnTabs = column?.tabs;
  const panelTabs = panel?.tabs;
  const shownBefore = useRef<Shown<Column, Panel> | undefined>(undefined);
  // Note that a stamp reads the clock as it is made, because the last wake may stand an hour behind it.
  useEffect(() => {
    if (woken === undefined) return;
    const now = clockNow();
    const { column: strip, panel: side } = latest.current;
    const was = shownBefore.current;
    shownBefore.current =
      taskId === undefined ? undefined : { taskId, column: shownOf(strip), panel: shownOf(side) };
    if (was !== undefined) {
      stampLeft(strip, was.taskId, was.column, taskId, now);
      stampLeft(side, was.taskId, was.panel, taskId, now);
    }
    if (taskId === undefined) return;
    stampStanding(strip, taskId, now);
    stampStanding(side, taskId, now);
  }, [woken, taskId, columnShown, panelShown, columnTabs, panelTabs]);
  const columnRead = column !== undefined;
  const panelRead = panel !== undefined;
  useEffect(() => {
    if (woken === undefined || taskId === undefined) return;
    const now = clockNow();
    tidy(columnRead ? latest.current.column : undefined, now);
    tidy(panelRead ? latest.current.panel : undefined, now);
  }, [woken, taskId, columnRead, panelRead]);
  useEffect(() => {
    if (awake.length > 0) onWake(awake);
  }, [awake, onWake]);
}
