import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { linkOf, type ReadLink } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { EXPERIMENT, experimentOn } from "@repo/settings";
import {
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isDraftTab,
  isFileTab,
  isLocalTab,
  isPageTab,
  isSubagentTab,
  isTerminalTab,
  isTranscriptTab,
  type StripTab,
  sameTab,
  tabKey,
} from "@repo/ui/tab-strip-model";
import { TASKS_PAGE } from "@repo/ui/tasks-model";
import { type HistoryLocation, type RouterHistory, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AutomationsRoute } from "./automations-route.js";
import { liveStepTitle, NAMED_STEP, type NamedStep } from "./history-titles.js";
import {
  ROUTED_PLACE,
  type RoutedPlace,
  routedPlaceOf,
  routedStands,
  useRouteAccess,
} from "./route-gates.js";
import { useRoutedLocation } from "./routed-location.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { useSteadyDoorSet, useSteadyDoors } from "./steady-door.js";
import type { HistorySpot } from "./tasks/use-description-history.js";
import { standInboxTask, useInboxTask } from "./tasks/use-inbox-task.js";
import { MAIN_TAB, type MainTab } from "./tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import type { InboxChoice, LeaveGuard, TasksControl } from "./tasks/use-tasks-tab.js";
import { useExperimentChoices } from "./use-app-state.js";
import { useHostRead } from "./use-host-read.js";
import { type OpenSurface, useSurfaceOpen } from "./use-surface-open.js";

export const MOUSE_BUTTON = {
  BACK: 3,
  FORWARD: 4,
} as const;

const OVER_THE_PLAN: ReadonlySet<RoutedPlace | undefined> = new Set([
  ROUTED_PLACE.BOARD,
  ROUTED_PLACE.PERSON,
  ROUTED_PLACE.AUTOMATIONS,
]);

const PLACE_KIND = {
  TASK: "plan",
  VERSION_HISTORY: "version-history",
  HOME: "home",
  INBOX: "inbox",
  AGENT: "agent",
  ROUTED: "routed",
} as const;

type SideStep = SidePanelTab | null | undefined;

interface PanelStep {
  readonly open: boolean;
  readonly tab: SidePanelTab | undefined;
}

type Place =
  | {
      readonly kind: typeof PLACE_KIND.TASK;
      readonly taskId: string;
      readonly panel?: PanelStep | undefined;
      readonly column?: MainTab | undefined;
      readonly side?: SideStep;
    }
  | {
      readonly kind: typeof PLACE_KIND.VERSION_HISTORY;
      readonly taskId: string;
      readonly spot: HistorySpot | undefined;
      readonly listed?: boolean | undefined;
    }
  | { readonly kind: typeof PLACE_KIND.HOME }
  | {
      readonly kind: typeof PLACE_KIND.INBOX;
      readonly listed?: boolean | undefined;
      readonly chosen?: InboxChoice | undefined;
      readonly taskId?: string | undefined;
      readonly side?: SideStep;
    }
  | {
      readonly kind: typeof PLACE_KIND.AGENT;
      readonly agentId: string;
      readonly side?: SideStep;
    }
  | {
      readonly kind: typeof PLACE_KIND.ROUTED;
      readonly address: string;
    };

export interface RoutedStanding {
  readonly place: RoutedPlace;
  readonly address: string;
  readonly params: Readonly<Record<string, string | undefined>>;
}

export function useRoutedStanding(): RoutedStanding | undefined {
  const { place, href, params } = useRoutedLocation();
  return useMemo(
    () => (place === undefined ? undefined : { place, address: href, params }),
    [place, href, params],
  );
}

export interface StepTitle {
  readonly label: string;
  readonly detail?: string | undefined;
  readonly panes?: StepPanes | undefined;
}

export interface StepPanes {
  readonly column?: string | undefined;
  readonly side?: string | undefined;
}

type Titled = Place & { readonly title?: StepTitle | undefined };

interface TrailEntry {
  readonly address: string;
  readonly state: Place;
}

interface Trail {
  readonly entries: readonly TrailEntry[];
  readonly at: number;
}

const TRAIL_LIMIT = 50;

const EMPTY_TRAIL: Trail = { entries: [], at: -1 };

const TRAIL_WRITE = {
  PUSH: "push",
  REPLACE: "replace",
} as const;

type TrailWriteKind = (typeof TRAIL_WRITE)[keyof typeof TRAIL_WRITE];

interface TrailWrite {
  readonly kind: TrailWriteKind;
  readonly entry: TrailEntry;
}

interface SavedStep {
  readonly place: Place;
  readonly index: number;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    readonly step?: SavedStep;
  }
}

const isSavedStep = Schema.is(
  Schema.Struct({ index: Schema.Int, place: Schema.Struct({ kind: Schema.String }) }),
);

function titleOf(place: Place | undefined): StepTitle | undefined {
  return place === undefined ? undefined : (place as Titled).title;
}

function namedStepOf(place: Place): NamedStep | undefined {
  switch (place.kind) {
    case PLACE_KIND.TASK: {
      const panelTab = place.panel?.open === true ? place.panel.tab : undefined;
      const side = place.side ?? panelTab;
      return { kind: NAMED_STEP.TASK, taskId: place.taskId, column: place.column, side };
    }
    case PLACE_KIND.VERSION_HISTORY:
      return { kind: NAMED_STEP.VERSION_HISTORY, taskId: place.taskId };
    case PLACE_KIND.INBOX: {
      const { chosen } = place;
      const taskId = chosen !== undefined && "taskId" in chosen ? chosen.taskId : place.taskId;
      return { kind: NAMED_STEP.INBOX, taskId };
    }
    default:
      return undefined;
  }
}

function sameTitle(one: Place, other: Place): boolean {
  const mine = titleOf(one);
  const theirs = titleOf(other);
  return mine?.label === theirs?.label && mine?.detail === theirs?.detail;
}

function subStepOf(place: Place): boolean | undefined {
  switch (place.kind) {
    case PLACE_KIND.TASK:
      return place.panel?.open;
    case PLACE_KIND.VERSION_HISTORY:
    case PLACE_KIND.INBOX:
      return place.listed;
    default:
      return undefined;
  }
}

function sameSubStep(one: Place, other: Place): boolean {
  const mine = subStepOf(one);
  const theirs = subStepOf(other);
  return mine === undefined || theirs === undefined || mine === theirs;
}

function choiceHolder(choice: InboxChoice): string | undefined {
  if ("taskId" in choice) return choice.taskId;
  return "agentId" in choice ? choice.agentId : undefined;
}

