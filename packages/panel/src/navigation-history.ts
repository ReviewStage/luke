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
 * The history is held by the adapter the window's root installs
 * (`@luke/ui/history-adapter`), each place as the state a step back reopens
 * it from, the way a browser's `history.state` stands beside its URL, and
 * the path of its Luke link as its address: the link Copy link names for
 * the step (`links-at-hand.ts`), so the two never disagree, or `/app` for a
 * place with none. The step standing takes its address again whenever that
 * link changes, as when a workspace's slug is read after the visit; a step
 * behind takes it when the window is back on it. The desktop keeps the
 * history in memory, and nothing there reads an address.
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
 * shows, the tab its side panel shows while open (a narrow room's panel
 * standing over the plan being a step of its own already), the
 * Inbox's item, and Chat's place, so Back goes back to what the window was
 * just showing rather than past it to the page before. Such a choice is a
 * step only where a press or a key led to it: one the window makes by
 * itself, as a task's tabs arriving after it opens, an agent's tab shown as
 * it starts, or the tab shown in place of one closed, takes the standing
 * step in place. A tab or an item not yet known, as a task's tabs on their
 * way or an Inbox with nothing chosen, fills in the step it stands in, so
 * opening the side panel on its tab adds none. A step on a tab since closed
 * is passed over, as a deleted task is, as far as the window last saw that
 * task's strips.
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
 * Settings page, a version, a Chat place over its list, or an automation's
 * runs over its setup. Each such step
 * holds its sub-step beside its place, and a wide room holds none, so two
 * places are one step there as they always were, and a room turned from one
 * to the other takes the step standing in place. Going to a step stands its
 * sub-step from the step alone, so a move the adapter makes itself, as a
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
 * as that step is (`WindowHistory`'s `away` and `onLeave`).
 */

import { linkOf, type ReadLink } from "@luke/features/link-grammar";
import type { SettingsView } from "@luke/settings/settings-views";
import { CHAT_PLACE, type ChatPlace } from "@luke/ui/chat-model";
import type { HistoryAdapter, HistoryEntry, HistorySnapshot } from "@luke/ui/history-adapter";
import { type StripTab, sameTab, tabKey } from "@luke/ui/tab-strip-model";
import { TASKS_PAGE } from "@luke/ui/tasks-model";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { ADMIN_PAGE, type AdminView } from "./admin/routing.js";
import { liveStepTitle, NAMED_STEP, type NamedStep } from "./history-titles.js";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { settingsPageExperimentStands } from "./settings/settings-rows.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { useSteadyDoorSet, useSteadyDoors } from "./steady-door.js";
import { useChatOn } from "./tasks/chat-gate.js";
import type { MainTab } from "./tasks/use-main-tabs.js";
import type { HistorySpot } from "./tasks/use-plan-history.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type InboxChoice,
  type LeaveGuard,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { useWorkspaceMembersRead } from "./tasks/use-workspace-members.js";
import { useAdminAccess, useAdminAccessPending, useExperimentChoices } from "./use-app-state.js";

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
  CHAT: "chat",
  BOARD: "board",
  SETTINGS: "settings",
  ADMIN: "admin",
} as const;

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
 * setup, and whether Settings, a version history, the Inbox, or Chat stands
 * on its list (`listed`) or the item chosen in it.
 */
type Place =
  | {
      readonly kind: typeof PLACE_KIND.TASK;
      readonly taskId: string;
      readonly panel?: PanelStep | undefined;
      /** The column's tab shown, in any room; none while the column shows no tab or its tabs are not yet the task's. */
      readonly column?: MainTab | undefined;
      /** The side panel's tab shown while it is open, in a wide room (a narrow one keeps it in `panel`); none while it is shut or its tabs are not yet the task's. */
      readonly side?: SidePanelTab | undefined;
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
    }
  | { readonly kind: typeof PLACE_KIND.AGENT; readonly agentId: string }
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
      readonly kind: typeof PLACE_KIND.CHAT;
      /** The workspace listed as Chat stood, whose chat it read. */
      readonly workspaceId: string | undefined;
      readonly listed?: boolean | undefined;
      /** The place shown: beside the rail in a wide room, which takes no step of its own, so a reload reopens it; alone in a narrow one, while one stands so. */
      readonly shown?: ChatPlace | undefined;
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
  | {
      readonly kind: typeof PLACE_KIND.ADMIN;
      readonly view: AdminView;
      /** Whether the section list stood rather than the view, in a narrow room alone. */
      readonly listed?: boolean | undefined;
    };

