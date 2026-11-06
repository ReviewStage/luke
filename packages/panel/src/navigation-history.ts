/**
 * navigation-history.ts -- the window's back and forward: the places it has stood on, and the moves between them.
 *
 * A place is a task's page, a plan's version history, the home page,
 * the Inbox, or Settings, and the history is the one a browser keeps: the places behind,
 * the one standing, and the places ahead, which a new visit clears. It is
 * written by watching where the window is rather than by each door that
 * moves it, so a task opened from the sidebar, by a key, by starting it, or
 * by the host itself is one more place visited all the same, and a move
 * through the history is the window arriving where the history already
 * stands. It lives as long as the window does, the way a browser tab's does.
 *
 * The history is written into the router history the window's root mounts
 * (`panel-router.tsx`), each place saved in its entry's state as what a step
 * back reopens it from, the way a browser's `history.state` stands beside
 * its URL, and the path of its app link as its address: the link Copy link names for
 * the step (`links-at-hand.ts`), so the two never disagree, or `/app` for a
 * place with none. The step standing takes its address again whenever that
 * link changes, as when a workspace's slug is read after the visit; a step
 * behind takes it when the window is back on it. The desktop's router keeps
 * its history in memory, and nothing there reads an address; the web's is
 * the tab's own. The router's history names only the entry standing, so the
 * trail of steps around it is kept here beside it (`WindowTrail`).
 *
 * Settings is one step however many of its pages are turned: entering it is
 * a visit, and choosing another of its pages turns the page that visit holds
 * in place, so Back from any page of it returns to wherever it was opened
 * from, and Forward brings it back on the page last open. A plan's version
 * history is one step the same way, whichever version is chosen in it or
 * whichever revision's sections are open, and going back to it opens it on
 * that version with those sections. Whatever is opened from it — a version's
 * source, a tab from the command palette, a notification's — is a visit
 * after it, though it opens on the same task, so Back returns to it; only a
 * restore lands on the task as Back would, where the task stands behind.
 *
 * What a page shows within it is a step too: the tab the task's column
 * shows, and the Inbox's item and the task it is narrowed to, so Back goes back to what the window was
 * just showing rather than past it to the page before. Such a choice is a
 * step only where a press or a key led to it: one the window makes by
 * itself, as a task's tabs arriving after it opens, an agent's tab shown as
 * it starts, or the tab shown in place of one closed, takes the standing
 * step in place. A tab or an item not yet known, as a task's tabs on their
 * way or an Inbox with nothing chosen, fills in the step it stands in. A
 * step on a column's tab since closed is passed over, as a deleted task is,
 * as far as the window last saw that task's strip.
 *
 * The side panel belongs to the stop it was opened at, a task, an agent's
 * page, or an Inbox item, so each such step holds it: the tab it shows, or
 * shut (`null`), which a step taken before the panel was known holds as
 * none. Going to a step stands the panel as the step held it, a tab since
 * closed opened again. One press is one step: a page, a file, or a pull
 * request a link, a pin, or a notification opens there is a step of its own
 * (`SidePanelControl.opened`), which Back undoes, the panel shut where it
 * was shut, while a tab chosen in its strip, its toggle, and its tabs
 * arriving take the standing step in place.
 *
 * Each Automations page is a step of its own, the list and each automation's
 * page alike, so Back from an automation opened from the list returns to the
 * list. A new automation's page is one step with the automation it makes,
 * which stands in its place once Create lands, so Back from what it made
 * returns to wherever the new page was opened from. An automation's page is
 * of the workspace it was opened in, so Back passes over it once another is
 * listed, as it does a person's page, and passes over it for good once it
 * is deleted, as it does a deleted plan.
 *
 * A narrow room, a phone's, stands the window as one pane at a time
 * (`shell-room.ts`), and there each pane opened over another is a step of its
 * own, which Back closes: the side panel over the plan, an Inbox item, a
 * Settings page, a version, or an automation's
 * runs over its setup. Each such step
 * holds its sub-step beside its place, and a wide room holds none, so two
 * places are one step there as they always were, and a room turned from one
 * to the other takes the step standing in place. Going to a step stands its
 * sub-step from the step alone, so a move the history makes by itself, as a
 * browser's Back does, lands on the screen the step was. The screens' own
 * ways back to their lists step back where the list is the step behind, and
 * otherwise take the step standing in place, as a link opened on an item
 * leaves no list behind it to go back to. The side panel's ways out do the
 * same, so shutting a panel opened over the plan steps back to the plan
 * rather than adding a step that Back would open the panel again from. A
 * step between two such panes of one page leaves no page, so it never asks
 * first, as leaving an automation with unsaved changes does. A phone's way
 * out of a task goes back past all of the task's own steps at once, to the
 * nearest step on another page, the list it was opened from, and is named
 * as that step is (`WindowHistory`'s `away` and `onLeave`). A phone has no
 * Home: where the window would stand on it, the Inbox's list takes its step
 * in place, so a phone opens on the Inbox and Back never lands on Home.
 */

import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { linkOf, type ReadLink } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { EXPERIMENT, experimentOn } from "@repo/settings";
import type { SettingsView } from "@repo/settings/settings-views";
import {
  isAgentTab,
  isChangesTab,
  isCloudBrowserTab,
  isDraftTab,
  isFileTab,
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
  useSyncExternalStore,
} from "react";
import { ADMIN_PAGE, type AdminView, adminSection } from "./admin/routing.js";
import { liveStepTitle, NAMED_STEP, type NamedStep } from "./history-titles.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { settingsPageExperimentStands } from "./settings/settings-rows.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { useSteadyDoorSet, useSteadyDoors } from "./steady-door.js";
import { standInboxTask, useInboxTask } from "./tasks/use-inbox-task.js";
import { MAIN_TAB, type MainTab } from "./tasks/use-main-tabs.js";
import type { HistorySpot } from "./tasks/use-plan-history.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./tasks/use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  automationsTab,
  type InboxChoice,
  type LeaveGuard,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { useAdminAccess, useAdminAccessPending, useExperimentChoices } from "./use-app-state.js";
import { useHostRead } from "./use-host-read.js";
import { type OpenSurface, useSurfaceOpen } from "./use-surface-open.js";

/** `MouseEvent.button` for the mouse's own back and forward buttons. */
export const MOUSE_BUTTON = {
  BACK: 3,
  FORWARD: 4,
} as const;

/** Which kind of place the window is on. */
const PLACE_KIND = {
  TASK: "plan",
  VERSION_HISTORY: "version-history",
  HOME: "home",
  INBOX: "inbox",
  AGENT: "agent",
  PERSON: "person",
  AUTOMATIONS: "automations",
  BOARD: "board",
  SETTINGS: "settings",
  ADMIN: "admin",
} as const;

/** The side panel as a step holds it: its tab shown while open, `null` while shut, and none where it was not yet known. */
type SideStep = SidePanelTab | null | undefined;

/** The side panel as a narrow room holds it: open over the plan, the whole pane, on the tab shown, or shut. */
interface PanelStep {
  readonly open: boolean;
  readonly tab: SidePanelTab | undefined;
}

/**
 * A place the window can stand on: a task, or its version history where it
 * stands, by its id, so a rename leaves it the same place. A place a narrow
 * room shows one pane of at a time holds which, its sub-step, and none in a
 * wide room: the side panel over a task, an automation's runs over its
 * setup, and whether Settings, a version history, or the Inbox stands
 * on its list (`listed`) or the item chosen in it.
 */