function sameInboxChoice(one: InboxChoice | undefined, other: InboxChoice | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  return one.itemId === other.itemId && choiceHolder(one) === choiceHolder(other);
}

function samePanelTab(one: PanelStep | undefined, other: PanelStep | undefined): boolean {
  if (one?.tab === undefined || other?.tab === undefined) return one?.tab === other?.tab;
  return sameTab(one.tab, other.tab);
}

function samePage(one: Place, other: Place): boolean {
  if (one.kind !== other.kind) return false;
  if (one.kind === PLACE_KIND.ROUTED && other.kind === PLACE_KIND.ROUTED) {
    return one.address === other.address;
  }
  if ("taskId" in one && "taskId" in other) return one.taskId === other.taskId;
  if ("agentId" in one && "agentId" in other) return one.agentId === other.agentId;
  return true;
}

function openPanelTab(panel: PanelStep | undefined): SidePanelTab | undefined {
  return panel?.open === true ? panel.tab : undefined;
}

function sameTabOrNone(one: StripTab | undefined, other: StripTab | undefined): boolean {
  return one === undefined || other === undefined ? one === other : sameTab(one, other);
}

function sameOrUnknownTab(one: StripTab | undefined, other: StripTab | undefined): boolean {
  return one === undefined || other === undefined || sameTab(one, other);
}

function sameSide(one: SideStep, other: SideStep): boolean {
  return one == null || other == null ? one === other : sameTab(one, other);
}

function sideOf(place: Place): SideStep {
  if (place.kind === PLACE_KIND.TASK) {
    return place.panel === undefined ? place.side : openPanelTab(place.panel);
  }
  return place.kind === PLACE_KIND.INBOX || place.kind === PLACE_KIND.AGENT
    ? place.side
    : undefined;
}

function sameShownSide(one: Place, other: Place): boolean {
  const mine = sideOf(one);
  const theirs = sideOf(other);
  return mine === undefined || theirs === undefined || sameSide(mine, theirs);
}

function sameShown(one: Place, other: Place): boolean {
  return sameChosen(one, other) && sameShownSide(one, other);
}

function sameChosen(one: Place, other: Place): boolean {
  if (one.kind === PLACE_KIND.TASK && other.kind === PLACE_KIND.TASK) {
    return sameOrUnknownTab(one.column, other.column);
  }
  if (one.kind === PLACE_KIND.INBOX && other.kind === PLACE_KIND.INBOX) {
    if (one.taskId !== other.taskId) return false;
    return one.chosen === undefined || other.chosen === undefined
      ? true
      : sameInboxChoice(one.chosen, other.chosen);
  }
  return true;
}

function sameStep(one: Place | undefined, other: Place): boolean {
  return (
    one !== undefined && samePage(one, other) && sameSubStep(one, other) && sameShown(one, other)
  );
}

function choosesWithin(one: Place | undefined, other: Place): boolean {
  return (
    one !== undefined && samePage(one, other) && sameSubStep(one, other) && !sameShown(one, other)
  );
}

function ledWithin(one: Place, other: Place, pressed: boolean, opened: boolean): boolean {
  return (pressed && !sameChosen(one, other)) || (opened && !sameShownSide(one, other));
}

function tabSurface(taskId: string, tab: StripTab, side: boolean): OpenSurface {
  if (isAgentTab(tab) || isDraftTab(tab) || isTranscriptTab(tab)) {
    return { surface: PRODUCT_SURFACE.AGENT, of: tabKey(tab), side };
  }
  const of = tabKey(tab);
  if (isSubagentTab(tab)) return { surface: PRODUCT_SURFACE.SUBAGENT, of, side };
  if (isFileTab(tab)) return { surface: PRODUCT_SURFACE.FILES, of, side };
  if (isChangesTab(tab)) return { surface: PRODUCT_SURFACE.PULL_REQUEST, of, side };
  if (isTerminalTab(tab) || isLocalTab(tab)) return { surface: PRODUCT_SURFACE.TERMINAL, of, side };
  if (isCloudBrowserTab(tab)) return { surface: PRODUCT_SURFACE.BROWSER, of, side };
  if (isPageTab(tab)) return { surface: PRODUCT_SURFACE.PAGE, of, side };
  if (tab === SIDE_PANEL_TAB.INBOX) return { surface: PRODUCT_SURFACE.INBOX, of: taskId, side };
  if (tab === SIDE_PANEL_TAB.COMMENTS) {
    return { surface: PRODUCT_SURFACE.COMMENTS, of: taskId, side };
  }
  return { surface: PRODUCT_SURFACE.TASK, of: taskId, side };
}

function surfacesOf(
  place: Place | undefined,
  columnKnown: boolean,
  beside: OpenSurface | undefined,
): OpenSurface[] {
  if (place === undefined) return [];
  const withSide = (surfaces: OpenSurface[]) =>
    beside === undefined ? surfaces : [...surfaces, beside];
  switch (place.kind) {
    case PLACE_KIND.TASK: {
      const side = place.side ?? openPanelTab(place.panel);
      const sideSurface = side === undefined ? [] : [tabSurface(place.taskId, side, true)];
      if (place.panel?.open === true) return sideSurface;
      const column = columnKnown
        ? [tabSurface(place.taskId, place.column ?? MAIN_TAB.OVERVIEW, false)]
        : [];
      return [...column, ...sideSurface];
    }
    case PLACE_KIND.VERSION_HISTORY:
      return [{ surface: PRODUCT_SURFACE.VERSION_HISTORY, of: place.taskId }];
    case PLACE_KIND.INBOX:
      return withSide([{ surface: PRODUCT_SURFACE.INBOX }]);
    case PLACE_KIND.AGENT:
      return withSide([{ surface: PRODUCT_SURFACE.AGENT, of: place.agentId }]);
    case PLACE_KIND.HOME:
      return [{ surface: PRODUCT_SURFACE.HOME }];
    case PLACE_KIND.ROUTED:
      return [];
  }
}

function sameSpot(one: HistorySpot | undefined, other: HistorySpot | undefined): boolean {
  return (
    one?.revision === other?.revision &&
    one?.opened?.seq === other?.opened?.seq &&
    one?.opened?.heading === other?.opened?.heading
  );
}

