/**
 * navigation-history.ts -- the window's back and forward: the places it has stood on, and the moves between them.
 *
 * A place is a plan's page, a plan's version history, the home page,
 * the Inbox, or Settings, and the history is the one a browser keeps: the places behind,
 * the one standing, and the places ahead, which a new visit clears. It is
 * written by watching where the window is rather than by each door that
 * moves it, so a plan opened from the sidebar, by a key, by starting it, or
 * by the host itself is one more place visited all the same, and a move
 * through the history is the window arriving where the history already
 * stands. It lives as long as the window does, the way a browser tab's does.
 *
 * Settings is one step however many of its pages are turned: entering it is
 * a visit, and choosing another of its pages turns the page that visit holds
 * in place, so Back from any page of it returns to wherever it was opened
 * from, and Forward brings it back on the page last open. A plan's version
 * history is one step the same way, whichever version is chosen in it or
 * whichever revision's sections are open, and going back to it opens it on
 * that version with those sections. Whatever is opened from it — a version's
 * source, a tab from the command palette, a notification's — is a visit
 * after it, though it opens on the same plan, so Back returns to it; only a
 * restore lands on the plan as Back would, where the plan stands behind.
 */

import { EXPERIMENT } from "@luke/settings";
import type { SettingsView } from "@luke/settings/settings-views";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PANEL_TAB, type PanelTab } from "./panel-tabs";
import type { HistorySpot } from "./tasks/use-plan-history";
import type { LeaveGuard, TasksControl } from "./tasks/use-tasks-tab";
import { useExperiment } from "./use-app-state";

/** The most places the history holds; the oldest go first. */
const HISTORY_LIMIT = 50;

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
  SETTINGS: "settings",
} as const;

/** A place the window can stand on: a plan, or its version history where it stands, by its id, so a rename leaves it the same place. */
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
  | { readonly kind: typeof PLACE_KIND.AUTOMATIONS }
  | { readonly kind: typeof PLACE_KIND.SETTINGS; readonly view: SettingsView };

interface Trail {
  readonly places: readonly Place[];
  readonly at: number;
}

const EMPTY_TRAIL: Trail = { places: [], at: -1 };