type Place =
  | {
      readonly kind: typeof PLACE_KIND.TASK;
      readonly taskId: string;
      readonly panel?: PanelStep | undefined;
      /** The column's tab shown, in any room; none while the column shows no tab or its tabs are not yet the task's. */
      readonly column?: MainTab | undefined;
      /** The side panel's tab shown while it is open, in a wide room (a narrow one keeps it in `panel`), `null` while it is shut, and none while its tabs are not yet the task's. */
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
      /** The item standing alone, while one does. */
      readonly chosen?: InboxChoice | undefined;
      /** The task the Inbox is narrowed to. */
      readonly taskId?: string | undefined;
      /** The side panel beside the item standing, as a task's step holds it; none while no item stands. */
      readonly side?: SideStep;
    }
  | {
      readonly kind: typeof PLACE_KIND.AGENT;
      readonly agentId: string;
      /** The side panel beside the page, as a task's step holds it. */
      readonly side?: SideStep;
    }
  | {
      readonly kind: typeof PLACE_KIND.PERSON;
      readonly userId: string;
      /** The name the page was opened with, which it is opened with again. */
      readonly name: string | undefined;
      /** The workspace the page was the person's in, which it is no place of another's. */
      readonly workspaceId: string | undefined;
    }
  | {
      readonly kind: typeof PLACE_KIND.AUTOMATIONS;
      readonly page: AutomationsPlace;
      /** The workspace listed as the page stood, whose automations it read. */
      readonly workspaceId: string | undefined;
      /** Whether an automation's runs stood alone over its setup, in a narrow room alone. */
      readonly runs?: boolean | undefined;
    }
  | {
      readonly kind: typeof PLACE_KIND.BOARD;
      /** The workspace whose tasks stood, which is no place of another's. */
      readonly workspaceId: string | undefined;
    }
  | {
      readonly kind: typeof PLACE_KIND.SETTINGS;
      readonly view: SettingsView;
      readonly listed?: boolean | undefined;
    }
  | { readonly kind: typeof PLACE_KIND.ADMIN; readonly view: AdminView };

/** What a step is called where the trail is listed: what stood in the window, and what it showed there, such as a task and its tabs. */
export interface StepTitle {
  readonly label: string;
  readonly detail?: string | undefined;
  /** What a task's step called each of its panes' tabs, which one is named by again where nothing names it now; none on any other step. */
  readonly panes?: StepPanes | undefined;
}

/** What a task's step called the tab its column showed and the one its side panel showed, where each showed one. */
export interface StepPanes {
  readonly column?: string | undefined;
  readonly side?: string | undefined;
}

/** A place with what it was called as the window stood on it, which no comparison of steps reads. */
type Titled = Place & { readonly title?: StepTitle | undefined };

/** One step the window has stood on: the address its entry is held at, and the place it reopens. */
interface TrailEntry {
  readonly address: string;
  readonly state: Place;
}

/** The steps the window has stood on, oldest first, and the one standing; `at` is -1 while none is. */
interface Trail {
  readonly entries: readonly TrailEntry[];
  readonly at: number;
}

/** The most steps a window's trail holds, dropping the oldest first. */
const TRAIL_LIMIT = 50;

const EMPTY_TRAIL: Trail = { entries: [], at: -1 };

/** How a step is written into the trail: a visit after the step standing, or in its place. */
const TRAIL_WRITE = {
  PUSH: "push",
  REPLACE: "replace",
} as const;

type TrailWriteKind = (typeof TRAIL_WRITE)[keyof typeof TRAIL_WRITE];

/** A write of the trail: `entry` after the step standing, or in its place. */
interface TrailWrite {
  readonly kind: TrailWriteKind;
  readonly entry: TrailEntry;
}

/** What a window saves in each entry of its router's history: the place the step reopens, and the step's number among the window's own. */
interface SavedStep {
  readonly place: Place;
  readonly index: number;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The window's step saved in this entry (`navigation-history.ts`); none in an entry no window wrote. */
    readonly step?: SavedStep;
  }
}

/** A saved step as a window writes one, read back from a browser that may hold anything in an entry. */
const isSavedStep = Schema.is(
  Schema.Struct({ index: Schema.Int, place: Schema.Struct({ kind: Schema.String }) }),
);

/** What a place was called as the window stood on it, where it was told. */
function titleOf(place: Place | undefined): StepTitle | undefined {
  return place === undefined ? undefined : (place as Titled).title;
}

/** What a place names by id, which its name is read again from as it is listed (`liveStepTitle`); none for a place named by its kind alone. */
function namedStepOf(place: Place): NamedStep | undefined {
  switch (place.kind) {
    case PLACE_KIND.TASK: {
      // A narrow room keeps the side panel's tab in its pane of its own, named as a wide room's side is.
      const panelTab = place.panel?.open === true ? place.panel.tab : undefined;
      const side = place.side ?? panelTab;
      return { kind: NAMED_STEP.TASK, taskId: place.taskId, column: place.column, side };
    }
    case PLACE_KIND.VERSION_HISTORY:
      return { kind: NAMED_STEP.VERSION_HISTORY, taskId: place.taskId };
    case PLACE_KIND.INBOX: {
      const { chosen } = place;
      // Note that an Inbox narrowed to a task is named by it, as every item it shows is that task's.
      const taskId = chosen !== undefined && "taskId" in chosen ? chosen.taskId : place.taskId;
      return { kind: NAMED_STEP.INBOX, taskId };
    }
    case PLACE_KIND.PERSON:
      return { kind: NAMED_STEP.PERSON, userId: place.userId };
    default:
      return undefined;
  }
}

/** Whether two places were called the same. */
function sameTitle(one: Place, other: Place): boolean {
  const mine = titleOf(one);
  const theirs = titleOf(other);
  return mine?.label === theirs?.label && mine?.detail === theirs?.detail;
}

/** Whether two Automations pages are one step: the list, a new automation's page, or the same automation's, on whichever of its runs. */
function sameAutomationsPage(one: AutomationsPlace, other: AutomationsPlace): boolean {
  if (one.kind === AUTOMATIONS_PAGE.EDIT && other.kind === AUTOMATIONS_PAGE.EDIT) {
    return one.automationId === other.automationId;
  }
  return one.kind === other.kind;
}

/** Whether one Automations page stands as it was opened: an automation's on the same run. */
function sameAutomationsOpening(one: AutomationsPlace, other: AutomationsPlace): boolean {
  if (one.kind === AUTOMATIONS_PAGE.EDIT && other.kind === AUTOMATIONS_PAGE.EDIT) {
    return one.runId === other.runId;
  }
  return true;
}

/** Whether `place` is the automation a new automation's page standing made, which takes that page's step rather than being a visit after it; any other automation opened from it is a visit. */
function madeFromNew(standing: Place, place: Place): boolean {
  return (
    standing.kind === PLACE_KIND.AUTOMATIONS &&
    standing.page.kind === AUTOMATIONS_PAGE.NEW &&
    place.kind === PLACE_KIND.AUTOMATIONS &&
    place.page.kind === AUTOMATIONS_PAGE.EDIT &&
    place.page.created === true
  );
}

/** A place's sub-step in a narrow room, as a yes or no: the side panel open, an automation's runs standing, or the list standing; none in a wide room, or for a place with no sub-step. */
function subStepOf(place: Place): boolean | undefined {
  switch (place.kind) {
    case PLACE_KIND.TASK:
      return place.panel?.open;
    case PLACE_KIND.AUTOMATIONS:
      return place.runs;
    case PLACE_KIND.VERSION_HISTORY:
    case PLACE_KIND.INBOX:
    case PLACE_KIND.SETTINGS:
      return place.listed;
    default:
      return undefined;
  }
}

/** Whether two places' sub-steps are one step: the same, or either none, as a wide room records none. */
function sameSubStep(one: Place, other: Place): boolean {
  const mine = subStepOf(one);
  const theirs = subStepOf(other);
  return mine === undefined || theirs === undefined || mine === theirs;
}

/** The task an Inbox item stands on, or for an agent with no task its agent, whose side panel stands beside it. */
function choiceHolder(choice: InboxChoice): string | undefined {
  if ("taskId" in choice) return choice.taskId;
  return "agentId" in choice ? choice.agentId : undefined;
}

/** Whether two Inbox items are the same item of the same holder. */
function sameInboxChoice(one: InboxChoice | undefined, other: InboxChoice | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  return one.itemId === other.itemId && choiceHolder(one) === choiceHolder(other);
}