function samePlace(one: Place, other: Place): boolean {
  if (subStepOf(one) !== subStepOf(other)) return false;
  if (one.kind === PLACE_KIND.TASK && other.kind === PLACE_KIND.TASK) {
    return (
      samePanelTab(one.panel, other.panel) &&
      sameTabOrNone(one.column, other.column) &&
      sameSide(one.side, other.side)
    );
  }
  if (one.kind === PLACE_KIND.INBOX && other.kind === PLACE_KIND.INBOX) {
    return (
      one.taskId === other.taskId &&
      sameInboxChoice(one.chosen, other.chosen) &&
      sameSide(one.side, other.side)
    );
  }
  if (one.kind === PLACE_KIND.AGENT && other.kind === PLACE_KIND.AGENT) {
    return sameSide(one.side, other.side);
  }
  if (one.kind === PLACE_KIND.VERSION_HISTORY && other.kind === PLACE_KIND.VERSION_HISTORY) {
    return sameSpot(one.spot, other.spot);
  }
  return true;
}

function routedPlace(address: string): Place {
  return { kind: PLACE_KIND.ROUTED, address };
}

function pathOf(address: string): string {
  return new URL(address, "https://panel.invalid").pathname;
}

const AUTOMATION_STEP = "automation";

function sameDraft(one: Place, other: Place): boolean {
  if (samePage(one, other)) return true;
  if (one.kind !== PLACE_KIND.ROUTED || other.kind !== PLACE_KIND.ROUTED) return false;
  const mine = pathOf(one.address).split("/");
  const theirs = pathOf(other.address).split("/");
  return (
    mine[2] === AUTOMATION_STEP &&
    mine[3] !== undefined &&
    mine.slice(0, 4).every((step, at) => step === theirs[at])
  );
}

function routedSurfaces(routed: RoutedStanding): readonly OpenSurface[] {
  switch (routed.place) {
    case ROUTED_PLACE.ADMIN:
      return [{ surface: PRODUCT_SURFACE.ADMIN }];
    case ROUTED_PLACE.SETTINGS:
      return [{ surface: PRODUCT_SURFACE.SETTINGS }];
    case ROUTED_PLACE.BOARD:
      return [{ surface: PRODUCT_SURFACE.BOARD }];
    case ROUTED_PLACE.PERSON:
      return [{ surface: PRODUCT_SURFACE.PERSON, of: routed.params.userId }];
    case ROUTED_PLACE.AUTOMATIONS:
      return [{ surface: PRODUCT_SURFACE.AUTOMATIONS }];
  }
}

const NO_LINK_ADDRESS = "/app";

function addressOf(link: ReadLink | undefined): string {
  if (link === undefined) return NO_LINK_ADDRESS;
  const url = new URL(linkOf(link.place, link.workspace));
  return `${url.pathname}${url.search}${url.hash}`;
}

function visitWrite(
  trail: Trail,
  place: Place,
  address: string,
  up: Place | undefined,
  pressed: boolean,
  opened: boolean,
): TrailWrite | undefined {
  const standing = trail.entries[trail.at];
  const entry: TrailEntry = { address, state: place };
  const wentUp = up !== undefined && sameStep(up, place);
  const routedHere =
    standing?.state.kind === PLACE_KIND.ROUTED &&
    place.kind !== PLACE_KIND.ROUTED &&
    standing.address === address;
  const settling =
    standing !== undefined &&
    choosesWithin(standing.state, place) &&
    !ledWithin(standing.state, place, pressed, opened);
  if (standing !== undefined && (wentUp || settling || routedHere)) {
    return { kind: TRAIL_WRITE.REPLACE, entry };
  }
  if (standing !== undefined && sameStep(standing.state, place)) {
    const moved =
      !samePlace(standing.state, place) ||
      !sameTitle(standing.state, place) ||
      standing.address !== address;
    return moved ? { kind: TRAIL_WRITE.REPLACE, entry } : undefined;
  }
  return { kind: TRAIL_WRITE.PUSH, entry };
}

function written(trail: Trail, write: TrailWrite): Trail {
  if (trail.at < 0) return { entries: [write.entry], at: 0 };
  if (write.kind === TRAIL_WRITE.REPLACE) {
    return { entries: trail.entries.with(trail.at, write.entry), at: trail.at };
  }
  const entries = [...trail.entries.slice(0, trail.at + 1), write.entry].slice(-TRAIL_LIMIT);
  return { entries, at: entries.length - 1 };
}

function afterVisit(
  trail: Trail,
  place: Place,
  address: string,
  up: Place | undefined,
  pressed: boolean,
  opened: boolean,
): Trail {
  const write = visitWrite(trail, place, address, up, pressed, opened);
  return write === undefined ? trail : written(trail, write);
}

function nearest(
  trail: Trail,
  step: -1 | 1,
  reachable: (place: Place) => boolean,
): number | undefined {
  const standing = trail.entries[trail.at]?.state;
  for (let at = trail.at + step; at >= 0 && at < trail.entries.length; at += step) {
    const place = trail.entries[at]?.state;
    if (place !== undefined && reachable(place) && !sameStep(standing, place)) return at;
  }
  return undefined;
}

function awayFrom(trail: Trail, reachable: (place: Place) => boolean): number | undefined {
  const standing = trail.entries[trail.at]?.state;
  for (let at = trail.at - 1; at >= 0; at -= 1) {
    const place = trail.entries[at]?.state;
    if (place === undefined || !reachable(place)) continue;
    if (standing === undefined || !samePage(standing, place)) return at;
  }
  return undefined;
}

function asking(
  latest: { readonly place: Place | undefined; readonly guard: LeaveGuard["guard"] },
  to: Place | undefined,
): LeaveGuard["guard"] {
  const { place } = latest;
  return place !== undefined && to !== undefined && sameDraft(place, to)
    ? (leave) => leave
    : latest.guard;
}

export interface HistoryPage {
  readonly kind: Place["kind"];
  readonly of: string | undefined;
}

export interface HistoryStep {
  readonly at: number;
  readonly title: StepTitle | undefined;
  readonly page: HistoryPage;
}

export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  steps: { readonly back: readonly HistoryStep[]; readonly forward: readonly HistoryStep[] };
  onGoTo: (at: number) => void;
}

const LISTED_STEPS = 15;

function pageOf(place: Place): HistoryPage {
  switch (place.kind) {
    case PLACE_KIND.TASK:
    case PLACE_KIND.VERSION_HISTORY:
      return { kind: place.kind, of: place.taskId };
    case PLACE_KIND.AGENT:
      return { kind: place.kind, of: place.agentId };
    case PLACE_KIND.ROUTED:
      return { kind: place.kind, of: place.address };
    default:
      return { kind: place.kind, of: undefined };
  }
}