/** The tabs a task's strips stood with as the window last stood on it: its column's once its agents were read, and its side panel's. */
interface KnownStrips {
  readonly column: ReadonlySet<string> | undefined;
  readonly side: ReadonlySet<string>;
}

/** What a step is called where the trail is listed: what stood in the window, and what it showed there, such as a task and its tabs. */
export interface StepTitle {
  readonly label: string;
  readonly detail?: string | undefined;
}

/** A place with what it was called as the window stood on it, which no comparison of steps reads. */
type Titled = Place & { readonly title?: StepTitle | undefined };

/** The places the window has stood on, as its history adapter holds them. */
type Trail = HistorySnapshot<Place>;

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
      const taskId = chosen !== undefined && "taskId" in chosen ? chosen.taskId : undefined;
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

let installed: HistoryAdapter<Place> | undefined;

/** Whether two Automations pages are one step: the list, a new automation's page, or the same automation's, on whichever of its runs. */
function sameAutomationsPage(one: AutomationsPlace, other: AutomationsPlace): boolean {
  if (one.kind === AUTOMATIONS_PAGE.EDIT && other.kind === AUTOMATIONS_PAGE.EDIT) {
    return one.automationId === other.automationId;
  }
  return one.kind === other.kind;
}

/** Whether one Automations page stands as it was opened: a new one on the same suggestion, an automation's on the same run. */
function sameAutomationsOpening(one: AutomationsPlace, other: AutomationsPlace): boolean {
  if (one.kind === AUTOMATIONS_PAGE.NEW && other.kind === AUTOMATIONS_PAGE.NEW) {
    return one.preset === other.preset;
  }
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
    case PLACE_KIND.CHAT:
    case PLACE_KIND.SETTINGS:
    case PLACE_KIND.ADMIN:
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

/** Whether two Chat places are the same: For you, or the same channel. */
function sameChatPlace(one: ChatPlace | undefined, other: ChatPlace | undefined): boolean {
  if (one?.kind === CHAT_PLACE.CHANNEL && other?.kind === CHAT_PLACE.CHANNEL) {
    return one.channelId === other.channelId;
  }
  return one?.kind === other?.kind;
}

/** Whether two Inbox items are the same item of the same holder. */
function sameInboxChoice(one: InboxChoice | undefined, other: InboxChoice | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  const holder = (choice: InboxChoice) => ("taskId" in choice ? choice.taskId : choice.agentId);
  return one.itemId === other.itemId && holder(one) === holder(other);
}

/** Whether two side panels stand on the same tab, or none. */
function samePanelTab(one: PanelStep | undefined, other: PanelStep | undefined): boolean {
  if (one?.tab === undefined || other?.tab === undefined) return one?.tab === other?.tab;
  return sameTab(one.tab, other.tab);
}

/** Whether two places are one page, whichever of its narrow sub-steps each stands on: the same plan, the same plan's version history, the home page, the Inbox on any plan, the same agent's or person's page, the same Automations page, Chat in the same workspace, the same workspace's Board, or Settings on any page. */
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
  if (one.kind === PLACE_KIND.CHAT && other.kind === PLACE_KIND.CHAT) {
    return one.workspaceId === other.workspaceId;
  }
  if ("workspaceId" in one && "workspaceId" in other) return one.workspaceId === other.workspaceId;
  return true;
}

/** Whether an Admin view is one of the place's sections, rather than an account's or a day's page under one. */
function adminSection(view: AdminView): boolean {
  return view.kind !== ADMIN_PAGE.ACCOUNT && view.kind !== ADMIN_PAGE.DAY;
}

/**
 * Whether two Admin views are one page: any two of its sections, which
 * replace each other in place as Settings' pages do, so Back leaves the
 * place; or the same account's or day's page, each a step of its own.
 */
function samePageAdminView(one: AdminView, other: AdminView): boolean {
  if (adminSection(one) && adminSection(other)) return true;
  return sameAdminView(one, other);
}

