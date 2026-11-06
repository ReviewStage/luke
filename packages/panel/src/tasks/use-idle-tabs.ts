import { useAtomValue } from "@effect/atom-react";
import {
  idleTabs,
  type StripTab,
  sameTab,
  type ViewedAt,
  viewedAtOf,
} from "@repo/ui/tab-strip-model";
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef } from "react";
import { rendererRuntime } from "../renderer-runtime.js";

const TAB_IDLE = Duration.hours(24);

const TIDY_EVERY = Duration.minutes(1);

const RESTAMP_EVERY = Duration.hours(1);

const tidyTicks: Stream.Stream<number> = Stream.fromEffectSchedule(
  Clock.currentTimeMillis,
  Schedule.spaced(TIDY_EVERY),
);

const tidyNowAtom = rendererRuntime.atom(tidyTicks);

interface IdleStrip<T extends StripTab> {
  readonly tabs: readonly T[];
  readonly shown: T | undefined;
  readonly viewedAt: readonly ViewedAt<T>[];
  readonly onViewedAt: (
    taskId: string,
    viewed: readonly T[],
    standing: readonly T[],
    at: number,
  ) => void;
  readonly onIdle: (tab: T) => void;
  readonly keeps: (tab: T) => boolean;
}

export interface IdleTabsInput<Column extends StripTab, Panel extends StripTab> {
  readonly taskId: string | undefined;
  readonly column: IdleStrip<Column> | undefined;
  readonly panel: IdleStrip<Panel> | undefined;
  readonly awake: readonly string[];
  readonly onWake: (agents: readonly string[]) => void;
}

function useTidyNow(): number | undefined {
  return Option.getOrUndefined(AsyncResult.value(useAtomValue(tidyNowAtom)));
}

interface ShownTab<T extends StripTab> {
  readonly tab: T;
  readonly onViewedAt: IdleStrip<T>["onViewedAt"];
}

interface Shown<Column extends StripTab, Panel extends StripTab> {
  readonly taskId: string;
  readonly column: ShownTab<Column> | undefined;
  readonly panel: ShownTab<Panel> | undefined;
}

function shownOf<T extends StripTab>(strip: IdleStrip<T> | undefined): ShownTab<T> | undefined {
  return strip?.shown === undefined
    ? undefined
    : { tab: strip.shown, onViewedAt: strip.onViewedAt };
}

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

function tidy<T extends StripTab>(strip: IdleStrip<T> | undefined, now: number): void {
  if (strip === undefined) return;
  const { shown } = strip;
  const keeps = (tab: T) => sameTab(tab, shown) || strip.keeps(tab);
  const idle = idleTabs(strip.tabs, strip.viewedAt, now, Duration.toMillis(TAB_IDLE), keeps);
  for (const tab of idle) strip.onIdle(tab);
}

export function useIdleTabs<Column extends StripTab, Panel extends StripTab>(
  input: IdleTabsInput<Column, Panel>,
): void {
  const now = useTidyNow();
  const latest = useRef(input);
  latest.current = input;
  const { taskId, column, panel, awake, onWake } = input;
  const columnShown = column?.shown;
  const panelShown = panel?.shown;
  const columnTabs = column?.tabs;
  const panelTabs = panel?.tabs;
  const shownBefore = useRef<Shown<Column, Panel> | undefined>(undefined);
  useEffect(() => {
    if (now === undefined) return;
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
  }, [now, taskId, columnShown, panelShown, columnTabs, panelTabs]);
  const columnRead = column !== undefined;
  const panelRead = panel !== undefined;
  useEffect(() => {
    if (now === undefined || taskId === undefined) return;
    tidy(columnRead ? latest.current.column : undefined, now);
    tidy(panelRead ? latest.current.panel : undefined, now);
  }, [now, taskId, columnRead, panelRead]);
  useEffect(() => {
    if (awake.length > 0) onWake(awake);
  }, [awake, onWake]);
}