/** Whether two places are one step of the history: the same plan, the same plan's version history, the home page, the Inbox on any plan, the same agent's or person's page, Factory, the Automations page, or Settings on any page. */
function sameStep(one: Place | undefined, other: Place): boolean {
  if (one === undefined || one.kind !== other.kind) return false;
  if ("taskId" in one && "taskId" in other) return one.taskId === other.taskId;
  if ("agentId" in one && "agentId" in other) return one.agentId === other.agentId;
  if ("userId" in one && "userId" in other) {
    return one.userId === other.userId && one.workspaceId === other.workspaceId;
  }
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

/** Whether a step stands as it stood: Settings on the same page, a version history where it was, a person's page by the name it was last opened with. */
function samePlace(one: Place, other: Place): boolean {
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
 * The trail with the window standing on `place`. A step already standing is
 * the same trail, but for a Settings page turned or a version history moved
 * within, which the standing step takes in place. Any other place is a visit,
 * whichever door opened it.
 */
function visited(trail: Trail, place: Place): Trail {
  const standing = trail.places[trail.at];
  if (standing !== undefined && sameStep(standing, place)) {
    if (samePlace(standing, place)) return trail;
    return { places: trail.places.with(trail.at, place), at: trail.at };
  }
  const places = [...trail.places.slice(0, trail.at + 1), place].slice(-HISTORY_LIMIT);
  return { places, at: places.length - 1 };
}

/**
 * The nearest step one way along the trail the window can still go to,
 * skipping any it cannot reach and any that is the step it already stands
 * on, so a deleted plan between two visits of one page is passed over whole.
 */
function nearest(
  trail: Trail,
  step: -1 | 1,
  reachable: (place: Place) => boolean,
): number | undefined {
  const standing = trail.places[trail.at];
  for (let at = trail.at + step; at >= 0 && at < trail.places.length; at += step) {
    const place = trail.places[at];
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
  /** Leaves the version history for its plan: a step back where the plan is the step behind, else a visit. */
  onLeaveVersionHistory: () => void;
}

/**
 * The history over where the window stands. `place` is nothing until the
 * window knows where it is, so a launch records no page it never showed.
 * `reachable` says whether a place can still be gone to — a deleted plan
 * cannot — and `go` takes the window there; the move's own arrival is then
 * recognised as the place the history already stands on, and records nothing.
 */
function useHistory(input: {
  place: Place | undefined;
  reachable: (place: Place) => boolean;
  go: (place: Place) => void;
  /** Asks first, while a page holds unsaved work, before a step moves the trail at all. */
  guard: LeaveGuard["guard"];
}): NavigationHistory & { backTo: (place: Place) => boolean } {
  const { place, reachable, guard } = input;
  const [trail, setTrail] = useState<Trail>(EMPTY_TRAIL);
  // Note that the presses read the latest trail through a ref, because a key
  // can land between a move and the render that shows it, and the latest
  // `reachable` and `go` too, so a press stays the same function across renders.
  const latest = useRef({ trail, reachable, go: input.go });
  useLayoutEffect(() => {
    latest.current = { trail, reachable, go: input.go };
  });

  useEffect(() => {
    if (place !== undefined) setTrail((held) => visited(held, place));
  }, [place]);

  // Note that the whole step is what asks, the trail's move with the window's, so a step
  // cancelled at the ask leaves the trail standing where the window still stands.
  const step = useCallback(
    (by: -1 | 1) => {
      const asked = latest.current;
      const at = nearest(asked.trail, by, asked.reachable);
      const target = at === undefined ? undefined : asked.trail.places[at];
      if (at === undefined || target === undefined) return;
      guard(() => {
        const held = latest.current;
        const moved = { places: held.trail.places, at };
        latest.current = { ...held, trail: moved };
        setTrail(moved);
        held.go(target);
      })();
    },
    [guard],
  );

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const held = latest.current;
    const at = nearest(held.trail, -1, held.reachable);
    if (at === undefined || !sameStep(held.trail.places[at], to)) return false;
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
 * The window's history: Plans on the plan it is bound for — the one asked
 * for, so a move waiting on the host's answer is already where it is going —
 * or on that plan's version history, or the Inbox, or Settings on its page. A plan the
 * account's list once held and holds no more is passed over, unless the list
 * itself could not be read, and so is an archived plan, which the developer
 * put out of the way, unless it is the plan the window is bound for, as it is
 * from its own version history or from Settings opened over it. Note that a
 * plan no list has held yet is still a place, because the list may not have
 * landed or may not yet carry a plan just started; a plan that cannot be read
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
    | "restoring"
    | "leaveGuard"
  >;
}): WindowHistory {
  const { tab, settingsView, tasks: plans } = input;
  const { boundFor } = plans;
  const historyOpen = plans.history.open;
  const { spot } = plans.history;
  const inboxOpen = plans.inboxView.open;
  const pageAgent = plans.agentView.agentId;
  const pagePerson = plans.personView.userId;
  const personName = plans.personView.name;
  const listedWorkspace = plans.workspace?.id;
  const factoryOpen = plans.factoryView.open;
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const automationsOpen = plans.automationsView.open;
  const automationsOn = useExperiment(EXPERIMENT.AUTOMATIONS);
  // A launch reopening the plan last open stands nowhere until it opens, so
  // the home page it waits on is no place to go back to.
  const known = input.known && !plans.restoring;
  // Only grows, so writing it as the list is drawn is the same on every render.
  const everListed = useRef(new Set<string>()).current;
  for (const task of [...plans.tasks, ...plans.archived]) everListed.add(task.id);
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
    if (automationsOpen) return { kind: PLACE_KIND.AUTOMATIONS };
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
  ]);
  const reachable = (to: Place) => {
    // Factory and the Automations page are experiments, so back and forward pass over each while it is off.
    if (to.kind === PLACE_KIND.FACTORY) return factoryOn;
    if (to.kind === PLACE_KIND.AUTOMATIONS) return automationsOn;
    // A person's page is theirs in the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.PERSON) return to.workspaceId === listedWorkspace;
    if (!("taskId" in to) || to.taskId === boundFor) return true;
    if (plans.archived.some((plan) => plan.id === to.taskId)) return false;
    return (
      plans.listFailed ||
      !everListed.has(to.taskId) ||
      plans.tasks.some((task) => task.id === to.taskId)
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
      plans.inboxView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.AGENT) {
      plans.agentView.onOpen(to.agentId);
      return;
    }
    if (to.kind === PLACE_KIND.PERSON) {
      plans.personView.onOpen(to.userId, to.name);
      return;
    }
    if (to.kind === PLACE_KIND.FACTORY) {
      plans.factoryView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      plans.automationsView.onOpen();
      return;
    }
    // Every other place of the Plans tab is the plan's, which the Inbox, an agent's or a person's page, Factory, and the Automations page stand over.
    if (inboxOpen) plans.inboxView.onClose();
    if (pageAgent !== undefined) plans.agentView.onClose();
    if (pagePerson !== undefined) plans.personView.onClose();
    if (factoryOpen) plans.factoryView.onClose();
    if (automationsOpen) plans.automationsView.onClose();
    // Note that a version history is opened on its spot even where it is
    // still open under Settings, because a version history out of sight
    // keeps no version chosen.
    if (to.kind === PLACE_KIND.VERSION_HISTORY) {
      plans.history.onReturn(to.taskId, to.spot);
      return;
    }
    if (historyOpen) plans.history.onClose();
    if (to.kind === PLACE_KIND.TASK && boundFor !== to.taskId) plans.onSelect(to.taskId);
    if (to.kind === PLACE_KIND.HOME && boundFor !== undefined) plans.onLeaveTask();
  };
  const { backTo, ...history } = useHistory({
    place,
    reachable,
    go,
    guard: plans.leaveGuard.guard,
  });
  return {
    ...history,
    onLeaveVersionHistory: () => {
      if (boundFor !== undefined && backTo({ kind: PLACE_KIND.TASK, taskId: boundFor })) return;
      plans.history.onClose();
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