/** Whether two side panels stand on the same tab, or none. */
function samePanelTab(one: PanelStep | undefined, other: PanelStep | undefined): boolean {
  if (one?.tab === undefined || other?.tab === undefined) return one?.tab === other?.tab;
  return sameTab(one.tab, other.tab);
}

/** Whether two places are one page, whichever of its narrow sub-steps each stands on: the same plan, the same plan's version history, the home page, the Inbox on any plan, the same agent's or person's page, the same Automations page, the same workspace's Board, or Settings on any page. */
function samePage(one: Place, other: Place): boolean {
  if (one.kind !== other.kind) return false;
  if (one.kind === PLACE_KIND.ADMIN && other.kind === PLACE_KIND.ADMIN) {
    return samePageAdminView(one.view, other.view);
  }
  if (one.kind === PLACE_KIND.AUTOMATIONS && other.kind === PLACE_KIND.AUTOMATIONS) {
    return sameAutomationsPage(one.page, other.page);
  }
  if ("taskId" in one && "taskId" in other) return one.taskId === other.taskId;
  if ("agentId" in one && "agentId" in other) return one.agentId === other.agentId;
  if ("userId" in one && "userId" in other) {
    return one.userId === other.userId && one.workspaceId === other.workspaceId;
  }
  if ("workspaceId" in one && "workspaceId" in other) return one.workspaceId === other.workspaceId;
  return true;
}

/**
 * Whether two Admin views are one page: any two of its sections, which
 * replace each other in place as Settings' pages do, so Back leaves the
 * place; or the same account's, workspace's, or day's page, each a step of its own.
 */
function samePageAdminView(one: AdminView, other: AdminView): boolean {
  if (adminSection(one) && adminSection(other)) return true;
  return sameAdminView(one, other);
}

/** Whether two Admin views are the same view. */
function sameAdminView(one: AdminView, other: AdminView): boolean {
  if (one.kind === ADMIN_PAGE.ACCOUNT && other.kind === ADMIN_PAGE.ACCOUNT)
    return one.id === other.id;
  if (one.kind === ADMIN_PAGE.WORKSPACE && other.kind === ADMIN_PAGE.WORKSPACE)
    return one.id === other.id;
  if (one.kind === ADMIN_PAGE.DAY && other.kind === ADMIN_PAGE.DAY) return one.day === other.day;
  return one.kind === other.kind;
}

/** The tab a narrow room's side panel shows over the plan, while it is open. */
function openPanelTab(panel: PanelStep | undefined): SidePanelTab | undefined {
  return panel?.open === true ? panel.tab : undefined;
}

/** Whether two tabs are one, or both none. */
function sameTabOrNone(one: StripTab | undefined, other: StripTab | undefined): boolean {
  return one === undefined || other === undefined ? one === other : sameTab(one, other);
}

/** Whether two tabs are one, or either is none: a tab not yet known fills in the step it stands in rather than being another. */
function sameOrUnknownTab(one: StripTab | undefined, other: StripTab | undefined): boolean {
  return one === undefined || other === undefined || sameTab(one, other);
}

/** Whether two side panels stand alike: shut both, or on one tab. */
function sameSide(one: SideStep, other: SideStep): boolean {
  return one == null || other == null ? one === other : sameTab(one, other);
}

/** The side panel a place shows within its page: a narrow room's while it stands over the plan, whose opening is a sub-step of its own, else the step's own. */
function sideOf(place: Place): SideStep {
  if (place.kind === PLACE_KIND.TASK) {
    return place.panel === undefined ? place.side : openPanelTab(place.panel);
  }
  return place.kind === PLACE_KIND.INBOX || place.kind === PLACE_KIND.AGENT
    ? place.side
    : undefined;
}

/** Whether two places of one page show one side panel, or either one not yet known, which fills in the step it stands in. */
function sameShownSide(one: Place, other: Place): boolean {
  const mine = sideOf(one);
  const theirs = sideOf(other);
  return mine === undefined || theirs === undefined || sameSide(mine, theirs);
}

/**
 * Whether two places of one page show one thing in it: the same tabs of a
 * task's column and side panel, the same Inbox item and the panel beside it.
 * Either side showing none, as a task whose tabs are on their way or an
 * Inbox with no item chosen yet, is the same, so what arrives fills in the
 * step it stands in.
 */
function sameShown(one: Place, other: Place): boolean {
  return sameChosen(one, other) && sameShownSide(one, other);
}

/** Whether two places of one page stand on one thing chosen in it, whatever their side panels show: the same tab of a task's column, the same Inbox item. */
function sameChosen(one: Place, other: Place): boolean {
  if (one.kind === PLACE_KIND.TASK && other.kind === PLACE_KIND.TASK) {
    return sameOrUnknownTab(one.column, other.column);
  }
  if (one.kind === PLACE_KIND.INBOX && other.kind === PLACE_KIND.INBOX) {
    // Note that the Inbox and each task it is narrowed to are steps of their own, so moving between them is a visit rather than filling in the step.
    if (one.taskId !== other.taskId) return false;
    return one.chosen === undefined || other.chosen === undefined
      ? true
      : sameInboxChoice(one.chosen, other.chosen);
  }
  return true;
}

/** Whether two places are one step of the history: one page, on one sub-step, since a narrow room's pane opened over another is a step of its own, showing one thing in it, since a tab or an Inbox item chosen is a step of its own too. */
function sameStep(one: Place | undefined, other: Place): boolean {
  return (
    one !== undefined && samePage(one, other) && sameSubStep(one, other) && sameShown(one, other)
  );
}

/** Whether two places are one step but for what each shows in its page: the move between them chooses another tab or Inbox item on the page standing, or stands its side panel otherwise. */
function choosesWithin(one: Place | undefined, other: Place): boolean {
  return (
    one !== undefined && samePage(one, other) && sameSubStep(one, other) && !sameShown(one, other)
  );
}

/**
 * Whether a move within one page was the developer's own, so a step of its
 * own: another tab or item chosen where a press or a key led to it
 * (`pressed`), or the side panel standing otherwise where a door naming a
 * thing opened it there (`opened`), a tab chosen in its strip or its
 * toggle being no such door.
 */
function ledWithin(one: Place, other: Place, pressed: boolean, opened: boolean): boolean {
  return (pressed && !sameChosen(one, other)) || (opened && !sameShownSide(one, other));
}

/** The surface a tab of a task's column or side panel shows, which a task's own fixed tabs name by the task; `side` marks one of the side panel's, which stands beside the column's of the same kind. */
function tabSurface(taskId: string, tab: StripTab, side: boolean): OpenSurface {
  if (isAgentTab(tab) || isDraftTab(tab) || isTranscriptTab(tab)) {
    return { surface: PRODUCT_SURFACE.AGENT, of: tabKey(tab), side };
  }
  const of = tabKey(tab);
  if (isSubagentTab(tab)) return { surface: PRODUCT_SURFACE.SUBAGENT, of, side };
  if (isFileTab(tab)) return { surface: PRODUCT_SURFACE.FILES, of, side };
  if (isChangesTab(tab)) return { surface: PRODUCT_SURFACE.PULL_REQUEST, of, side };
  if (isTerminalTab(tab)) return { surface: PRODUCT_SURFACE.TERMINAL, of, side };
  if (isCloudBrowserTab(tab)) return { surface: PRODUCT_SURFACE.BROWSER, of, side };
  if (isPageTab(tab)) return { surface: PRODUCT_SURFACE.PAGE, of, side };
  // A word of a strip's own: the column's Overview, which shows the task, the task's Inbox, or its comments.
  if (tab === SIDE_PANEL_TAB.INBOX) return { surface: PRODUCT_SURFACE.INBOX, of: taskId, side };
  if (tab === SIDE_PANEL_TAB.COMMENTS) {
    return { surface: PRODUCT_SURFACE.COMMENTS, of: taskId, side };
  }
  return { surface: PRODUCT_SURFACE.TASK, of: taskId, side };
}