export function sameHistoryPage(one: HistoryPage, other: HistoryPage): boolean {
  return one.kind === other.kind && one.of === other.of;
}

function listedSteps(
  trail: Trail,
  way: -1 | 1,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): HistoryStep[] {
  const listed: HistoryStep[] = [];
  let from = trail.at;
  while (listed.length < LISTED_STEPS) {
    const at = nearest({ entries: trail.entries, at: from }, way, reachable);
    const place = at === undefined ? undefined : trail.entries[at]?.state;
    if (at === undefined || place === undefined) break;
    listed.push({ at, title: named(place), page: pageOf(place) });
    from = at;
  }
  return listed;
}

export interface ListBacks {
  readonly settings: () => void;
  readonly versions: () => void;
  readonly runs: () => void;
  readonly inbox: () => void;
  readonly panel: () => void;
  readonly task: () => void;
}

export interface AwayStep {
  readonly title: StepTitle | undefined;
}

interface HistoryReading {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly steps: NavigationHistory["steps"];
  readonly away: AwayStep | undefined;
}

function readingOf(
  trail: Trail,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): HistoryReading {
  return {
    canGoBack: nearest(trail, -1, reachable) !== undefined,
    canGoForward: nearest(trail, 1, reachable) !== undefined,
    steps: {
      back: listedSteps(trail, -1, reachable, named),
      forward: listedSteps(trail, 1, reachable, named),
    },
    away: awayStep(trail, reachable, named),
  };
}

function sameStepTitle(one: StepTitle | undefined, other: StepTitle | undefined): boolean {
  return (
    one?.label === other?.label &&
    one?.detail === other?.detail &&
    one?.panes?.column === other?.panes?.column &&
    one?.panes?.side === other?.panes?.side
  );
}

function sameSteps(one: readonly HistoryStep[], other: readonly HistoryStep[]): boolean {
  return (
    one.length === other.length &&
    one.every((step, index) => {
      const theirs = other[index];
      return (
        theirs !== undefined &&
        step.at === theirs.at &&
        sameHistoryPage(step.page, theirs.page) &&
        sameStepTitle(step.title, theirs.title)
      );
    })
  );
}

function sameReading(one: HistoryReading, other: HistoryReading): boolean {
  return (
    one.canGoBack === other.canGoBack &&
    one.canGoForward === other.canGoForward &&
    sameSteps(one.steps.back, other.steps.back) &&
    sameSteps(one.steps.forward, other.steps.forward) &&
    (one.away === undefined) === (other.away === undefined) &&
    sameStepTitle(one.away?.title, other.away?.title)
  );
}

export interface WindowHistory extends NavigationHistory {
  onLeaveRouted: () => void;
  onLeaveVersionHistory: () => void;
  away: AwayStep | undefined;
  onLeave: () => void;
}

export interface WindowHistoryLists extends WindowHistory {
  readonly lists: ListBacks;
}

export function throughHistory(tasks: TasksControl, lists: ListBacks): TasksControl {
  const { sidePanel } = tasks;
  const shutsWhole = sidePanel.fullScreenOnly;
  const onClose = (tab: SidePanelTab) => {
    const last = sidePanel.strip.length === 1 && sidePanel.strip.some((one) => sameTab(one, tab));
    sidePanel.onClose(tab);
    if (last) lists.panel();
  };
  return {
    ...tasks,
    sidePanel: shutsWhole
      ? { ...sidePanel, onToggle: lists.panel, onToggleFullScreen: lists.panel, onClose }
      : sidePanel,
    back: () => {
      if (tasks.page !== TASKS_PAGE.DOCUMENT || (!shutsWhole && sidePanel.fullScreen)) {
        return tasks.back();
      }
      if (shutsWhole) lists.panel();
      else lists.task();
      return true;
    },
    history: { ...tasks.history, onList: lists.versions },
    inboxView: { ...tasks.inboxView, onClear: lists.inbox },
    automationsView: {
      ...tasks.automationsView,
      onRuns: (shown) => (shown ? tasks.automationsView.onRuns(true) : lists.runs()),
    },
  };
}

interface WindowTrail {
  readonly history: RouterHistory;
  trail: Trail;
  base: number;
  highest: number;
  traveling: number | undefined;
  readonly waiting: (() => void)[];
  writing: boolean;
  routing: boolean;
  readonly listeners: Set<() => void>;
}

type HistoryMove = Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0]["action"];

const trails = new WeakMap<RouterHistory, WindowTrail>();

function savedStepOf(location: HistoryLocation): SavedStep | undefined {
  const { step } = location.state;
  return isSavedStep(step) ? step : undefined;
}

export function savesStep(location: HistoryLocation): boolean {
  return savedStepOf(location) !== undefined;
}

function standTrail(held: WindowTrail, next: Trail): void {
  if (next.entries === held.trail.entries && next.at === held.trail.at) return;
  held.trail = next;
  for (const listener of [...held.listeners]) listener();
}

function drainTrail(held: WindowTrail): void {
  while (held.traveling === undefined) {
    const next = held.waiting.shift();
    if (next === undefined) return;
    next();
  }
}

function inTurn(held: WindowTrail, step: () => void): void {
  held.waiting.push(step);
  drainTrail(held);
}

function writeThrough(
  held: WindowTrail,
  kind: TrailWriteKind,
  entry: TrailEntry,
  at: number,
): void {
  const step: SavedStep = { place: entry.state, index: held.base + at };
  held.highest = Math.max(held.highest, step.index);
  inTurn(held, () => {
    held.writing = true;
    try {
      if (kind === TRAIL_WRITE.PUSH) held.history.push(entry.address, { step });
      else held.history.replace(entry.address, { step });
    } finally {
      held.writing = false;
    }
  });
}

function keepTrail(held: WindowTrail, entries: readonly TrailEntry[], at: number): Trail {
  const dropped = Math.max(0, entries.length - TRAIL_LIMIT);
  held.base += dropped;
  return { entries: entries.slice(dropped), at: at - dropped };
}

function aloneOn(held: WindowTrail, location: HistoryLocation): Trail {
  const saved = savedStepOf(location);
  if (saved === undefined) {
    held.highest += 1;
    held.base = held.highest;
    return EMPTY_TRAIL;
  }
  held.highest = Math.max(held.highest, saved.index);
  held.base = saved.index;
  return { entries: [{ address: location.href, state: saved.place }], at: 0 };
}