/** Whether two Admin views are the same view. */
function sameAdminView(one: AdminView, other: AdminView): boolean {
  if (one.kind === ADMIN_PAGE.ACCOUNT && other.kind === ADMIN_PAGE.ACCOUNT)
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

/**
 * Whether two places of one page show one thing in it: the same tabs of a
 * task's column and side panel, the same Inbox item, the same Chat place.
 * Either side showing none, as a task whose tabs are on their way or an
 * Inbox with no item chosen yet, is the same, so what arrives fills in the
 * step it stands in.
 */
function sameShown(one: Place, other: Place): boolean {
  if (one.kind === PLACE_KIND.TASK && other.kind === PLACE_KIND.TASK) {
    return (
      sameOrUnknownTab(one.column, other.column) &&
      sameOrUnknownTab(one.side, other.side) &&
      sameOrUnknownTab(openPanelTab(one.panel), openPanelTab(other.panel))
    );
  }
  if (one.kind === PLACE_KIND.INBOX && other.kind === PLACE_KIND.INBOX) {
    return one.chosen === undefined || other.chosen === undefined
      ? true
      : sameInboxChoice(one.chosen, other.chosen);
  }
  if (one.kind === PLACE_KIND.CHAT && other.kind === PLACE_KIND.CHAT) {
    return one.shown === undefined || other.shown === undefined
      ? true
      : sameChatPlace(one.shown, other.shown);
  }
  return true;
}

/** Whether two places are one step of the history: one page, on one sub-step, since a narrow room's pane opened over another is a step of its own, showing one thing in it, since a tab, an Inbox item, or a Chat place chosen is a step of its own too. */
function sameStep(one: Place | undefined, other: Place): boolean {
  return (
    one !== undefined && samePage(one, other) && sameSubStep(one, other) && sameShown(one, other)
  );
}

/** Whether two places are one step but for what each shows in its page: the move between them chooses another tab, Inbox item, or Chat place on the page standing. */
function choosesWithin(one: Place | undefined, other: Place): boolean {
  return (
    one !== undefined && samePage(one, other) && sameSubStep(one, other) && !sameShown(one, other)
  );
}

/** Whether a version history stands where it stood: on the same version, with the same sections open. */
function sameSpot(one: HistorySpot | undefined, other: HistorySpot | undefined): boolean {
  return (
    one?.revision === other?.revision &&
    one?.opened?.seq === other?.opened?.seq &&
    one?.opened?.heading === other?.opened?.heading
  );
}

/** Whether a step stands as it stood: its narrow sub-step the same, the side panel on the same tab, the same Inbox item or Chat place standing alone, Settings on the same page, a version history where it was, a person's page by the name it was last opened with, an Automations page as it was opened. */
function samePlace(one: Place, other: Place): boolean {
  // A room turned takes the step standing in place, with its sub-step or without.
  if (subStepOf(one) !== subStepOf(other)) return false;
  if (one.kind === PLACE_KIND.TASK && other.kind === PLACE_KIND.TASK) {
    return (
      samePanelTab(one.panel, other.panel) &&
      sameTabOrNone(one.column, other.column) &&
      sameTabOrNone(one.side, other.side)
    );
  }
  if (one.kind === PLACE_KIND.INBOX && other.kind === PLACE_KIND.INBOX) {
    return sameInboxChoice(one.chosen, other.chosen);
  }
  if (one.kind === PLACE_KIND.CHAT && other.kind === PLACE_KIND.CHAT) {
    return sameChatPlace(one.shown, other.shown);
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
 * The address of a place with no link: the home page, the Board, a new
 * automation's page.
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
 * Records the window standing on `place`, at `address`. A step already
 * standing is left as it is, but for a Settings page turned or a version
 * history moved within, which the standing step takes in place, and so does
 * the automation a new automation's page made, and an address changed under
 * it, and so does `up`, a list a narrow screen went up to from its item where
 * the list was no step behind. A tab, an Inbox item, or a Chat place chosen
 * within the page standing is a visit only where a press or a key led to it
 * (`pressed`): one the window chose by itself, as a task's tabs arriving
 * after it opens, an agent's tab shown as it starts, or the tab chosen in
 * place of one closed, takes the standing step in place. Any other place is
 * a visit, whichever door opened it.
 */
function visit(
  history: HistoryAdapter<Place>,
  place: Place,
  address: string,
  up: Place | undefined,
  pressed: boolean,
): void {
  const trail = history.current();
  const standing = trail.entries[trail.at];
  const entry: HistoryEntry<Place> = { address, state: place };
  const wentUp = up !== undefined && sameStep(up, place);
  // A tab, an item, or a place chosen within the page standing that no press or key led to is the window settling, not a visit.
  const settling = !pressed && choosesWithin(standing?.state, place);
  if (standing !== undefined && (wentUp || settling || madeFromNew(standing.state, place))) {
    history.replace(entry);
    return;
  }
  if (standing !== undefined && sameStep(standing.state, place)) {
    if (
      !samePlace(standing.state, place) ||
      !sameTitle(standing.state, place) ||
      standing.address !== address
    ) {
      history.replace(entry);
    }
    return;
  }
  history.push(entry);
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
 * Whether two places are one draft's: one page, and for a new automation's
 * page the same suggestion, since one opened from another suggestion starts
 * another draft.
 */
function sameDraftPage(one: Place, other: Place): boolean {
  if (!samePage(one, other)) return false;
  if (one.kind !== PLACE_KIND.AUTOMATIONS || other.kind !== PLACE_KIND.AUTOMATIONS) return true;
  return one.page.kind !== AUTOMATIONS_PAGE.NEW || sameAutomationsOpening(one.page, other.page);
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
  return place !== undefined && to !== undefined && sameDraftPage(place, to)
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
  /** Stands the Admin place's section list from a view standing alone. */
  readonly admin: () => void;
  readonly chat: () => void;
  /** Stands an automation's setup again from its runs. */
  readonly runs: () => void;
  /** Stands the Inbox's list alone, or its item. */
  readonly inbox: (listed: boolean) => void;
  /** Shuts the side panel standing over the plan, the whole pane. */
  readonly panel: () => void;
  /** Leaves the open task for the step behind it, or, where none stands behind it, for the page the window rests on. */
  readonly task: () => void;
}

/** The step a page's way out goes back to, the nearest behind it on another page, as Back's list names it. */
export interface AwayStep {
  readonly title: StepTitle | undefined;
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
   * where none stands, as on a task a link loaded, it opens the Tasks page.
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
    chatView: { ...tasks.chatView, onList: lists.chat },
    adminView: { ...tasks.adminView, onList: lists.admin },
    inboxView: { ...tasks.inboxView, onListed: lists.inbox },
    automationsView: {
      ...tasks.automationsView,
      onRuns: (shown) => (shown ? tasks.automationsView.onRuns(true) : lists.runs()),
    },
  };
}

/** Installs the history this window keeps; its root does this once, before anything is drawn, and calls what it answers as it closes. */
export function installWindowHistory(history: HistoryAdapter<Place>): () => void {
  installed = history;
  return () => {
    if (installed === history) installed = undefined;
  };
}

/** The history this window's root installed. */
function windowHistory(): HistoryAdapter<Place> {
  if (installed === undefined) throw new Error("No history is installed in this window.");
  return installed;
}

/** The entry a trail stands on, while one does. */
function standingOf(trail: Trail): HistoryEntry<Place> | undefined {
  return trail.entries[trail.at];
}

/**
 * The history over where the window stands, held by the window's history
 * adapter. `place` is nothing until the window knows where it is, so a
 * launch records no page it never showed. `reachable` says whether a place
 * can still be gone to — a deleted task cannot — and `go` takes the window
 * there; the move's own arrival is then recognised as the place the history
 * already stands on, and records nothing.
 *
 * The adapter may move by itself, as a browser's Back and Forward move it,
 * and the window follows: it goes to the step the adapter stands on, so its
 * arrival records nothing and the steps ahead are kept. A step it cannot
 * reach is passed over the way the move went, as the window's own step
 * passes over one, and an entry holding no step at all is a page loaded
 * there, which opens where the window rests with no task open. Note that such a move has already happened
 * when the window hears it and cannot be refused, so while a page holds
 * unsaved work the adapter is stood back on the window's step first, along
 * the trail or, where the trail no longer holds it, written again after
 * where the trail stands, and the move is made again only once the
 * developer says to leave. A window whose adapter
 * already stands on a step when it first knows where it is, as a reloaded
 * tab's does, goes there rather than recording where it first stood.
 */
function useHistory(input: {
  place: Place | undefined;
  /** The address the place stands at. */
  address: string;
  reachable: (place: Place) => boolean;
  /** What a place is called as Back's and Forward's lists name it now. */
  named: (place: Place) => StepTitle | undefined;
  go: (place: Place) => void;
  /** Asks first, while a page holds unsaved work, before a step moves the trail at all. */
  guard: LeaveGuard["guard"];
}): NavigationHistory & {
  backTo: (place: Place) => boolean;
  upTo: (place: Place, stand: () => void) => void;
  /** A step back, answering whether one stood behind to take, though the leave ask may yet hold it. */
  stepBack: () => boolean;
  /** The step behind on another page (`awayFrom`), where one stands. */
  away: AwayStep | undefined;
  /** Goes back to that step, answering whether one stood there to go to. */
  stepAway: () => boolean;
} {
  const { place, address, reachable, named, guard } = input;
  const history = windowHistory();
  const trail = useSyncExternalStore(history.subscribe, history.current);
  // Note that the presses read the trail from the adapter as they land, because a
  // key can land between a move and the render that shows it, and the latest
  // `place`, `reachable`, `go`, and `guard` through a ref, so a press stays the same
  // function across renders.
  const latest = useRef({ place, reachable, go: input.go, guard });
  useLayoutEffect(() => {
    latest.current = { place, reachable, go: input.go, guard };
  });
  // The list a narrow screen went up to with no step behind, which the next visit takes in place.
  const wentUp = useRef<Place | undefined>(undefined);
  // How many presses and keys the window has heard, and how many it had as it last wrote the trail.
  const presses = useRef(0);
  const pressesWritten = useRef(0);
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
  const standing = useRef<HistoryEntry<Place> | undefined>(undefined);
  const writing = useRef(false);

  // A write of the window's own, which the adapter's listeners are not to follow.
  const own = useCallback(
    (write: () => void) => {
      writing.current = true;
      try {
        write();
      } finally {
        writing.current = false;
      }
      pressesWritten.current = presses.current;
      standing.current = standingOf(history.current());
    },
    [history],
  );

  useEffect(() => {
    const up = wentUp.current;
    wentUp.current = undefined;
    if (place === undefined) return;
    const held = standingOf(history.current());
    if (standing.current === undefined && held !== undefined) {
      standing.current = held;
      if (latest.current.reachable(held.state)) latest.current.go(held.state);
      return;
    }
    const pressed = presses.current !== pressesWritten.current;
    own(() => visit(history, place, address, up, pressed));
  }, [history, place, address, own]);

  useEffect(() => {
    // An entry holding no step is a page loaded there, which opens where the window rests; the window already there writes its step on it.
    const arriveNowhere = (was: HistoryEntry<Place>) => {
      const home: Place = { kind: PLACE_KIND.HOME };
      if (sameStep(was.state, home)) own(() => history.push(was));
      else latest.current.go(home);
    };
    // The window following the adapter where it moved, asking first, or standing it back on the window's step where it may not go.
    const follow = (moved: Trail, was: HistoryEntry<Place>) => {
      const from = moved.entries.indexOf(was);
      const arrived = standingOf(moved);
      const way = from >= 0 && moved.at > from ? 1 : -1;
      const { reachable: canReach } = latest.current;
      const at =
        arrived === undefined || canReach(arrived.state) ? moved.at : nearest(moved, way, canReach);
      const target = at === undefined ? undefined : moved.entries[at];
      // Back to the window's step: along the trail where it still holds it, else written again after where the trail stands.
      const back = () =>
        own(() => (from >= 0 ? history.go(from - history.current().at) : history.push(was)));
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
        const now = history.current();
        const to = now.entries.indexOf(target);
        if (to >= 0 && to !== now.at) own(() => history.go(to - now.at));
        else standing.current = target;
        latest.current.go(target.state);
      })();
      if (!followed) back();
    };
    return history.subscribe(() => {
      const moved = history.current();
      const was = standing.current;
      if (writing.current || was === undefined || standingOf(moved) === was) return;
      follow(moved, was);
    });
  }, [history, own]);

  // Note that the whole step is what asks, the trail's move with the window's, so a step
  // cancelled at the ask leaves the trail standing where the window still stands. It
  // answers whether a step stood there, asked about or taken.
  const goTo = useCallback(
    (at: number | undefined): boolean => {
      const target = at === undefined ? undefined : history.current().entries[at]?.state;
      if (at === undefined || target === undefined || !latest.current.reachable(target)) {
        return false;
      }
      asking(
        latest.current,
        target,
      )(() => {
        own(() => history.go(at - history.current().at));
        latest.current.go(target);
      })();
      return true;
    },
    [history, own],
  );
  const step = useCallback(
    (by: -1 | 1): boolean => goTo(nearest(history.current(), by, latest.current.reachable)),
    [history, goTo],
  );

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const held = history.current();
    const at = nearest(held, -1, latest.current.reachable);
    if (at === undefined || !sameStep(held.entries[at]?.state, to)) return false;
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

  return {
    canGoBack: nearest(trail, -1, reachable) !== undefined,
    canGoForward: nearest(trail, 1, reachable) !== undefined,
    onBack: useCallback(() => step(-1), [step]),
    onForward: useCallback(() => step(1), [step]),
    steps: {
      back: listedSteps(trail, -1, reachable, named),
      forward: listedSteps(trail, 1, reachable, named),
    },
    onGoTo: goTo,
    backTo,
    upTo,
    stepBack: () => step(-1),
    away: awayStep(trail, reachable, named),
    stepAway: () => goTo(awayFrom(history.current(), latest.current.reachable)),
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
    | "history"
    | "inboxView"
    | "agentView"
    | "personView"
    | "workspace"
    | "automationsView"
    | "chatView"
    | "boardView"
    | "adminView"
    | "restoring"
    | "resting"
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
  // An Inbox showing one column, by its own width or a narrow room's, stands its item alone unless its list was asked for.
  const inboxSingle = narrow || tasks.inboxView.single === true;
  const inboxAlone = inboxSingle && !tasks.inboxView.listed ? tasks.inboxView.chosen : undefined;
  // The item chosen is a step of its own wherever it shows: alone in one column, or beside the list where the Inbox splits.
  const inboxChosen = inboxSingle ? inboxAlone : tasks.inboxView.chosen;
  const inboxListed = inboxSingle ? inboxAlone === undefined : undefined;
  const historyListed = narrow ? tasks.history.listed : undefined;
  // Chat showing one column, by its own width or a narrow room's, steps between its rail and its place as the Inbox does.
  const chatListed = narrow || tasks.chatView.single === true ? tasks.chatView.listed : undefined;
  // The place Chat shows, alone in a narrow room or beside its rail in a wide one; none while a narrow room's rail stands.
  const chatShownPlace = chatListed === true ? undefined : tasks.chatView.place;
  const panelOpen = tasks.sidePanel.open;
  const panelTab = panelOpen ? tasks.sidePanel.tab : undefined;
  // The strips are the open task's, which is the one bound for once it has opened and its agents are read, so a task on its way holds no tab of the one before it.
  const stripsKnown = boundFor !== undefined && tasks.activeTaskId === boundFor;
  // The column's tabs are known only once the task's agents are read, the side panel's at once.
  const columnKnown = stripsKnown && tasks.mainTabs.openAgents !== undefined;
  const columnTab = columnKnown ? tasks.mainTabs.tab : undefined;
  // A narrow room holds the side panel as a pane of its own over the plan (`panel`), whose tab its step keeps as it always has.
  const sideTab = stripsKnown && !narrow ? panelTab : undefined;
  // The tabs each task's strips stood with as the window last stood on it, so a step on a tab since closed is passed over.
  const knownStrips = useRef(new Map<string, KnownStrips>()).current;
  if (stripsKnown && !inboxOpen && !historyOpen) {
    knownStrips.set(boundFor, {
      // Note that a task reopened before its agents are read keeps the column it was last seen with.
      column: columnKnown
        ? new Set(tasks.mainTabs.tabs.map(tabKey))
        : knownStrips.get(boundFor)?.column,
      side: new Set(tasks.sidePanel.strip.map(tabKey)),
    });
  }
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const personName = tasks.personView.name;
  const listedWorkspace = tasks.workspace?.id;
  const automationsOpen = tasks.automationsView.open;
  const automationsPage = tasks.automationsView.place;
  // A narrow room stands an automation's runs alone over its setup, as a step of their own.
  const automationRuns =
    narrow && automationsPage.kind !== AUTOMATIONS_PAGE.LIST
      ? tasks.automationsView.runs
      : undefined;
  const chatOpen = tasks.chatView.open;
  const chatOn = useChatOn();
  const experiments = useExperimentChoices();
  const boardOpen = tasks.boardView.open;
  const adminOpen = tasks.adminView.open;
  const adminView = tasks.adminView.view;
  const adminListed = narrow ? tasks.adminView.listed : undefined;
  // A reloaded tab's Admin step is reachable while the account's access is still being read, as the place waits on it.
  const adminOn = useAdminAccess();
  const adminPending = useAdminAccessPending();
  const adminAccess = adminOn || adminPending;
  // A launch reopening the task last open stands nowhere until it opens, so
  // the home page it waits on is no place to go back to.
  const known = input.known && !tasks.restoring;
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
  const untitled = useMemo((): Place | undefined => {
    if (!known) return undefined;
    if (tab === PANEL_TAB.SETTINGS) {
      return {
        kind: PLACE_KIND.SETTINGS,
        view: settingsView,
        listed: narrow ? settingsListed : undefined,
      };
    }
    // The page the window rests on with no task open is where no page stands, so a step to it is a step home.
    if (tasks.resting) return { kind: PLACE_KIND.HOME };
    if (inboxOpen) return { kind: PLACE_KIND.INBOX, listed: inboxListed, chosen: inboxChosen };
    if (pageAgent !== undefined) return { kind: PLACE_KIND.AGENT, agentId: pageAgent };
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
    if (chatOpen) {
      return {
        kind: PLACE_KIND.CHAT,
        workspaceId: listedWorkspace,
        listed: chatListed,
        shown: chatShownPlace,
      };
    }
    if (boardOpen) return { kind: PLACE_KIND.BOARD, workspaceId: listedWorkspace };
    if (adminOpen) return { kind: PLACE_KIND.ADMIN, view: adminView, listed: adminListed };
    if (boundFor === undefined) return { kind: PLACE_KIND.HOME };
    return historyOpen
      ? { kind: PLACE_KIND.VERSION_HISTORY, taskId: boundFor, spot, listed: historyListed }
      : {
          kind: PLACE_KIND.TASK,
          taskId: boundFor,
          panel: narrow ? { open: panelOpen, tab: panelTab } : undefined,
          column: columnTab,
          side: sideTab,
        };
  }, [
    known,
    tasks.resting,
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
    sideTab,
    inboxOpen,
    inboxListed,
    inboxChosen,
    pageAgent,
    pagePerson,
    personName,
    listedWorkspace,
    automationsOpen,
    automationsPage,
    automationRuns,
    chatOpen,
    chatListed,
    chatShownPlace,
    boardOpen,
    adminOpen,
    adminView,
    adminListed,
  ]);
  const place = useMemo((): Titled | undefined => {
    if (untitled === undefined || titleLabel === undefined) return untitled;
    return { ...untitled, title: { label: titleLabel, detail: titleDetail } };
  }, [untitled, titleLabel, titleDetail]);
  // Whether the tabs a task's step showed still stand on its strips, as far as the window last saw them; a task not seen since is taken to.
  const tabsStand = (to: Extract<Place, { kind: typeof PLACE_KIND.TASK }>) => {
    const strips = knownStrips.get(to.taskId);
    if (strips === undefined) return true;
    const stands = (tab: StripTab | undefined, strip: ReadonlySet<string> | undefined) =>
      tab === undefined || strip === undefined || strip.has(tabKey(tab));
    return stands(to.column, strips.column) && stands(to.side, strips.side);
  };
  const reachable = (to: Place) => {
    // The Admin place is an admin's alone, so back and forward pass over it for an account that is no admin.
    if (to.kind === PLACE_KIND.ADMIN) return adminAccess;
    // An automation's page is of the workspace it stood in, whose automations alone it reads, so Back passes over it once another is listed, and once it is deleted.
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      if (to.page.kind !== AUTOMATIONS_PAGE.EDIT) return true;
      return to.workspaceId === listedWorkspace && !deletedAutomations.has(to.page.automationId);
    }
    // Chat is the chat of the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.CHAT) return chatOn && to.workspaceId === listedWorkspace;
    // A Settings page an experiment holds, such as Memory, stands only while the account has it on.
    if (to.kind === PLACE_KIND.SETTINGS) return settingsPageExperimentStands(to.view, experiments);
    // The Board is a workspace's tasks, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.BOARD) return to.workspaceId === listedWorkspace;
    // A person's page is theirs in the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.PERSON) return to.workspaceId === listedWorkspace;
    if (to.kind === PLACE_KIND.TASK && !tabsStand(to)) return false;
    if (!("taskId" in to) || to.taskId === boundFor) return true;
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
      tasks.inboxView.onOpen();
      if (to.chosen !== undefined) tasks.inboxView.onChoose(to.chosen);
      if (to.listed !== undefined) tasks.inboxView.onListed(to.listed);
      return;
    }
    if (to.kind === PLACE_KIND.AGENT) {
      tasks.agentView.onOpen(to.agentId);
      return;
    }
    if (to.kind === PLACE_KIND.PERSON) {
      tasks.personView.onOpen(to.userId, to.name);
      return;
    }
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      // A narrow room's step within the automation standing moves between its setup and its runs, rather than opening it again;
      // one that also marks another run of the same automation, as a run's link does, opens it on that run past the ask,
      // since it keeps the draft. A new automation's page from another suggestion is another draft, so it asks.
      const here: Place = {
        kind: PLACE_KIND.AUTOMATIONS,
        page: automationsPage,
        workspaceId: listedWorkspace,
      };
      const sameDraft = automationsOpen && sameDraftPage(here, to);
      if (!sameDraft) {
        tasks.automationsView.onOpen(to.page, to.runs);
      } else if (!sameAutomationsOpening(automationsPage, to.page)) {
        tasks.leaveGuard.pass(() => tasks.automationsView.onOpen(to.page, to.runs));
      } else if (to.runs !== undefined) {
        tasks.automationsView.onRuns(to.runs);
      }
      return;
    }
    if (to.kind === PLACE_KIND.CHAT) {
      if (to.shown !== undefined) {
        tasks.chatView.onShow(to.shown);
        // A wide room's For you step stands the rail too, as Chat's link does, for a narrow room to show alone.
        if (to.listed === undefined && to.shown.kind === CHAT_PLACE.FOR_YOU) {
          tasks.chatView.onList();
        }
        return;
      }
      tasks.chatView.onOpen();
      if (to.listed === true) tasks.chatView.onList();
      return;
    }
    if (to.kind === PLACE_KIND.BOARD) {
      tasks.boardView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.ADMIN) {
      tasks.adminView.onOpen(to.view);
      if (to.listed === true) tasks.adminView.onList();
      return;
    }
    // Every other place of the Plans tab is the plan's, which the Inbox, an agent's or a person's page, the Admin place, the Automations page, Chat, and the Board stand over.
    if (inboxOpen) tasks.inboxView.onClose();
    if (pageAgent !== undefined) tasks.agentView.onClose();
    if (pagePerson !== undefined) tasks.personView.onClose();
    if (automationsOpen) tasks.automationsView.onClose();
    if (chatOpen) tasks.chatView.onClose();
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
    else if (to.kind === PLACE_KIND.TASK && to.side !== undefined) {
      tasks.sidePanel.onShow(to.taskId, to.side);
    }
    if (to.kind === PLACE_KIND.HOME && boundFor !== undefined) tasks.onLeaveTask();
  };
  // The side panel as a narrow room's step held it: shut, or open on its tab.
  const standPanel = (taskId: string, panel: PanelStep) => {
    const { sidePanel } = tasks;
    if (panel.open && panel.tab !== undefined) sidePanel.onShow(taskId, panel.tab);
    else sidePanel.onSetOpen(panel.open);
  };
  // The workspace's members, read only while a person's page stands on the trail, whose step is listed by the name they go by now.
  const trail = useSyncExternalStore(windowHistory().subscribe, windowHistory().current);
  const personListed = trail.entries.some((entry) => entry.state?.kind === PLACE_KIND.PERSON);
  const { members } = useWorkspaceMembersRead(personListed ? tasks.workspace : undefined);
  const named = (to: Place) => liveStepTitle(namedStepOf(to), titleOf(to), tasks, members);
  const { backTo, upTo, stepBack, stepAway, ...history } = useHistory({
    place,
    address: addressOf(input.link),
    reachable,
    named,
    go,
    guard: tasks.leaveGuard.guard,
  });
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
    chat: () =>
      up(
        { kind: PLACE_KIND.CHAT, workspaceId: listedWorkspace, listed: true },
        tasks.chatView.onList,
      ),
    admin: () =>
      up(
        { kind: PLACE_KIND.ADMIN, view: tasks.adminView.view, listed: true },
        tasks.adminView.onList,
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
    inbox: (listed) => {
      if (!listed) {
        tasks.inboxView.onListed(false);
        return;
      }
      const stand = () => tasks.inboxView.onListed(true);
      if (inboxSingle) upTo({ kind: PLACE_KIND.INBOX, listed: true }, stand);
      else stand();
    },
    panel: () => {
      const shut = () => tasks.sidePanel.onSetOpen(false);
      if (boundFor === undefined) {
        shut();
        return;
      }
      up({ kind: PLACE_KIND.TASK, taskId: boundFor, panel: { open: false, tab: undefined } }, shut);
    },
    // Note that a task with no step behind it, as one a launch reopened or a link loaded, is left as ever.
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
      if (!stepAway()) tasks.boardView.onOpen();
    },
    lists,
  });
}

/**
 * The mouse's own back and forward buttons, the fourth and fifth, answered
 * while `enabled` as a browser answers them. Note that each press it answers
 * is cancelled, because Chromium takes a Back or Forward of its own on that
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