/**
 * The surfaces a place shows, as the window counts them opened: each pane
 * drawn on screen shows one. A task's column and its side panel each show
 * one, the column's held back while the task's agents are unread
 * (`columnKnown`), since the plan it would name may be an agent's tab still on
 * its way, and a narrow room's side panel, open, covers the column whole. The
 * Inbox's and an agent page's side panel is `beside`, wide rooms alone.
 */
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
    case PLACE_KIND.PERSON:
      return [{ surface: PRODUCT_SURFACE.PERSON, of: place.userId }];
    case PLACE_KIND.HOME:
      return [{ surface: PRODUCT_SURFACE.HOME }];
    case PLACE_KIND.AUTOMATIONS:
      return [{ surface: PRODUCT_SURFACE.AUTOMATIONS }];
    case PLACE_KIND.BOARD:
      return [{ surface: PRODUCT_SURFACE.BOARD }];
    case PLACE_KIND.SETTINGS:
      return [{ surface: PRODUCT_SURFACE.SETTINGS }];
    case PLACE_KIND.ADMIN:
      return [{ surface: PRODUCT_SURFACE.ADMIN }];
  }
}

/** Whether a version history stands where it stood: on the same version, with the same sections open. */
function sameSpot(one: HistorySpot | undefined, other: HistorySpot | undefined): boolean {
  return (
    one?.revision === other?.revision &&
    one?.opened?.seq === other?.opened?.seq &&
    one?.opened?.heading === other?.opened?.heading
  );
}

/** Whether a step stands as it stood: its narrow sub-step the same, the side panel on the same tab, the same Inbox item standing alone, Settings on the same page, a version history where it was, a person's page by the name it was last opened with, an Automations page as it was opened. */
function samePlace(one: Place, other: Place): boolean {
  // A room turned takes the step standing in place, with its sub-step or without.
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
  if (one.kind === PLACE_KIND.AUTOMATIONS && other.kind === PLACE_KIND.AUTOMATIONS) {
    return one.workspaceId === other.workspaceId && sameAutomationsOpening(one.page, other.page);
  }
  if (one.kind === PLACE_KIND.SETTINGS && other.kind === PLACE_KIND.SETTINGS) {
    return one.view === other.view;
  }
  if (one.kind === PLACE_KIND.ADMIN && other.kind === PLACE_KIND.ADMIN) {
    return sameAdminView(one.view, other.view);
  }
  if (one.kind === PLACE_KIND.VERSION_HISTORY && other.kind === PLACE_KIND.VERSION_HISTORY) {
    return sameSpot(one.spot, other.spot);
  }
  if (one.kind === PLACE_KIND.PERSON && other.kind === PLACE_KIND.PERSON) {
    return one.name === other.name;
  }
  return true;
}

/**
 * The address of a place with no link: a new automation's page, and any
 * place before its workspace is read, the home page a fresh tab rests on
 * among them, which takes its link's address in place once it is.
 * `app` is a step no workspace's slug may take (`RESERVED_WORKSPACE_SLUGS`),
 * so it names no workspace's place.
 */
const NO_LINK_ADDRESS = "/app";

