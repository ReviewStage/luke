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
 * it from, the way a browser's `history.state` stands beside its URL. The
 * desktop keeps it in memory and writes no address.
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
 * Each Automations page is a step of its own, the list and each automation's
 * page alike, so Back from an automation opened from the list returns to the
 * list. A new automation's page is one step with the automation it makes,
 * which stands in its place once Create lands, so Back from what it made
 * returns to wherever the new page was opened from. An automation's page is
 * of the workspace it was opened in, so Back passes over it once another is
 * listed, as it does a person's page, and passes over it for good once it
 * is deleted, as it does a deleted plan.
 */

import { EXPERIMENT } from "@luke/settings";
import type { SettingsView } from "@luke/settings/settings-views";
import type { HistoryAdapter, HistoryEntry, HistorySnapshot } from "@luke/ui/history-adapter";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import { useChatOn } from "./tasks/chat-gate";
import type { HistorySpot } from "./tasks/use-plan-history";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  ISSUES_PAGE,
  type LeaveGuard,
  type TasksControl,
} from "./tasks/use-tasks-tab";
import { useExperiment } from "./use-app-state";

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
  FACTORY: "factory",
  AUTOMATIONS: "automations",
  CHAT: "chat",
  ISSUES: "issues",
  SETTINGS: "settings",
} as const;

/** A place the window can stand on: a task, or its version history where it stands, by its id, so a rename leaves it the same place. */
type Place =
  | { readonly kind: typeof PLACE_KIND.TASK; readonly taskId: string }
  | {
      readonly kind: typeof PLACE_KIND.VERSION_HISTORY;
      readonly taskId: string;
      readonly spot: HistorySpot | undefined;
    }
  | { readonly kind: typeof PLACE_KIND.HOME }
  | { readonly kind: typeof PLACE_KIND.INBOX }
  | { readonly kind: typeof PLACE_KIND.AGENT; readonly agentId: string }
  | {
      readonly kind: typeof PLACE_KIND.PERSON;
      readonly userId: string;
      /** The name the page was opened with, which it is opened with again. */
      readonly name: string | undefined;
      /** The workspace the page was the person's in, which it is no place of another's. */
      readonly workspaceId: string | undefined;
    }
  | { readonly kind: typeof PLACE_KIND.FACTORY }
  | {
      readonly kind: typeof PLACE_KIND.AUTOMATIONS;
      readonly page: AutomationsPlace;
      /** The workspace listed as the page stood, whose automations it read. */
      readonly workspaceId: string | undefined;
    }
  | {
      readonly kind: typeof PLACE_KIND.CHAT;
      /** The workspace listed as Chat stood, whose chat it read. */
      readonly workspaceId: string | undefined;
    }
  | {
      readonly kind: typeof PLACE_KIND.ISSUES;
      /** The workspace whose issues stood, which is no place of another's. */
      readonly workspaceId: string | undefined;
      /** The issue whose page stood, or none for the list. */
      readonly issueId: string | undefined;
    }
  | { readonly kind: typeof PLACE_KIND.SETTINGS; readonly view: SettingsView };

/** The places the window has stood on, as its history adapter holds them. */
type Trail = HistorySnapshot<Place>;

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

/** Whether two places are one step of the history: the same plan, the same plan's version history, the home page, the Inbox on any plan, the same agent's or person's page, Factory, the same Automations page, Chat in the same workspace, the same workspace's Issues list or the same issue's page, or Settings on any page. */
function sameStep(one: Place | undefined, other: Place): boolean {
  if (one === undefined || one.kind !== other.kind) return false;
  if (one.kind === PLACE_KIND.AUTOMATIONS && other.kind === PLACE_KIND.AUTOMATIONS) {
    return sameAutomationsPage(one.page, other.page);
  }
  if ("taskId" in one && "taskId" in other) return one.taskId === other.taskId;
  if ("agentId" in one && "agentId" in other) return one.agentId === other.agentId;
  if ("issueId" in one && "issueId" in other) {
    return one.issueId === other.issueId && one.workspaceId === other.workspaceId;
  }
  if ("userId" in one && "userId" in other) {
    return one.userId === other.userId && one.workspaceId === other.workspaceId;
  }
  if (one.kind === PLACE_KIND.CHAT && other.kind === PLACE_KIND.CHAT) {
    return one.workspaceId === other.workspaceId;
  }
  if ("workspaceId" in one && "workspaceId" in other) return one.workspaceId === other.workspaceId;
  return true;
}