function landedOn(held: WindowTrail, location: HistoryLocation): Trail {
  const saved = savedStepOf(location);
  if (saved === undefined) return aloneOn(held, location);
  held.highest = Math.max(held.highest, saved.index);
  const { entries } = held.trail;
  const at = saved.index - held.base;
  if (at >= 0 && at < entries.length) return { entries, at };
  const entry: TrailEntry = { address: location.href, state: saved.place };
  if (at === -1) {
    held.base -= 1;
    return { entries: [entry, ...entries].slice(0, TRAIL_LIMIT), at: 0 };
  }
  if (at === entries.length) return keepTrail(held, [...entries, entry], at);
  return aloneOn(held, location);
}

function followRouted(held: WindowTrail, kind: TrailWriteKind, location: HistoryLocation): void {
  const entry: TrailEntry = {
    address: location.href,
    state: { kind: PLACE_KIND.ROUTED, address: location.href },
  };
  const next = written(held.trail, { kind, entry });
  if (kind === TRAIL_WRITE.PUSH && held.trail.at >= 0) {
    held.base += held.trail.at + 2 - next.entries.length;
  }
  writeThrough(held, TRAIL_WRITE.REPLACE, entry, next.at);
  held.routing = true;
  try {
    standTrail(held, next);
  } finally {
    held.routing = false;
  }
}

function writeKindOf(action: HistoryMove): TrailWriteKind | undefined {
  if (action.type === "PUSH") return TRAIL_WRITE.PUSH;
  return action.type === "REPLACE" ? TRAIL_WRITE.REPLACE : undefined;
}

function hear(held: WindowTrail, location: HistoryLocation, action: HistoryMove): void {
  if (held.writing) return;
  const write = writeKindOf(action);
  if (write !== undefined && savedStepOf(location) === undefined) {
    followRouted(held, write, location);
    return;
  }
  if (write !== undefined || held.traveling === undefined) {
    standTrail(held, landedOn(held, location));
    return;
  }
  const arrived = savedStepOf(location)?.index === held.traveling;
  held.traveling = undefined;
  if (!arrived) {
    standTrail(
      held,
      held.waiting.length === 0 ? landedOn(held, location) : aloneOn(held, location),
    );
    held.waiting.length = 0;
  }
  drainTrail(held);
}

function trailOf(history: RouterHistory): WindowTrail {
  const kept = trails.get(history);
  if (kept !== undefined) return kept;
  const held: WindowTrail = {
    history,
    trail: EMPTY_TRAIL,
    base: 0,
    highest: 0,
    traveling: undefined,
    waiting: [],
    writing: false,
    routing: false,
    listeners: new Set(),
  };
  held.trail = aloneOn(held, history.location);
  history.subscribe(({ location, action }) => hear(held, location, action));
  trails.set(history, held);
  return held;
}

function listenTo(held: WindowTrail, listener: () => void): () => void {
  held.listeners.add(listener);
  return () => held.listeners.delete(listener);
}

function recordTrail(held: WindowTrail, write: TrailWrite): void {
  const pushed = write.kind === TRAIL_WRITE.PUSH && held.trail.at >= 0;
  const next = written(held.trail, write);
  if (pushed) held.base += held.trail.at + 2 - next.entries.length;
  writeThrough(held, pushed ? TRAIL_WRITE.PUSH : TRAIL_WRITE.REPLACE, write.entry, next.at);
  standTrail(held, next);
}

function goAlong(held: WindowTrail, delta: number): void {
  const at = held.trail.at + delta;
  if (delta === 0 || at < 0 || at >= held.trail.entries.length) return;
  const target = held.base + at;
  inTurn(held, () => {
    held.traveling = target;
    held.history.flush();
    held.history.go(delta);
  });
  standTrail(held, { entries: held.trail.entries, at });
}

function standingOf(trail: Trail): TrailEntry | undefined {
  return trail.entries[trail.at];
}