/** The address a step is held at: its link's path, with the query and fragment it carries, since a browser holds a same-origin path; `/app` where it has none. */
function addressOf(link: ReadLink | undefined): string {
  if (link === undefined) return NO_LINK_ADDRESS;
  const url = new URL(linkOf(link.place, link.workspace));
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The write recording the window standing on `place`, at `address`. A step already
 * standing is left as it is, but for a Settings page turned or a version
 * history moved within, which the standing step takes in place, and so does
 * the automation a new automation's page made, and an address changed under
 * it, and so does `up`, a list a narrow screen went up to from its item where
 * the list was no step behind. A tab or an Inbox item chosen
 * within the page standing is a visit only where a press or a key led to it
 * (`pressed`), and the side panel standing otherwise only where a door
 * naming a thing opened it (`opened`): one the window chose by itself, as a
 * task's tabs arriving after it opens, an agent's tab shown as it starts, or
 * the tab chosen in place of one closed, takes the standing step in place,
 * and so does a tab chosen in the panel's strip or its toggle. Any other
 * place is a visit, whichever door opened it.
 */
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
  // A tab, an item, or a side panel stood within the page standing that the developer did not lead to is the window settling, not a visit.
  const settling =
    standing !== undefined &&
    choosesWithin(standing.state, place) &&
    !ledWithin(standing.state, place, pressed, opened);
  if (standing !== undefined && (wentUp || settling || madeFromNew(standing.state, place))) {
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

/** The trail as `write` leaves it: a push clearing the steps ahead and dropping the oldest past the bound, a replace in the standing step's place, either the trail's one step where none stands. */
function written(trail: Trail, write: TrailWrite): Trail {
  if (trail.at < 0) return { entries: [write.entry], at: 0 };
  if (write.kind === TRAIL_WRITE.REPLACE) {
    return { entries: trail.entries.with(trail.at, write.entry), at: trail.at };
  }
  const entries = [...trail.entries.slice(0, trail.at + 1), write.entry].slice(-TRAIL_LIMIT);
  return { entries, at: entries.length - 1 };
}

/** The trail as it stands once the visit to `place` is written on it; the trail itself where the visit writes nothing. */
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

/**
 * The nearest step one way along the trail the window can still go to,
 * skipping any it cannot reach and any that is the step it already stands
 * on, so a deleted task between two visits of one page is passed over whole.
 */
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

/**
 * The nearest step behind the one standing that stands on another page and
 * can still be gone to, passing over the standing page's own steps, its
 * narrow panes and its tabs among them; none where no such step stands.
 */
function awayFrom(trail: Trail, reachable: (place: Place) => boolean): number | undefined {
  const standing = trail.entries[trail.at]?.state;
  for (let at = trail.at - 1; at >= 0; at -= 1) {
    const place = trail.entries[at]?.state;
    if (place === undefined || !reachable(place)) continue;
    if (standing === undefined || !samePage(standing, place)) return at;
  }
  return undefined;
}

/**
 * How a step to `to` asks: as the window's guard asks, unless it moves only
 * within the draft standing, between a narrow room's sub-steps or to the
 * same automation on another run, which leaves no page and so loses nothing
 * written on it; that way out is taken as it is.
 */
function asking(
  latest: { readonly place: Place | undefined; readonly guard: LeaveGuard["guard"] },
  to: Place | undefined,
): LeaveGuard["guard"] {
  const { place } = latest;
  return place !== undefined && to !== undefined && samePage(place, to)
    ? (leave) => leave
    : latest.guard;
}

/**
 * The page a step stood on: its place's kind, and which of that kind's pages
 * it was, where the kind has more than one (a task's, an agent's, an
 * automation's).
 */
export interface HistoryPage {
  readonly kind: Place["kind"];
  readonly of: string | undefined;
}

/** One step of the trail as Back's and Forward's lists draw it: where it stands on the trail, what it is called now, and which page it was. */
export interface HistoryStep {
  readonly at: number;
  readonly title: StepTitle | undefined;
  /** The page it stood on, so the list can gather a page's steps together (`sameHistoryPage`). */
  readonly page: HistoryPage;
}

/** The window's history as its buttons and keys use it. */
export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The steps Back and Forward can still go to, nearest first, as their lists draw them. */
  steps: { readonly back: readonly HistoryStep[]; readonly forward: readonly HistoryStep[] };
  /** Goes straight to a step of the lists, asking first as any step does. */
  onGoTo: (at: number) => void;
}

/** How many steps each way Back's and Forward's lists draw. */
const LISTED_STEPS = 15;

/** The page a place stands on, the same for every step on one page (`sameHistoryPage`). */
function pageOf(place: Place): HistoryPage {
  switch (place.kind) {
    case PLACE_KIND.TASK:
    case PLACE_KIND.VERSION_HISTORY:
      return { kind: place.kind, of: place.taskId };
    case PLACE_KIND.AGENT:
      return { kind: place.kind, of: place.agentId };
    case PLACE_KIND.PERSON:
      return { kind: place.kind, of: place.userId };
    case PLACE_KIND.AUTOMATIONS:
      return {
        kind: place.kind,
        of: place.page.kind === AUTOMATIONS_PAGE.EDIT ? place.page.automationId : place.page.kind,
      };
    default:
      return { kind: place.kind, of: undefined };
  }
}

/** Whether two steps stood on one page, so the list gathers them together. */
export function sameHistoryPage(one: HistoryPage, other: HistoryPage): boolean {
  return one.kind === other.kind && one.of === other.of;
}

/**
 * The steps one way along the trail the window can go to, nearest first, as
 * Back's or Forward's list draws them: each one Back or Forward would reach
 * pressed again and again, so a step it cannot reach and a run of one step
 * held twice are passed over, as `nearest` passes over them.
 */
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

/**
 * The ways back from a narrow screen's item to its list, through the
 * history: a step back where the list is the step behind, else the list
 * taking the item's step in place. A wide room holds no such step, so there
 * each only stands the list.
 */
export interface ListBacks {
  readonly settings: () => void;
  readonly versions: () => void;
  /** Stands an automation's setup again from its runs. */
  readonly runs: () => void;
  /** Chooses no item in the Inbox, which stands its list alone where it shows one column. */
  readonly inbox: () => void;
  /** Shuts the side panel standing over the plan, the whole pane. */
  readonly panel: () => void;
  /** Leaves the open task for the step behind it, or, where none stands behind it, for Home. */
  readonly task: () => void;
}

/** The step a page's way out goes back to, the nearest behind it on another page, as Back's list names it. */
export interface AwayStep {
  readonly title: StepTitle | undefined;
}

/** What Back and Forward draw of a trail: whether each can go, the steps each lists, and the step a page's way out goes back to. */
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

/** Whether two titles read alike, their panes' tabs among them. */
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

/** Whether two readings draw the same buttons, lists, and way out. */
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

/** The window's history, with the way a restore leaves a plan's version history and a page's way out. */
export interface WindowHistory extends NavigationHistory {
  /** Leaves the version history for its task: a step back where the task is the step behind, else a visit. */
  onLeaveVersionHistory: () => void;
  /** The step `onLeave` goes back to; none where no step behind stands on another page. */
  away: AwayStep | undefined;
  /**
   * Leaves the page standing for the nearest step behind it on another page,
   * passing over the page's own panes and tabs, as a phone's way back out of
   * a task goes back to the list it was opened from and pushes nothing;
   * where none stands, as on a task a link loaded, it opens Home.
   */
  onLeave: () => void;
}

/** The window's history with the narrow screens' ways back to their lists, which the root hands the screens. */
export interface WindowHistoryLists extends WindowHistory {
  readonly lists: ListBacks;
}

/**
 * The Tasks tab with its screens' ways back to their lists through the
 * history, as the shell draws them. A side panel standing only full screen,
 * a narrow room's, is shut the same way by each of its ways out: its
 * toggle, which reads Close panel, leaving full screen, the window's Escape,
 * and closing the last tab its strip draws, which closes the tab as ever and
 * then shuts the panel through the history rather than as a step of its own.
 * The window's Escape on an open task, past a panel filling the window, is
 * the toolbar's Back: one step back, to the page the task was opened from,
 * and the task is left as ever only where no step stands behind it.
 */
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

/**
 * The trail a window keeps beside its router's history, whose public face
 * names only the entry standing. Each step is written into the router's
 * history at its address, its place and number saved beside it
 * (`SavedStep`), so a reload or a browser's Back and Forward land on the
 * step it was. `base` is the number of the first step held, so the step at
 * `n` is saved as `base + n`, and a number never seen is minted past every
 * one that was (`highest`), so a step written after landing somewhere
 * unknown never takes the number of one the history still holds. A move
 * along a browser's history lands later, on its `popstate`: the trail stands
 * at once, and a write made before the move lands waits for it
 * (`traveling`, `waiting`), because the browser would put it on the entry it
 * is leaving. `writing` marks the window's own writes, which its listener
 * does not follow.
 */
interface WindowTrail {
  readonly history: RouterHistory;
  trail: Trail;
  base: number;
  highest: number;
  traveling: number | undefined;
  readonly waiting: (() => void)[];
  writing: boolean;
  readonly listeners: Set<() => void>;
}

/** Each router history's trail, kept for as long as the history is. */
const trails = new WeakMap<RouterHistory, WindowTrail>();

/** The step saved in `location`'s entry; none in an entry no window wrote, or wrote before the router held its history. */
function savedStepOf(location: HistoryLocation): SavedStep | undefined {
  const { step } = location.state;
  return isSavedStep(step) ? step : undefined;
}

/** Whether `location`'s entry holds a step a window saved, which a page loaded or landed there reopens rather than opening its address as a link. */
export function savesStep(location: HistoryLocation): boolean {
  return savedStepOf(location) !== undefined;
}

/** Stands the trail on `next`, telling every listener, unless it is the trail standing. */
function standTrail(held: WindowTrail, next: Trail): void {
  if (next.entries === held.trail.entries && next.at === held.trail.at) return;
  held.trail = next;
  for (const listener of [...held.listeners]) listener();
}

/** Runs what waits on the router's history, in order, until a move travels. */
function drainTrail(held: WindowTrail): void {
  while (held.traveling === undefined) {
    const next = held.waiting.shift();
    if (next === undefined) return;
    next();
  }
}

/** Runs `step` on the router's history once no move of the window's travels. */
function inTurn(held: WindowTrail, step: () => void): void {
  held.waiting.push(step);
  drainTrail(held);
}

/** Writes `entry` into the router's history as the trail's step at `at`, its place and number saved beside it. */
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

/** Stands `entries` with `at` among them, dropping the oldest past the bound. */
function keepTrail(held: WindowTrail, entries: readonly TrailEntry[], at: number): Trail {
  const dropped = Math.max(0, entries.length - TRAIL_LIMIT);
  held.base += dropped;
  return { entries: entries.slice(dropped), at: at - dropped };
}

/** The trail on `location`'s entry with none around it known, as a page reloaded there starts; empty on an entry holding no step. */
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

/** Where the router's history landing on `location` leaves the trail: on a step held, beside the steps held, or alone. */
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

/**
 * The trail following the router's history where something other than the
 * window moved it: a browser's Back or Forward, or the arrival of a move of
 * the window's own, which already stands and only lets what waits on it
 * through. Landing elsewhere than that move went is the browser's word over
 * the window's: with nothing waiting the steps held stay around where it
 * landed, and otherwise what waited to be written after the move is dropped,
 * and with it what the steps around knew.
 */
function hear(held: WindowTrail, location: HistoryLocation, moved: boolean): void {
  if (held.writing) return;
  if (!moved || held.traveling === undefined) {
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

/** The trail kept beside `history`, made as the window first reads it, on the step a reloaded page's entry saved. */
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
    listeners: new Set(),
  };
  held.trail = aloneOn(held, history.location);
  history.subscribe(({ location, action }) =>
    hear(held, location, action.type !== "PUSH" && action.type !== "REPLACE"),
  );
  trails.set(history, held);
  return held;
}

/** Hears every change of the trail; answers the way to stop. */
function listenTo(held: WindowTrail, listener: () => void): () => void {
  held.listeners.add(listener);
  return () => held.listeners.delete(listener);
}

/** Writes `write` into the trail and through to the router's history; a push on an empty trail takes the entry the history stands on, which holds no step. */
function recordTrail(held: WindowTrail, write: TrailWrite): void {
  const pushed = write.kind === TRAIL_WRITE.PUSH && held.trail.at >= 0;
  const next = written(held.trail, write);
  if (pushed) held.base += held.trail.at + 2 - next.entries.length;
  writeThrough(held, pushed ? TRAIL_WRITE.PUSH : TRAIL_WRITE.REPLACE, write.entry, next.at);
  standTrail(held, next);
}

/**
 * Stands the trail `delta` steps along and moves the router's history there,
 * once what was written before it has reached the browser (`flush`), so the
 * move counts from the entry the trail counts from; nothing where no step
 * stands there.
 */
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

/** The entry a trail stands on, while one does. */
function standingOf(trail: Trail): TrailEntry | undefined {
  return trail.entries[trail.at];
}

/**
 * The history over where the window stands, held in the trail kept beside
 * the window's router history (`WindowTrail`). `place` is nothing until the window knows where it is, so a
 * launch records no page it never showed. `reachable` says whether a place
 * can still be gone to — a deleted task cannot — and `go` takes the window
 * there; the move's own arrival is then recognized as the place the history
 * already stands on, and records nothing.
 *
 * The router's history may move by itself, as a browser's Back and Forward
 * move it, and the window follows: it goes to the step the trail lands on, so its
 * arrival records nothing and the steps ahead are kept. A step it cannot
 * reach is passed over the way the move went, as the window's own step
 * passes over one, and an entry holding no step at all is a page loaded
 * there, which opens on Home. Note that such a move has already happened
 * when the window hears it and cannot be refused, so while a page holds
 * unsaved work the trail is stood back on the window's step first, along
 * the trail or, where the trail no longer holds it, written again after
 * where the trail stands, and the move is made again only once the
 * developer says to leave. A window whose trail
 * already stands on a step when it first knows where it is, as a reloaded
 * tab's does, goes there rather than recording where it first stood.
 */
function useHistory(input: {
  /** The trail kept beside the window's router history. */
  held: WindowTrail;
  place: Place | undefined;
  /** The address the place stands at. */
  address: string;
  reachable: (place: Place) => boolean;
  /** What a place is called as Back's and Forward's lists name it now. */
  named: (place: Place) => StepTitle | undefined;
  go: (place: Place) => void;
  /** Asks first, while a page holds unsaved work, before a step moves the trail at all. */
  guard: LeaveGuard["guard"];
  /** How many times a door naming a thing opened it in the side panel (`SidePanelControl.opened`). */
  opened: number;
}): NavigationHistory & {
  backTo: (place: Place) => boolean;
  upTo: (place: Place, stand: () => void) => void;
  /** Stands the window on `place` by `stand`, its step taking the step standing in place rather than adding one. */
  inPlace: (place: Place, stand: () => void) => void;
  /** A step back, answering whether one stood behind to take, though the leave ask may yet hold it. */
  stepBack: () => boolean;
  /** The step behind on another page (`awayFrom`), where one stands. */
  away: AwayStep | undefined;
  /** Goes back to that step, answering whether one stood there to go to. */
  stepAway: () => boolean;
} {
  const { held, place, address, reachable, named, guard, opened } = input;
  // Note that the presses read the trail as they land, because a
  // key can land between a move and the render that shows it, and the latest
  // `place`, `reachable`, `go`, and `guard` through a ref, so a press stays the same
  // function across renders.
  const latest = useRef({ place, reachable, go: input.go, guard, opened });
  useLayoutEffect(() => {
    latest.current = { place, reachable, go: input.go, guard, opened };
  });
  // The list a narrow screen went up to with no step behind, which the next visit takes in place.
  const wentUp = useRef<Place | undefined>(undefined);
  // How many presses and keys the window has heard, and how many it had as it last wrote the trail.
  const presses = useRef(0);
  const pressesWritten = useRef(0);
  // How many opens the side panel had as the window last wrote the trail.
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
  // The entry the window stands on, as it last wrote or followed the trail, and whether it is writing it now.
  const standing = useRef<TrailEntry | undefined>(undefined);
  const writing = useRef(false);
  // What Back and Forward draw, read from the trail as it stands once the
  // visit to `place` below is written, and held while it reads the same.
  // Note that the window follows this reading rather than the trail itself,
  // because the visit is written after the place has drawn, and a trail
  // followed whole draws the whole window again, mid-glide, for the step it
  // already drew; a write that reads otherwise still draws it.
  const drawn = useRef<HistoryReading | undefined>(undefined);
  // The place and address the visit below last ran for, which it runs for again only once either moves.
  const visited = useRef<{ place: Place | undefined; address: string } | undefined>(undefined);
  const subscribe = useCallback((listener: () => void) => listenTo(held, listener), [held]);
  const reading = useSyncExternalStore(subscribe, () => {
    const trailNow = held.trail;
    const moved = visited.current?.place !== place || visited.current?.address !== address;
    // A window first knowing where it stands on a trail that already stands somewhere goes there rather than writing.
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

  // A write of the window's own, which the trail's listener below is not to follow.
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
    // An entry holding no step is a page loaded there, which opens on Home; the window already there writes its step on it.
    const arriveNowhere = (was: TrailEntry) => {
      const home: Place = { kind: PLACE_KIND.HOME };
      if (sameStep(was.state, home)) {
        own(() => recordTrail(held, { kind: TRAIL_WRITE.PUSH, entry: was }));
      } else latest.current.go(home);
    };
    // The window following the trail where the router's history moved it, asking first, or standing it back on the window's step where it may not go.
    const follow = (moved: Trail, was: TrailEntry) => {
      const from = moved.entries.indexOf(was);
      const arrived = standingOf(moved);
      const way = from >= 0 && moved.at > from ? 1 : -1;
      const { reachable: canReach } = latest.current;
      const at =
        arrived === undefined || canReach(arrived.state) ? moved.at : nearest(moved, way, canReach);
      const target = at === undefined ? undefined : moved.entries[at];
      // Back to the window's step: along the trail where it still holds it, else written again after where the trail stands.
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
      const was = standing.current;
      if (writing.current || was === undefined || standingOf(moved) === was) return;
      follow(moved, was);
    });
  }, [held, own]);

  // Note that the whole step is what asks, the trail's move with the window's, so a step
  // canceled at the ask leaves the trail standing where the window still stands. It
  // answers whether a step stood there, asked about or taken.
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

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const trail = held.trail;
    const at = nearest(trail, -1, latest.current.reachable);
    if (at === undefined || !sameStep(trail.entries[at]?.state, to)) return false;
    step(-1);
    return true;
  };

  // Up to `to` from an item over it: a step back where it is the step behind, else
  // `stand` taking the step in place. Note that a window on no item over `to` only
  // stands, as `stand` then moves it to no new step, so a step behind is never
  // gone back to and no visit later takes another's step in place.
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

  // Note that this is the mark `upTo` sets where no step stands behind, so the visit it leads to takes the step in place.
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