/** Whether a version history stands where it stood: on the same version, with the same sections open. */
function sameSpot(one: HistorySpot | undefined, other: HistorySpot | undefined): boolean {
  return (
    one?.revision === other?.revision &&
    one?.opened?.seq === other?.opened?.seq &&
    one?.opened?.heading === other?.opened?.heading
  );
}

/** Whether a step stands as it stood: Settings on the same page, a version history where it was, a person's page by the name it was last opened with, an Automations page as it was opened. */
function samePlace(one: Place, other: Place): boolean {
  if (one.kind === PLACE_KIND.AUTOMATIONS && other.kind === PLACE_KIND.AUTOMATIONS) {
    return one.workspaceId === other.workspaceId && sameAutomationsOpening(one.page, other.page);
  }
  if (one.kind === PLACE_KIND.SETTINGS && other.kind === PLACE_KIND.SETTINGS) {
    return one.view === other.view;
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
 * The entry a place is held as: the place itself, as the state the window
 * reopens it from, and no address, since the desktop keeps its history in
 * memory and nothing here reads one.
 */
function entryOf(place: Place): HistoryEntry<Place> {
  return { address: undefined, state: place };
}

/**
 * Records the window standing on `place`. A step already standing is left
 * as it is, but for a Settings page turned or a version history moved
 * within, which the standing step takes in place, and so does the automation
 * a new automation's page made. Any other place is a visit, whichever door
 * opened it.
 */
function visit(history: HistoryAdapter<Place>, place: Place): void {
  const trail = history.current();
  const standing = trail.entries[trail.at]?.state;
  if (standing !== undefined && madeFromNew(standing, place)) {
    history.replace(entryOf(place));
    return;
  }
  if (standing !== undefined && sameStep(standing, place)) {
    if (!samePlace(standing, place)) history.replace(entryOf(place));
    return;
  }
  history.push(entryOf(place));
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

/** The window's history as its buttons and keys use it. */
export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/** The window's history, with the way a restore leaves a plan's version history. */
export interface WindowHistory extends NavigationHistory {
  /** Leaves the version history for its task: a step back where the task is the step behind, else a visit. */
  onLeaveVersionHistory: () => void;
}

/** Installs the history this window keeps; its root does this once, before anything is drawn. */
export function installWindowHistory(history: HistoryAdapter<Place>): void {
  installed = history;
}

/** The history this window's root installed. */
function windowHistory(): HistoryAdapter<Place> {
  if (installed === undefined) throw new Error("No history is installed in this window.");
  return installed;
}

/**
 * The history over where the window stands, held by the window's history
 * adapter. `place` is nothing until the window knows where it is, so a
 * launch records no page it never showed. `reachable` says whether a place
 * can still be gone to — a deleted task cannot — and `go` takes the window
 * there; the move's own arrival is then recognised as the place the history
 * already stands on, and records nothing.
 */
function useHistory(input: {
  place: Place | undefined;
  reachable: (place: Place) => boolean;
  go: (place: Place) => void;
  /** Asks first, while a page holds unsaved work, before a step moves the trail at all. */
  guard: LeaveGuard["guard"];
}): NavigationHistory & { backTo: (place: Place) => boolean } {
  const { place, reachable, guard } = input;
  const history = windowHistory();
  const trail = useSyncExternalStore(history.subscribe, history.current);
  // Note that the presses read the trail from the adapter as they land, because a
  // key can land between a move and the render that shows it, and the latest
  // `reachable` and `go` through a ref, so a press stays the same function
  // across renders.
  const latest = useRef({ reachable, go: input.go });
  useLayoutEffect(() => {
    latest.current = { reachable, go: input.go };
  });

  useEffect(() => {
    if (place !== undefined) visit(history, place);
  }, [history, place]);

  // Note that the whole step is what asks, the trail's move with the window's, so a step
  // cancelled at the ask leaves the trail standing where the window still stands.
  const step = useCallback(
    (by: -1 | 1) => {
      const asked = history.current();
      const at = nearest(asked, by, latest.current.reachable);
      const target = at === undefined ? undefined : asked.entries[at]?.state;
      if (at === undefined || target === undefined) return;
      guard(() => {
        history.go(at - history.current().at);
        latest.current.go(target);
      })();
    },
    [guard, history],
  );

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const held = history.current();
    const at = nearest(held, -1, latest.current.reachable);
    if (at === undefined || !sameStep(held.entries[at]?.state, to)) return false;
    step(-1);
    return true;
  };

  return {
    canGoBack: nearest(trail, -1, reachable) !== undefined,
    canGoForward: nearest(trail, 1, reachable) !== undefined,
    onBack: useCallback(() => step(-1), [step]),
    onForward: useCallback(() => step(1), [step]),
    backTo,
  };
}

/**
 * The window's history: Tasks on the task it is bound for — the one asked
 * for, so a move waiting on the host's answer is already where it is going —
 * or on that plan's version history, or the Inbox, or Settings on its page. A task the
 * account's list once held and holds no more is passed over, unless the list
 * itself could not be read, and so is an archived task, which the developer
 * put out of the way, unless it is the task the window is bound for, as it is
 * from its own version history or from Settings opened over it. Note that a
 * task no list has held yet is still a place, because the list may not have
 * landed or may not yet carry a task just started; a task that cannot be read
 * is a place too, and says so when it is gone back to. Going to a place
 * changes the tab only when it must, so a tab change is counted as any other.
 * A version history is gone back to where it stood, on its version and with
 * its sections as they were.
 */
export function useWindowHistory(input: {
  /** Whether the window knows where it stands: its state has arrived, and no sign-in stands over it. */
  known: boolean;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  settingsView: SettingsView;
  onSettingsViewChange: (view: SettingsView) => void;
  tasks: Pick<
    TasksControl,
    | "boundFor"
    | "tasks"
    | "archived"
    | "listFailed"
    | "onSelect"
    | "onLeaveTask"
    | "history"
    | "inboxView"
    | "agentView"
    | "personView"
    | "workspace"
    | "factoryView"
    | "automationsView"
    | "chatView"
    | "issuesView"
    | "restoring"
    | "leaveGuard"
  >;
}): WindowHistory {
  const { tab, settingsView, tasks } = input;
  const { boundFor } = tasks;
  const historyOpen = tasks.history.open;
  const { spot } = tasks.history;
  const inboxOpen = tasks.inboxView.open;
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const personName = tasks.personView.name;
  const listedWorkspace = tasks.workspace?.id;
  const factoryOpen = tasks.factoryView.open;
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const automationsOpen = tasks.automationsView.open;
  const automationsPage = tasks.automationsView.place;
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  const chatOpen = tasks.chatView.open;
  const chatOn = useChatOn();
  const issuesOpen = tasks.issuesView.open;
  const issuesPlace = tasks.issuesView.place;
  const pageIssue = issuesPlace.kind === ISSUES_PAGE.ISSUE ? issuesPlace.issueId : undefined;
  const issuesOn = useExperiment(EXPERIMENT.ISSUES);
  // A launch reopening the task last open stands nowhere until it opens, so
  // the home page it waits on is no place to go back to.
  const known = input.known && !tasks.restoring;
  // Only grows, so writing it as the list is drawn is the same on every render.
  const everListed = useRef(new Set<string>()).current;
  for (const task of [...tasks.tasks, ...tasks.archived]) everListed.add(task.id);
  // Only grows the same way: every automation the window has seen deleted.
  const deletedAutomations = useRef(new Set<string>()).current;
  if (automationsPage.kind === AUTOMATIONS_PAGE.LIST && automationsPage.deleted !== undefined) {
    deletedAutomations.add(automationsPage.deleted);
  }
  const place = useMemo((): Place | undefined => {
    if (!known) return undefined;
    if (tab === PANEL_TAB.SETTINGS) return { kind: PLACE_KIND.SETTINGS, view: settingsView };
    if (inboxOpen) return { kind: PLACE_KIND.INBOX };
    if (pageAgent !== undefined) return { kind: PLACE_KIND.AGENT, agentId: pageAgent };
    if (pagePerson !== undefined) {
      return {
        kind: PLACE_KIND.PERSON,
        userId: pagePerson,
        name: personName,
        workspaceId: listedWorkspace,
      };
    }
    if (factoryOpen) return { kind: PLACE_KIND.FACTORY };
    if (automationsOpen) {
      return { kind: PLACE_KIND.AUTOMATIONS, page: automationsPage, workspaceId: listedWorkspace };
    }
    if (chatOpen) return { kind: PLACE_KIND.CHAT, workspaceId: listedWorkspace };
    if (issuesOpen) {
      return { kind: PLACE_KIND.ISSUES, workspaceId: listedWorkspace, issueId: pageIssue };
    }
    if (boundFor === undefined) return { kind: PLACE_KIND.HOME };
    return historyOpen
      ? { kind: PLACE_KIND.VERSION_HISTORY, taskId: boundFor, spot }
      : { kind: PLACE_KIND.TASK, taskId: boundFor };
  }, [
    known,
    tab,
    settingsView,
    boundFor,
    historyOpen,
    spot,
    inboxOpen,
    pageAgent,
    pagePerson,
    personName,
    listedWorkspace,
    factoryOpen,
    automationsOpen,
    automationsPage,
    chatOpen,
    issuesOpen,
    pageIssue,
  ]);
  const reachable = (to: Place) => {
    // Factory, the Automations page, and the Issues page are experiments, so back and forward pass over each while it is off.
    if (to.kind === PLACE_KIND.FACTORY) return factoryOn;
    // An automation's page is of the workspace it stood in, whose automations alone it reads, so Back passes over it once another is listed, and once it is deleted.
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      if (!automationsOn) return false;
      if (to.page.kind !== AUTOMATIONS_PAGE.EDIT) return true;
      return to.workspaceId === listedWorkspace && !deletedAutomations.has(to.page.automationId);
    }
    // Chat is the chat of the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.CHAT) return chatOn && to.workspaceId === listedWorkspace;
    // The Issues page is a workspace's, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.ISSUES) return issuesOn && to.workspaceId === listedWorkspace;
    // A person's page is theirs in the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.PERSON) return to.workspaceId === listedWorkspace;
    if (!("taskId" in to) || to.taskId === boundFor) return true;
    if (tasks.archived.some((task) => task.id === to.taskId)) return false;
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
      return;
    }
    if (tab !== PANEL_TAB.TASKS) input.onTabChange(PANEL_TAB.TASKS);
    if (to.kind === PLACE_KIND.INBOX) {
      tasks.inboxView.onOpen();
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
    if (to.kind === PLACE_KIND.FACTORY) {
      tasks.factoryView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      tasks.automationsView.onOpen(to.page);
      return;
    }
    if (to.kind === PLACE_KIND.CHAT) {
      tasks.chatView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.ISSUES) {
      tasks.issuesView.onOpen(
        to.issueId === undefined
          ? { kind: ISSUES_PAGE.LIST }
          : { kind: ISSUES_PAGE.ISSUE, issueId: to.issueId },
      );
      return;
    }
    // Every other place of the Plans tab is the plan's, which the Inbox, an agent's or a person's page, Factory, the Automations page, Chat, and the Issues page stand over.
    if (inboxOpen) tasks.inboxView.onClose();
    if (pageAgent !== undefined) tasks.agentView.onClose();
    if (pagePerson !== undefined) tasks.personView.onClose();
    if (factoryOpen) tasks.factoryView.onClose();
    if (automationsOpen) tasks.automationsView.onClose();
    if (chatOpen) tasks.chatView.onClose();
    if (issuesOpen) tasks.issuesView.onClose();
    // Note that a version history is opened on its spot even where it is
    // still open under Settings, because a version history out of sight
    // keeps no version chosen.
    if (to.kind === PLACE_KIND.VERSION_HISTORY) {
      tasks.history.onReturn(to.taskId, to.spot);
      return;
    }
    if (historyOpen) tasks.history.onClose();
    if (to.kind === PLACE_KIND.TASK && boundFor !== to.taskId) tasks.onSelect(to.taskId);
    if (to.kind === PLACE_KIND.HOME && boundFor !== undefined) tasks.onLeaveTask();
  };
  const { backTo, ...history } = useHistory({
    place,
    reachable,
    go,
    guard: tasks.leaveGuard.guard,
  });
  return {
    ...history,
    onLeaveVersionHistory: () => {
      if (boundFor !== undefined && backTo({ kind: PLACE_KIND.TASK, taskId: boundFor })) return;
      tasks.history.onClose();
    },
  };
}

/**
 * The mouse's own back and forward buttons, the fourth and fifth, answered
 * while `enabled` as a browser answers them.
 */
export function useHistoryMouseButtons(history: NavigationHistory, enabled: boolean): void {
  const { onBack, onForward } = history;
  useEffect(() => {
    if (!enabled) return;
    const handleUp = (event: MouseEvent) => {
      if (event.button === MOUSE_BUTTON.BACK) onBack();
      if (event.button === MOUSE_BUTTON.FORWARD) onForward();
    };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, [enabled, onBack, onForward]);
}