function useHistory(input: {
  held: WindowTrail;
  place: Place | undefined;
  address: string;
  reachable: (place: Place) => boolean;
  named: (place: Place) => StepTitle | undefined;
  go: (place: Place) => void;
  guard: LeaveGuard["guard"];
  opened: number;
}): NavigationHistory & {
  backTo: (place: Place) => boolean;
  upTo: (place: Place, stand: () => void) => void;
  inPlace: (place: Place, stand: () => void) => void;
  stepBack: () => boolean;
  away: AwayStep | undefined;
  stepAway: () => boolean;
} {
  const { held, place, address, reachable, named, guard, opened } = input;
  const latest = useRef({ place, reachable, go: input.go, guard, opened });
  useLayoutEffect(() => {
    latest.current = { place, reachable, go: input.go, guard, opened };
  });
  const wentUp = useRef<Place | undefined>(undefined);
  const presses = useRef(0);
  const pressesWritten = useRef(0);
  const openedWritten = useRef(opened);
  useEffect(() => {
    const heard = () => {
      presses.current += 1;
    };
    window.addEventListener("pointerdown", heard, true);
    window.addEventListener("keydown", heard, true);
    return () => {
      window.removeEventListener("pointerdown", heard, true);
      window.removeEventListener("keydown", heard, true);
    };
  }, []);
  const standing = useRef<TrailEntry | undefined>(undefined);
  const writing = useRef(false);
  const drawn = useRef<HistoryReading | undefined>(undefined);
  const visited = useRef<{ place: Place | undefined; address: string } | undefined>(undefined);
  const subscribe = useCallback((listener: () => void) => listenTo(held, listener), [held]);
  const reading = useSyncExternalStore(subscribe, () => {
    const trailNow = held.trail;
    const moved = visited.current?.place !== place || visited.current?.address !== address;
    const writes =
      place !== undefined &&
      moved &&
      (standing.current !== undefined || standingOf(trailNow) === undefined);
    const pressed = presses.current !== pressesWritten.current;
    const opens = opened !== openedWritten.current;
    const trail = writes
      ? afterVisit(trailNow, place, address, wentUp.current, pressed, opens)
      : trailNow;
    const next = readingOf(trail, reachable, named);
    if (drawn.current === undefined || !sameReading(drawn.current, next)) drawn.current = next;
    return drawn.current;
  });

  const own = useCallback(
    (write: () => void) => {
      writing.current = true;
      try {
        write();
      } finally {
        writing.current = false;
      }
      pressesWritten.current = presses.current;
      openedWritten.current = latest.current.opened;
      standing.current = standingOf(held.trail);
    },
    [held],
  );

  useEffect(() => {
    visited.current = { place, address };
    const up = wentUp.current;
    wentUp.current = undefined;
    if (place === undefined) return;
    const loaded = standingOf(held.trail);
    if (standing.current === undefined && loaded !== undefined) {
      standing.current = loaded;
      if (latest.current.reachable(loaded.state)) latest.current.go(loaded.state);
      return;
    }
    const pressed = presses.current !== pressesWritten.current;
    const opens = latest.current.opened !== openedWritten.current;
    const write = visitWrite(held.trail, place, address, up, pressed, opens);
    if (write !== undefined) own(() => recordTrail(held, write));
  }, [held, place, address, own]);

  useEffect(() => {
    const arriveNowhere = (was: TrailEntry) => {
      const home: Place = { kind: PLACE_KIND.HOME };
      if (sameStep(was.state, home)) {
        own(() => recordTrail(held, { kind: TRAIL_WRITE.PUSH, entry: was }));
      } else latest.current.go(home);
    };
    const follow = (moved: Trail, was: TrailEntry) => {
      const from = moved.entries.indexOf(was);
      const arrived = standingOf(moved);
      const way = from >= 0 && moved.at > from ? 1 : -1;
      const { reachable: canReach } = latest.current;
      const at =
        arrived === undefined || canReach(arrived.state) ? moved.at : nearest(moved, way, canReach);
      const target = at === undefined ? undefined : moved.entries[at];
      const back = () =>
        own(() =>
          from >= 0
            ? goAlong(held, from - held.trail.at)
            : recordTrail(held, { kind: TRAIL_WRITE.PUSH, entry: was }),
        );
      if (arrived !== undefined && target === undefined) {
        back();
        return;
      }
      let followed = false;
      asking(
        latest.current,
        target?.state,
      )(() => {
        followed = true;
        if (target === undefined) {
          arriveNowhere(was);
          return;
        }
        const now = held.trail;
        const to = now.entries.indexOf(target);
        if (to >= 0 && to !== now.at) own(() => goAlong(held, to - now.at));
        else standing.current = target;
        latest.current.go(target.state);
      })();
      if (!followed) back();
    };
    return listenTo(held, () => {
      const moved = held.trail;
      if (held.routing) {
        standing.current = standingOf(moved);
        return;
      }
      const was = standing.current;
      if (writing.current || was === undefined || standingOf(moved) === was) return;
      follow(moved, was);
    });
  }, [held, own]);

  const goTo = useCallback(
    (at: number | undefined): boolean => {
      const target = at === undefined ? undefined : held.trail.entries[at]?.state;
      if (at === undefined || target === undefined || !latest.current.reachable(target)) {
        return false;
      }
      asking(
        latest.current,
        target,
      )(() => {
        own(() => goAlong(held, at - held.trail.at));
        latest.current.go(target);
      })();
      return true;
    },
    [held, own],
  );
  const step = useCallback(
    (by: -1 | 1): boolean => goTo(nearest(held.trail, by, latest.current.reachable)),
    [held, goTo],
  );

  const backTo = (to: Place): boolean => {
    const trail = held.trail;
    const at = nearest(trail, -1, latest.current.reachable);
    if (at === undefined || !sameStep(trail.entries[at]?.state, to)) return false;
    step(-1);
    return true;
  };

  const upTo = (to: Place, stand: () => void) => {
    const here = latest.current.place;
    if (here === undefined || !samePage(here, to) || sameSubStep(here, to)) {
      stand();
      return;
    }
    if (backTo(to)) return;
    wentUp.current = to;
    stand();
  };

  const inPlace = (to: Place, stand: () => void) => {
    wentUp.current = to;
    stand();
  };

  return {
    canGoBack: reading.canGoBack,
    canGoForward: reading.canGoForward,
    onBack: useCallback(() => step(-1), [step]),
    onForward: useCallback(() => step(1), [step]),
    steps: reading.steps,
    onGoTo: goTo,
    backTo,
    upTo,
    inPlace,
    stepBack: () => step(-1),
    away: reading.away,
    stepAway: () => goTo(awayFrom(held.trail, latest.current.reachable)),
  };
}

function awayStep(
  trail: Trail,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): AwayStep | undefined {
  const at = awayFrom(trail, reachable);
  const place = at === undefined ? undefined : trail.entries[at]?.state;
  return place === undefined ? undefined : { title: named(place) };
}