/** The step behind on another page (`awayFrom`), as a way out names it now. */
function awayStep(
  trail: Trail,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): AwayStep | undefined {
  const at = awayFrom(trail, reachable);
  const place = at === undefined ? undefined : trail.entries[at]?.state;
  return place === undefined ? undefined : { title: named(place) };
}

/**
 * The window's history: Tasks on the task it is bound for — the one asked
 * for, so a move waiting on the host's answer is already where it is going —
 * or on that plan's version history, or the Inbox, or Settings on its page. A task the
 * account's list once held and holds no more is passed over, unless the list
 * itself could not be read, or it is the task the window is bound for. Note that a
 * task no list has held yet is still a place, because the list may not have
 * landed or may not yet carry a task just started; a task that cannot be read
 * is a place too, and says so when it is gone back to. Going to a place
 * changes the tab only when it must, so a tab change is counted as any other.
 * A version history is gone back to where it stood, on its version and with
 * its sections as they were. In a narrow room, each place shown one pane at
 * a time is gone back to on the pane it showed.
 */
export function useWindowHistory(input: {
  /** Whether the window knows where it stands: its state has arrived, and no sign-in stands over it. */
  known: boolean;
  /** The link of the step the window stands on, as Copy link names it (`CopyLink.standing`); none where it has none. */
  link: ReadLink | undefined;
  /** What the step the window stands on is called, as Back's and Forward's lists name it; none where nothing names it. */
  title?: StepTitle | undefined;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  settingsView: SettingsView;
  onSettingsViewChange: (view: SettingsView) => void;
  /** Whether Settings stands on its page list rather than its page, which only a narrow room draws apart. */
  settingsListed: boolean;
  /** Stands Settings on its page list. */
  onSettingsList: () => void;
  /** The room the panel's stage gives, narrow where it shows one pane at a time. */
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
    | "adminView"
    | "leaveGuard"
    | "sidePanel"
    | "mainTabs"
    | "activeTaskId"
    | "agents"
    | "pages"
  >;
}): WindowHistoryLists {
  const { tab, settingsView, settingsListed, tasks } = input;
  const narrow = input.room === SHELL_ROOM.NARROW;
  const { boundFor } = tasks;
  const historyOpen = tasks.history.open;
  const { spot } = tasks.history;
  const inboxOpen = tasks.inboxView.open;
  // An Inbox showing one column, by its own width or a narrow room's, stands its item alone, or its list while none is chosen.
  const inboxSingle = narrow || tasks.inboxView.single === true;
  // The item chosen is a step of its own wherever it shows: alone in one column, or beside the list where the Inbox splits.
  const inboxChosen = tasks.inboxView.chosen;
  const inboxListed = inboxSingle ? inboxChosen === undefined : undefined;
  // A task chosen narrows the Inbox to its items, a step of its own.
  const narrowedTask = useInboxTask();
  const inboxTask = inboxOpen ? narrowedTask : undefined;
  const historyListed = narrow ? tasks.history.listed : undefined;
  const panelOpen = tasks.sidePanel.open;
  const panelTab = panelOpen ? tasks.sidePanel.tab : undefined;
  // The strips are the open task's, which is the one bound for once it has opened and its agents are read, so a task on its way holds no tab of the one before it.
  const stripsKnown = boundFor !== undefined && tasks.activeTaskId === boundFor;
  // The column's tabs are known only once the task's agents are read, the side panel's at once.
  const columnKnown = stripsKnown && tasks.mainTabs.openAgents !== undefined;
  const columnTab = columnKnown ? tasks.mainTabs.tab : undefined;
  // A narrow room holds the side panel as a pane of its own over the plan (`panel`), whose tab its step keeps as it always has.
  const sideTab = stripsKnown && !narrow ? panelTab : undefined;
  // The side panel as the stop standing holds it: its tab while open, and shut otherwise.
  const sideHeld = panelTab ?? null;
  const taskSide = stripsKnown && !narrow ? sideHeld : undefined;
  // The tabs each task's column stood with as the window last stood on it, so a step on a tab since closed is passed over.
  // Note that a task reopened before its agents are read keeps the column it was last seen with.
  const knownColumns = useRef(new Map<string, ReadonlySet<string>>()).current;
  if (columnKnown && !inboxOpen && !historyOpen) {
    knownColumns.set(boundFor, new Set(tasks.mainTabs.tabs.map(tabKey)));
  }
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const personName = tasks.personView.name;
  const listedWorkspace = tasks.workspace?.id;
  const automationsOpen = tasks.automationsView.open;
  const automationsPage = tasks.automationsView.place;
  // A narrow room stands an automation's runs alone over its setup, as a step of their own.
  const automationRuns =
    narrow && !automationsTab(automationsPage) ? tasks.automationsView.runs : undefined;
  const experiments = useExperimentChoices();
  const boardOpen = tasks.boardView.open;
  const unknownWorkspace = tasks.unknownWorkspace.open;
  const adminOpen = tasks.adminView.open;
  const adminView = tasks.adminView.view;
  // A reloaded tab's Admin step is reachable while the account's access is still being read, as the place waits on it.
  const adminOn = useAdminAccess();
  const adminPending = useAdminAccessPending();
  const adminAccess = adminOn || adminPending;
  const known = input.known;
  // Only grows, so writing it as the list is drawn is the same on every render.
  const everListed = useRef(new Set<string>()).current;
  for (const task of tasks.tasks) everListed.add(task.id);
  // Only grows the same way: every automation the window has seen deleted.
  const deletedAutomations = useRef(new Set<string>()).current;
  if (automationsPage.kind === AUTOMATIONS_PAGE.LIST && automationsPage.deleted !== undefined) {
    deletedAutomations.add(automationsPage.deleted);
  }
  const titleLabel = input.title?.label;
  const titleDetail = input.title?.detail;
  const titleColumn = input.title?.panes?.column;
  const titleSide = input.title?.panes?.side;
  const untitled = useMemo((): Place | undefined => {
    // A workspace's address naming none of the reader's is no place of theirs to come back to, so it is no step, and the tab keeps its address.
    if (!known || unknownWorkspace) return undefined;
    if (tab === PANEL_TAB.SETTINGS) {
      return {
        kind: PLACE_KIND.SETTINGS,
        view: settingsView,
        listed: narrow ? settingsListed : undefined,
      };
    }
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
    if (pagePerson !== undefined) {
      return {
        kind: PLACE_KIND.PERSON,
        userId: pagePerson,
        name: personName,
        workspaceId: listedWorkspace,
      };
    }
    if (automationsOpen) {
      return {
        kind: PLACE_KIND.AUTOMATIONS,
        page: automationsPage,
        workspaceId: listedWorkspace,
        runs: automationRuns,
      };
    }
    if (boardOpen) return { kind: PLACE_KIND.BOARD, workspaceId: listedWorkspace };
    if (adminOpen) return { kind: PLACE_KIND.ADMIN, view: adminView };
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
    tab,
    settingsView,
    settingsListed,
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
    pagePerson,
    personName,
    listedWorkspace,
    automationsOpen,
    automationsPage,
    automationRuns,
    boardOpen,
    adminOpen,
    adminView,
  ]);
  // Each surface the place shows is counted as it opens, from here rather than from the doors that open it, as the history is written.
  useSurfaceOpen(
    useMemo(() => {
      const beside =
        sideTab === undefined || boundFor === undefined
          ? undefined
          : tabSurface(boundFor, sideTab, true);
      return surfacesOf(untitled, columnKnown, beside);
    }, [untitled, columnKnown, sideTab, boundFor]),
    input.room,
  );
  // An Inbox narrowed to a task is named by the task, every item it shows being that task's.
  const inboxTaskName =
    inboxTask === undefined ? undefined : tasks.tasks.find((task) => task.id === inboxTask)?.name;
  const place = useMemo((): Titled | undefined => {
    if (untitled === undefined || titleLabel === undefined) return untitled;
    const label = { label: titleLabel, detail: titleDetail ?? inboxTaskName };
    const panes = { column: titleColumn, side: titleSide };
    const unnamed = titleColumn === undefined && titleSide === undefined;
    return { ...untitled, title: unnamed ? label : { ...label, panes } };
  }, [untitled, titleLabel, titleDetail, titleColumn, titleSide, inboxTaskName]);
  // Whether the column's tab a task's step showed still stands on its strip, as far as the window last saw it; a task not seen since is taken to.
  // Note that the side panel's tab is not asked after, because going to the step opens it again, as a link opens a preview another took the place of.
  const tabsStand = (to: Extract<Place, { kind: typeof PLACE_KIND.TASK }>) => {
    const column = knownColumns.get(to.taskId);
    return to.column === undefined || column === undefined || column.has(tabKey(to.column));
  };
  const reachable = (to: Place) => {
    // The Admin place is an admin's alone, so back and forward pass over it for an account that is no admin.
    if (to.kind === PLACE_KIND.ADMIN) return adminAccess;
    // An automation's page is of the workspace it stood in, whose automations alone it reads, so Back passes over it once another is listed, and once it is deleted.
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      if (to.page.kind !== AUTOMATIONS_PAGE.EDIT) return true;
      return to.workspaceId === listedWorkspace && !deletedAutomations.has(to.page.automationId);
    }
    // A Settings page an experiment holds, such as Memory, stands only while the account has it on.
    if (to.kind === PLACE_KIND.SETTINGS) return settingsPageExperimentStands(to.view, experiments);
    // A task's version history is the plan's, which stands only while the account has Plans on.
    if (to.kind === PLACE_KIND.VERSION_HISTORY && !experimentOn(experiments, EXPERIMENT.PLANS)) {
      return false;
    }
    // The Board is a workspace's tasks, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.BOARD) return to.workspaceId === listedWorkspace;
    // A person's page is theirs in the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.PERSON) return to.workspaceId === listedWorkspace;
    if (to.kind === PLACE_KIND.TASK && !tabsStand(to)) return false;
    // Note that an Inbox narrowed to a task is passed over once the task is deleted, as the task's own step is.
    if (!("taskId" in to) || to.taskId === undefined || to.taskId === boundFor) return true;
    return (
      tasks.listFailed ||
      !everListed.has(to.taskId) ||
      tasks.tasks.some((task) => task.id === to.taskId)
    );
  };
  const go = (to: Place) => {
    if (to.kind === PLACE_KIND.SETTINGS) {
      if (tab !== PANEL_TAB.SETTINGS) input.onTabChange(PANEL_TAB.SETTINGS);
      input.onSettingsViewChange(to.view);
      if (to.listed === true) input.onSettingsList();
      return;
    }
    // Note that a version history stands on screen only on the Tasks tab, which is read before it is turned to.
    const historyStanding = tab === PANEL_TAB.TASKS && historyOpen && spot !== undefined;
    if (tab !== PANEL_TAB.TASKS) input.onTabChange(PANEL_TAB.TASKS);
    if (to.kind === PLACE_KIND.INBOX) {
      // Note that a task's step holding no item opens it afresh, so no item chosen in a later step stands over it.
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
    if (to.kind === PLACE_KIND.PERSON) {
      tasks.personView.onOpen(to.userId, to.name);
      return;
    }
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      // A narrow room's step within the automation standing moves between its setup and its runs, rather than opening it again;
      // one that also marks another run of the same automation, as a run's link does, opens it on that run past the ask,
      // since it keeps the draft.
      const here: Place = {
        kind: PLACE_KIND.AUTOMATIONS,
        page: automationsPage,
        workspaceId: listedWorkspace,
      };
      const sameDraft = automationsOpen && samePage(here, to);
      if (!sameDraft) {
        tasks.automationsView.onOpen(to.page, to.runs);
      } else if (!sameAutomationsOpening(automationsPage, to.page)) {
        tasks.leaveGuard.pass(() => tasks.automationsView.onOpen(to.page, to.runs));
      } else if (to.runs !== undefined) {
        tasks.automationsView.onRuns(to.runs);
      }
      return;
    }
    if (to.kind === PLACE_KIND.BOARD) {
      tasks.boardView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.ADMIN) {
      tasks.adminView.onOpen(to.view);
      return;
    }
    // Every other place of the Plans tab is the plan's, which the Inbox, an agent's or a person's page, the Admin place, the Automations page, and the Board stand over.
    if (inboxOpen) tasks.inboxView.onClose();
    if (pageAgent !== undefined) tasks.agentView.onClose();
    if (pagePerson !== undefined) tasks.personView.onClose();
    if (automationsOpen) tasks.automationsView.onClose();
    if (boardOpen) tasks.boardView.onClose();
    if (adminOpen) tasks.adminView.onClose();
    // Note that a version history is opened on its spot even where it is
    // still open under Settings, because a version history out of sight
    // keeps no version chosen.
    // A narrow room's step within the version history standing moves it, rather than opening it again.
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
  // The side panel as a wide step, an Inbox item's, or an agent page's held it: shut, or open on its tab, on the stop's own task or agent; one not yet known is left as it stands.
  const standSide = (holder: string | undefined, side: SideStep) => {
    if (side === null) tasks.sidePanel.onSetOpen(false);
    else if (side !== undefined && holder !== undefined) tasks.sidePanel.onShow(holder, side);
  };
  // The side panel as a narrow room's step held it: shut, or open on its tab.
  const standPanel = (taskId: string, panel: PanelStep) => {
    const { sidePanel } = tasks;
    if (panel.open && panel.tab !== undefined) sidePanel.onShow(taskId, panel.tab);
    else sidePanel.onSetOpen(panel.open);
  };
  // The workspace's members, read only while a person's page stands on the trail, whose step is listed by the name they go by now.
  // Note that the place standing counts as on the trail already, so its visit, written after it draws, draws the window no second time.
  const personStanding = untitled?.kind === PLACE_KIND.PERSON;
  const held = trailOf(useRouter().history);
  const subscribeTrail = useCallback((listener: () => void) => listenTo(held, listener), [held]);
  const personListed = useSyncExternalStore(
    subscribeTrail,
    () =>
      personStanding || held.trail.entries.some((entry) => entry.state.kind === PLACE_KIND.PERSON),
  );
  const members = useHostRead(
    LIVE_READ.WORKSPACE_MEMBERS,
    personListed ? tasks.workspace?.id : undefined,
  ).rows?.members;
  const named = (to: Place) => liveStepTitle(namedStepOf(to), titleOf(to), tasks, members);
  const { backTo, upTo, inPlace, stepBack, stepAway, ...history } = useHistory({
    held,
    place,
    address: addressOf(input.link),
    reachable,
    named,
    go,
    guard: tasks.leaveGuard.guard,
    opened: tasks.sidePanel.opened,
  });
  // A phone has no Home: wherever the window would stand on it, it stands on
  // the Inbox's list (`mobile-bar.tsx`), which takes Home's step in place, so
  // Back never lands on a Home that would only leave again.
  const homeOnPhone = narrow && tasks.signedIn && untitled?.kind === PLACE_KIND.HOME;
  const openInbox = tasks.inboxView.onOpen;
  useEffect(() => {
    if (homeOnPhone) inPlace({ kind: PLACE_KIND.INBOX, listed: true }, openInbox);
  }, [homeOnPhone, inPlace, openInbox]);
  // Note that only a narrow room holds a list as a step of its own, so a wide one only stands it.
  const up = (to: Place, stand: () => void) => (narrow ? upTo(to, stand) : stand());
  // Note that the history is handed back steady, its ways back among it, so the screens it is handed hold while nothing they read moves.
  const lists = useSteadyDoorSet<ListBacks>({
    settings: () =>
      up({ kind: PLACE_KIND.SETTINGS, view: settingsView, listed: true }, input.onSettingsList),
    versions: () =>
      boundFor === undefined
        ? tasks.history.onList()
        : up(
            { kind: PLACE_KIND.VERSION_HISTORY, taskId: boundFor, spot, listed: true },
            tasks.history.onList,
          ),
    runs: () =>
      up(
        {
          kind: PLACE_KIND.AUTOMATIONS,
          page: automationsPage,
          workspaceId: listedWorkspace,
          runs: false,
        },
        () => tasks.automationsView.onRuns(false),
      ),
    // Note that the Inbox's list is a step of its own wherever the Inbox shows one column, a room wider than a narrow one's included.
    // Note that the list stepped back to is under the task the Inbox stands narrowed to, as its step is.
    inbox: () => {
      const stand = () => tasks.inboxView.onClear();
      const list = { kind: PLACE_KIND.INBOX, listed: true } as const;
      const narrowed = inboxTask === undefined ? list : { ...list, taskId: inboxTask };
      if (inboxSingle) upTo(narrowed, stand);
      else stand();
    },
    panel: () => {
      const shut = () => tasks.sidePanel.onSetOpen(false);
      // Note that a phone's panel a link opened over an Inbox item or an agent's page steps back to it shut, where that is the step behind.
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
    // Note that a task with no step behind it, as one a reloaded tab or a link loaded, is left as ever.
    task: () => {
      if (!stepBack()) tasks.onLeaveTask();
    },
  });
  return useSteadyDoors({
    ...history,
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

/**
 * The mouse's own back and forward buttons, the fourth and fifth, answered
 * while `enabled` as a browser answers them. Note that each press it answers
 * is canceled, because Chromium takes a Back or Forward of its own on that
 * same release unless the page cancels it, and in a browser tab that would be
 * a second step after the window's.
 */
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