export function useWindowHistory(input: {
  known: boolean;
  link: ReadLink | undefined;
  title?: StepTitle | undefined;
  routed: RoutedStanding | undefined;
  settingsList: string | undefined;
  onSettingsList: () => void;
  automations: Pick<AutomationsRoute, "deleted" | "setupAddress">;
  room: ShellRoom;
  tasks: Pick<
    TasksControl,
    | "boundFor"
    | "tasks"
    | "listFailed"
    | "onRestoreTask"
    | "onLeaveTask"
    | "onGoHome"
    | "history"
    | "signedIn"
    | "inboxView"
    | "onShowInbox"
    | "agentView"
    | "personView"
    | "workspace"
    | "automationsView"
    | "boardView"
    | "unknownWorkspace"
    | "leaveGuard"
    | "sidePanel"
    | "mainTabs"
    | "activeTaskId"
    | "agents"
    | "pages"
    | "workspaces"
  >;
}): WindowHistoryLists {
  const { routed, tasks } = input;
  const narrow = input.room === SHELL_ROOM.NARROW;
  const { boundFor } = tasks;
  const historyOpen = tasks.history.open;
  const { spot } = tasks.history;
  const inboxOpen = tasks.inboxView.open;
  const inboxSingle = narrow || tasks.inboxView.single === true;
  const inboxChosen = tasks.inboxView.chosen;
  const inboxListed = inboxSingle ? inboxChosen === undefined : undefined;
  const narrowedTask = useInboxTask();
  const inboxTask = inboxOpen ? narrowedTask : undefined;
  const historyListed = narrow ? tasks.history.listed : undefined;
  const panelOpen = tasks.sidePanel.open;
  const panelTab = panelOpen ? tasks.sidePanel.tab : undefined;
  const stripsKnown = boundFor !== undefined && tasks.activeTaskId === boundFor;
  const columnKnown = stripsKnown && tasks.mainTabs.openAgents !== undefined;
  const columnTab = columnKnown ? tasks.mainTabs.tab : undefined;
  const sideTab = stripsKnown && !narrow ? panelTab : undefined;
  const sideHeld = panelTab ?? null;
  const taskSide = stripsKnown && !narrow ? sideHeld : undefined;
  const knownColumns = useRef(new Map<string, ReadonlySet<string>>()).current;
  if (columnKnown && !inboxOpen && !historyOpen) {
    knownColumns.set(boundFor, new Set(tasks.mainTabs.tabs.map(tabKey)));
  }
  const pageAgent = tasks.agentView.agentId;
  const listedWorkspace = tasks.workspace?.id;
  const experiments = useExperimentChoices();
  const unknownWorkspace = tasks.unknownWorkspace.open;
  const access = useRouteAccess();
  const router = useRouter();
  const [leaving, setLeaving] = useState<string>();
  const routedAddress = routed?.address === leaving ? undefined : routed?.address;
  useEffect(() => {
    if (routed?.address !== leaving) setLeaving(undefined);
  }, [routed, leaving]);
  const known = input.known;
  const everListed = useRef(new Set<string>()).current;
  for (const task of tasks.tasks) everListed.add(task.id);
  const titleLabel = input.title?.label;
  const titleDetail = input.title?.detail;
  const titleColumn = input.title?.panes?.column;
  const titleSide = input.title?.panes?.side;
  const untitled = useMemo((): Place | undefined => {
    if (!known || unknownWorkspace) return undefined;
    if (routedAddress !== undefined) return { kind: PLACE_KIND.ROUTED, address: routedAddress };
    if (inboxOpen) {
      const inbox = {
        kind: PLACE_KIND.INBOX,
        listed: inboxListed,
        chosen: inboxChosen,
        side: inboxChosen === undefined ? undefined : sideHeld,
      } as const;
      return inboxTask === undefined ? inbox : { ...inbox, taskId: inboxTask };
    }
    if (pageAgent !== undefined)
      return { kind: PLACE_KIND.AGENT, agentId: pageAgent, side: sideHeld };
    if (boundFor === undefined) return { kind: PLACE_KIND.HOME };
    return historyOpen
      ? { kind: PLACE_KIND.VERSION_HISTORY, taskId: boundFor, spot, listed: historyListed }
      : {
          kind: PLACE_KIND.TASK,
          taskId: boundFor,
          panel: narrow ? { open: panelOpen, tab: panelTab } : undefined,
          column: columnTab,
          side: taskSide,
        };
  }, [
    known,
    unknownWorkspace,
    routedAddress,
    narrow,
    boundFor,
    historyOpen,
    spot,
    historyListed,
    panelOpen,
    panelTab,
    columnTab,
    taskSide,
    sideHeld,
    inboxOpen,
    inboxListed,
    inboxChosen,
    inboxTask,
    pageAgent,
  ]);
  useSurfaceOpen(
    useMemo(() => {
      const beside =
        sideTab === undefined || boundFor === undefined
          ? undefined
          : tabSurface(boundFor, sideTab, true);
      return untitled?.kind === PLACE_KIND.ROUTED && routed !== undefined
        ? routedSurfaces(routed)
        : surfacesOf(untitled, columnKnown, beside);
    }, [untitled, columnKnown, sideTab, boundFor, routed]),
    input.room,
  );
  const inboxTaskName =
    inboxTask === undefined ? undefined : tasks.tasks.find((task) => task.id === inboxTask)?.name;
  const place = useMemo((): Titled | undefined => {
    if (untitled === undefined || titleLabel === undefined) return untitled;
    const label = { label: titleLabel, detail: titleDetail ?? inboxTaskName };
    const panes = { column: titleColumn, side: titleSide };
    const unnamed = titleColumn === undefined && titleSide === undefined;
    return { ...untitled, title: unnamed ? label : { ...label, panes } };
  }, [untitled, titleLabel, titleDetail, titleColumn, titleSide, inboxTaskName]);
  const tabsStand = (to: Extract<Place, { kind: typeof PLACE_KIND.TASK }>) => {
    const column = knownColumns.get(to.taskId);
    return to.column === undefined || column === undefined || column.has(tabKey(to.column));
  };
  const { automations } = input;
  const listedStands = (matches: ReturnType<typeof router.matchRoutes>) => {
    const routedHere = routedPlaceOf(matches);
    if (!OVER_THE_PLAN.has(routedHere)) return true;
    const automationId = matches.at(-1)?.params.automationId;
    if (automationId !== undefined && automations.deleted.has(automationId)) return false;
    const step = matches.find((match) => match.params.workspace !== undefined)?.params.workspace;
    return step === undefined || workspaceOfSlug(tasks.workspaces, step)?.id === listedWorkspace;
  };
  const reachable = (to: Place) => {
    if (to.kind === PLACE_KIND.ROUTED) {
      const matches = router.matchRoutes(pathOf(to.address));
      return routedStands(matches, access) && listedStands(matches);
    }
    if (
      to.kind === PLACE_KIND.VERSION_HISTORY &&
      !experimentOn(experiments, EXPERIMENT.DESCRIPTIONS)
    ) {
      return false;
    }
    if (to.kind === PLACE_KIND.TASK && !tabsStand(to)) return false;
    if (!("taskId" in to) || to.taskId === undefined || to.taskId === boundFor) return true;
    return (
      tasks.listFailed ||
      !everListed.has(to.taskId) ||
      tasks.tasks.some((task) => task.id === to.taskId)
    );
  };
  const go = (to: Place) => {
    if (to.kind === PLACE_KIND.ROUTED) {
      if (!OVER_THE_PLAN.has(routedPlaceOf(router.matchRoutes(pathOf(to.address))))) return;
      if (inboxOpen) tasks.inboxView.onClose();
      if (pageAgent !== undefined) tasks.agentView.onClose();
      if (unknownWorkspace) tasks.unknownWorkspace.onClose();
      if (historyOpen) tasks.history.onClose();
      return;
    }
    const historyStanding = routed === undefined && historyOpen && spot !== undefined;
    if (to.kind === PLACE_KIND.INBOX) {
      if (to.taskId !== undefined && to.chosen === undefined) {
        tasks.onShowInbox({ taskId: to.taskId });
      } else {
        tasks.inboxView.onOpen();
      }
      standInboxTask(to.taskId);
      if (to.chosen !== undefined) tasks.inboxView.onChoose(to.chosen);
      standSide(to.chosen === undefined ? undefined : choiceHolder(to.chosen), to.side);
      return;
    }
    if (to.kind === PLACE_KIND.AGENT) {
      tasks.agentView.onOpen(to.agentId);
      standSide(to.agentId, to.side);
      return;
    }
    if (inboxOpen) tasks.inboxView.onClose();
    if (pageAgent !== undefined) tasks.agentView.onClose();
    if (to.kind === PLACE_KIND.VERSION_HISTORY) {
      if (to.listed === undefined) {
        tasks.history.onReturn(to.taskId, to.spot);
        return;
      }
      const at: HistorySpot = {
        revision: to.spot?.revision,
        opened: to.spot?.opened,
        listed: to.listed,
      };
      if (historyStanding && boundFor === to.taskId) tasks.history.onStand(at);
      else tasks.history.onReturn(to.taskId, at);
      return;
    }
    if (historyOpen) tasks.history.onClose();
    if (to.kind === PLACE_KIND.TASK && boundFor !== to.taskId) tasks.onRestoreTask(to.taskId);
    if (to.kind === PLACE_KIND.TASK && to.column !== undefined) {
      tasks.mainTabs.onShow(to.taskId, to.column);
    }
    if (to.kind === PLACE_KIND.TASK && to.panel !== undefined) standPanel(to.taskId, to.panel);
    else if (to.kind === PLACE_KIND.TASK) standSide(to.taskId, to.side);
    if (to.kind === PLACE_KIND.HOME && boundFor !== undefined) tasks.onLeaveTask();
  };
  const standSide = (holder: string | undefined, side: SideStep) => {
    if (side === null) tasks.sidePanel.onSetOpen(false);
    else if (side !== undefined && holder !== undefined) tasks.sidePanel.onShow(holder, side);
  };
  const standPanel = (taskId: string, panel: PanelStep) => {
    const { sidePanel } = tasks;
    if (panel.open && panel.tab !== undefined) sidePanel.onShow(taskId, panel.tab);
    else sidePanel.onSetOpen(panel.open);
  };
  const personOf = (to: Place): string | undefined => {
    if (to.kind !== PLACE_KIND.ROUTED) return undefined;
    const matches = router.matchRoutes(pathOf(to.address));
    if (routedPlaceOf(matches) !== ROUTED_PLACE.PERSON) return undefined;
    const params: Readonly<Record<string, string | undefined>> = matches.at(-1)?.params ?? {};
    return params.userId;
  };
  const personStanding = routed?.place === ROUTED_PLACE.PERSON;
  const held = trailOf(router.history);
  const subscribeTrail = useCallback((listener: () => void) => listenTo(held, listener), [held]);
  const personListed = useSyncExternalStore(
    subscribeTrail,
    () =>
      personStanding ||
      held.trail.entries.some(
        (entry) =>
          entry.state.kind === PLACE_KIND.ROUTED &&
          routedPlaceOf(router.matchRoutes(pathOf(entry.address))) === ROUTED_PLACE.PERSON,
      ),
  );
  const members = useHostRead(
    LIVE_READ.WORKSPACE_MEMBERS,
    personListed ? tasks.workspace?.id : undefined,
  ).rows?.members;
  const named = (to: Place) => {
    const person = personOf(to);
    const step: NamedStep | undefined =
      person === undefined ? namedStepOf(to) : { kind: NAMED_STEP.PERSON, userId: person };
    return liveStepTitle(step, titleOf(to), tasks, members);
  };
  const { backTo, upTo, inPlace, stepBack, stepAway, ...history } = useHistory({
    held,
    place,
    address: routedAddress ?? addressOf(input.link),
    reachable,
    named,
    go,
    guard: tasks.leaveGuard.guard,
    opened: tasks.sidePanel.opened,
  });
  const homeOnPhone = narrow && tasks.signedIn && untitled?.kind === PLACE_KIND.HOME;
  const openInbox = tasks.inboxView.onOpen;
  useEffect(() => {
    if (homeOnPhone) inPlace({ kind: PLACE_KIND.INBOX, listed: true }, openInbox);
  }, [homeOnPhone, inPlace, openInbox]);
  const up = (to: Place, stand: () => void) => (narrow ? upTo(to, stand) : stand());
  const { settingsList, onSettingsList } = input;
  const lists = useSteadyDoorSet<ListBacks>({
    settings: () => {
      const list = settingsList === undefined ? undefined : routedPlace(settingsList);
      if (!narrow || list === undefined || !backTo(list)) onSettingsList();
    },
    versions: () =>
      boundFor === undefined
        ? tasks.history.onList()
        : up(
            { kind: PLACE_KIND.VERSION_HISTORY, taskId: boundFor, spot, listed: true },
            tasks.history.onList,
          ),
    runs: () => {
      const setup =
        automations.setupAddress === undefined ? undefined : routedPlace(automations.setupAddress);
      if (!narrow || setup === undefined || !backTo(setup)) tasks.automationsView.onRuns(false);
    },
    inbox: () => {
      const stand = () => tasks.inboxView.onClear();
      const list = { kind: PLACE_KIND.INBOX, listed: true } as const;
      const narrowed = inboxTask === undefined ? list : { ...list, taskId: inboxTask };
      if (inboxSingle) upTo(narrowed, stand);
      else stand();
    },
    panel: () => {
      const shut = () => tasks.sidePanel.onSetOpen(false);
      if (untitled?.kind === PLACE_KIND.INBOX || untitled?.kind === PLACE_KIND.AGENT) {
        if (!narrow || !backTo({ ...untitled, side: null })) shut();
        return;
      }
      if (boundFor === undefined) {
        shut();
        return;
      }
      up({ kind: PLACE_KIND.TASK, taskId: boundFor, panel: { open: false, tab: undefined } }, shut);
    },
    task: () => {
      if (!stepBack()) tasks.onLeaveTask();
    },
  });
  return useSteadyDoors({
    ...history,
    onLeaveRouted: () => {
      if (routed !== undefined) setLeaving(routed.address);
    },
    onLeaveVersionHistory: () => {
      if (boundFor !== undefined && backTo({ kind: PLACE_KIND.TASK, taskId: boundFor })) return;
      tasks.history.onClose();
    },
    onLeave: () => {
      if (!stepAway()) tasks.onGoHome();
    },
    lists,
  });
}

export function useHistoryMouseButtons(history: NavigationHistory, enabled: boolean): void {
  const { onBack, onForward } = history;
  useEffect(() => {
    if (!enabled) return;
    const handleUp = (event: MouseEvent) => {
      if (event.button !== MOUSE_BUTTON.BACK && event.button !== MOUSE_BUTTON.FORWARD) return;
      event.preventDefault();
      if (event.button === MOUSE_BUTTON.BACK) onBack();
      else onForward();
    };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, [enabled, onBack, onForward]);
}
