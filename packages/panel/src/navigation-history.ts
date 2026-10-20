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
 * Settings page, a version, or a Chat place over its list. Each such step
 * holds its sub-step beside its place, and a wide room holds none, so two
 * places are one step there as they always were, and a room turned from one
 * to the other takes the step standing in place. Going to a step stands its
 * sub-step from the step alone, so a move the adapter makes itself, as a
 * browser's Back does, lands on the screen the step was. The screens' own
 * ways back to their lists step back where the list is the step behind, and
 * otherwise take the step standing in place, as a link opened on an item
 * leaves no list behind it to go back to.
 */

import { linkOf, type ReadLink } from "@luke/features/luke-link";
import { EXPERIMENT } from "@luke/settings";
import type { SettingsView } from "@luke/settings/settings-views";
import { CHAT_PLACE, type ChatPlace } from "@luke/ui/chat-model";
import type { HistoryAdapter, HistoryEntry, HistorySnapshot } from "@luke/ui/history-adapter";
import { sameTab } from "@luke/ui/tab-strip-model";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { PANEL_TAB, type PanelTab } from "./panel-tabs.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { useChatOn } from "./tasks/chat-gate.js";
import type { HistorySpot } from "./tasks/use-plan-history.js";
import type { SidePanelTab } from "./tasks/use-side-panel.js";
import {
  AUTOMATIONS_PAGE,
  type AutomationsPlace,
  type InboxChoice,
  type LeaveGuard,
  type TasksControl,
} from "./tasks/use-tasks-tab.js";
import { useExperiment } from "./use-app-state.js";

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
  BOARD: "board",
  SETTINGS: "settings",
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
 * wide room: the side panel over a task, and whether Settings, a version
 * history, the Inbox, or Chat stands on its list (`listed`) or the item
 * chosen in it.
 */
type Place =
  | {
      readonly kind: typeof PLACE_KIND.TASK;
      readonly taskId: string;
      readonly panel?: PanelStep | undefined;
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
      readonly listed?: boolean | undefined;
      /** The place standing alone, while one does. */
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
    };

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

/** A place's sub-step in a narrow room, as a yes or no: the side panel open, or the list standing; none in a wide room, or for a place with no sub-step. */
function subStepOf(place: Place): boolean | undefined {
  switch (place.kind) {
    case PLACE_KIND.TASK:
      return place.panel?.open;
    case PLACE_KIND.VERSION_HISTORY:
    case PLACE_KIND.INBOX:
    case PLACE_KIND.CHAT:
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

/** Whether two places are one step of the history: the same plan, the same plan's version history, the home page, the Inbox on any plan, the same agent's or person's page, Factory, the same Automations page, Chat in the same workspace, the same workspace's Board, or Settings on any page. */
function sameStep(one: Place | undefined, other: Place): boolean {
  if (one === undefined || one.kind !== other.kind) return false;
  // A narrow room's pane opened over another is a step of its own.
  if (!sameSubStep(one, other)) return false;
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
    return samePanelTab(one.panel, other.panel);
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
  if (one.kind === PLACE_KIND.VERSION_HISTORY && other.kind === PLACE_KIND.VERSION_HISTORY) {
    return sameSpot(one.spot, other.spot);
  }
  if (one.kind === PLACE_KIND.PERSON && other.kind === PLACE_KIND.PERSON) {
    return one.name === other.name;
  }
  return true;
}

/**
 * The address of a place with no link: the home page, Chat, the Board, a
 * new automation's page.
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
 * the list was no step behind. Any other place is a visit, whichever door
 * opened it.
 */
function visit(
  history: HistoryAdapter<Place>,
  place: Place,
  address: string,
  up: Place | undefined,
): void {
  const trail = history.current();
  const standing = trail.entries[trail.at];
  const entry: HistoryEntry<Place> = { address, state: place };
  const wentUp = up !== undefined && sameStep(up, place);
  if (standing !== undefined && (wentUp || madeFromNew(standing.state, place))) {
    history.replace(entry);
    return;
  }
  if (standing !== undefined && sameStep(standing.state, place)) {
    if (!samePlace(standing.state, place) || standing.address !== address) history.replace(entry);
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

/** The window's history as its buttons and keys use it. */
export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
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
  readonly chat: () => void;
  /** Stands the Inbox's list alone, or its item. */
  readonly inbox: (listed: boolean) => void;
}

/** The window's history, with the way a restore leaves a plan's version history. */
export interface WindowHistory extends NavigationHistory {
  /** Leaves the version history for its task: a step back where the task is the step behind, else a visit. */
  onLeaveVersionHistory: () => void;
}

/** The window's history with the narrow screens' ways back to their lists, which the root hands the screens. */
export interface WindowHistoryLists extends WindowHistory {
  readonly lists: ListBacks;
}

/** The Tasks tab with its screens' ways back to their lists through the history, as the shell draws them. */
export function throughHistory(tasks: TasksControl, lists: ListBacks): TasksControl {
  return {
    ...tasks,
    history: { ...tasks.history, onList: lists.versions },
    chatView: { ...tasks.chatView, onList: lists.chat },
    inboxView: { ...tasks.inboxView, onListed: lists.inbox },
  };
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
 * there, which opens on Home. Note that such a move has already happened
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
  go: (place: Place) => void;
  /** Asks first, while a page holds unsaved work, before a step moves the trail at all. */
  guard: LeaveGuard["guard"];
}): NavigationHistory & {
  backTo: (place: Place) => boolean;
  upTo: (place: Place, stand: () => void) => void;
} {
  const { place, address, reachable, guard } = input;
  const history = windowHistory();
  const trail = useSyncExternalStore(history.subscribe, history.current);
  // Note that the presses read the trail from the adapter as they land, because a
  // key can land between a move and the render that shows it, and the latest
  // `reachable`, `go`, and `guard` through a ref, so a press stays the same
  // function across renders.
  const latest = useRef({ reachable, go: input.go, guard });
  useLayoutEffect(() => {
    latest.current = { reachable, go: input.go, guard };
  });
  // The list a narrow screen went up to with no step behind, which the next visit takes in place.
  const wentUp = useRef<Place | undefined>(undefined);
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
    own(() => visit(history, place, address, up));
  }, [history, place, address, own]);

  useEffect(() => {
    // An entry holding no step is a page loaded there, which opens on Home; the window already there writes its step on it.
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
      latest.current.guard(() => {
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
  // cancelled at the ask leaves the trail standing where the window still stands.
  const step = useCallback(
    (by: -1 | 1) => {
      const asked = history.current();
      const at = nearest(asked, by, latest.current.reachable);
      const target = at === undefined ? undefined : asked.entries[at]?.state;
      if (at === undefined || target === undefined) return;
      guard(() => {
        own(() => history.go(at - history.current().at));
        latest.current.go(target);
      })();
    },
    [guard, history, own],
  );

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const held = history.current();
    const at = nearest(held, -1, latest.current.reachable);
    if (at === undefined || !sameStep(held.entries[at]?.state, to)) return false;
    step(-1);
    return true;
  };

  // Up to `to` from an item over it: a step back where it is the step behind, else `stand` taking the step in place.
  const upTo = (to: Place, stand: () => void) => {
    if (backTo(to)) return;
    wentUp.current = to;
    stand();
  };

  return {
    canGoBack: nearest(trail, -1, reachable) !== undefined,
    canGoForward: nearest(trail, 1, reachable) !== undefined,
    onBack: useCallback(() => step(-1), [step]),
    onForward: useCallback(() => step(1), [step]),
    backTo,
    upTo,
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
 * its sections as they were. In a narrow room, each place shown one pane at
 * a time is gone back to on the pane it showed.
 */
export function useWindowHistory(input: {
  /** Whether the window knows where it stands: its state has arrived, and no sign-in stands over it. */
  known: boolean;
  /** The link of the step the window stands on, as Copy link names it (`CopyLink.standing`); none where it has none. */
  link: ReadLink | undefined;
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
    | "boardView"
    | "restoring"
    | "leaveGuard"
    | "sidePanel"
  >;
}): WindowHistoryLists {
  const { tab, settingsView, settingsListed, tasks } = input;
  const narrow = input.room === SHELL_ROOM.NARROW;
  const { boundFor } = tasks;
  const historyOpen = tasks.history.open;
  const { spot } = tasks.history;
  const inboxOpen = tasks.inboxView.open;
  // A narrow room stands the Inbox's item alone unless its list was asked for.
  const inboxAlone = narrow && !tasks.inboxView.listed ? tasks.inboxView.chosen : undefined;
  const inboxListed = narrow ? inboxAlone === undefined : undefined;
  const historyListed = narrow ? tasks.history.listed : undefined;
  const chatListed = narrow ? tasks.chatView.listed : undefined;
  const chatAlone = chatListed === false ? tasks.chatView.place : undefined;
  const panelOpen = tasks.sidePanel.open;
  const panelTab = panelOpen ? tasks.sidePanel.tab : undefined;
  const pageAgent = tasks.agentView.agentId;
  const pagePerson = tasks.personView.userId;
  const personName = tasks.personView.name;
  const listedWorkspace = tasks.workspace?.id;
  const factoryOpen = tasks.factoryView.open;
  const factoryOn = useExperiment(EXPERIMENT.FACTORY);
  const automationsOpen = tasks.automationsView.open;
  const automationsPage = tasks.automationsView.place;
  const chatOpen = tasks.chatView.open;
  const chatOn = useChatOn();
  const boardOpen = tasks.boardView.open;
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
    if (tab === PANEL_TAB.SETTINGS) {
      return {
        kind: PLACE_KIND.SETTINGS,
        view: settingsView,
        listed: narrow ? settingsListed : undefined,
      };
    }
    if (inboxOpen) return { kind: PLACE_KIND.INBOX, listed: inboxListed, chosen: inboxAlone };
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
    if (chatOpen) {
      return {
        kind: PLACE_KIND.CHAT,
        workspaceId: listedWorkspace,
        listed: chatListed,
        shown: chatAlone,
      };
    }
    if (boardOpen) return { kind: PLACE_KIND.BOARD, workspaceId: listedWorkspace };
    if (boundFor === undefined) return { kind: PLACE_KIND.HOME };
    return historyOpen
      ? { kind: PLACE_KIND.VERSION_HISTORY, taskId: boundFor, spot, listed: historyListed }
      : {
          kind: PLACE_KIND.TASK,
          taskId: boundFor,
          panel: narrow ? { open: panelOpen, tab: panelTab } : undefined,
        };
  }, [
    known,
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
    inboxOpen,
    inboxListed,
    inboxAlone,
    pageAgent,
    pagePerson,
    personName,
    listedWorkspace,
    factoryOpen,
    automationsOpen,
    automationsPage,
    chatOpen,
    chatListed,
    chatAlone,
    boardOpen,
  ]);
  const reachable = (to: Place) => {
    // Factory is an experiment, so back and forward pass over it while it is off.
    if (to.kind === PLACE_KIND.FACTORY) return factoryOn;
    // An automation's page is of the workspace it stood in, whose automations alone it reads, so Back passes over it once another is listed, and once it is deleted.
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      if (to.page.kind !== AUTOMATIONS_PAGE.EDIT) return true;
      return to.workspaceId === listedWorkspace && !deletedAutomations.has(to.page.automationId);
    }
    // Chat is the chat of the workspace it stood in, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.CHAT) return chatOn && to.workspaceId === listedWorkspace;
    // The Board is a workspace's tasks, so Back passes over it once another is listed.
    if (to.kind === PLACE_KIND.BOARD) return to.workspaceId === listedWorkspace;
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
    if (to.kind === PLACE_KIND.FACTORY) {
      tasks.factoryView.onOpen();
      return;
    }
    if (to.kind === PLACE_KIND.AUTOMATIONS) {
      tasks.automationsView.onOpen(to.page);
      return;
    }
    if (to.kind === PLACE_KIND.CHAT) {
      if (to.shown !== undefined) {
        tasks.chatView.onShow(to.shown);
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
    // Every other place of the Plans tab is the plan's, which the Inbox, an agent's or a person's page, Factory, the Automations page, Chat, and the Board stand over.
    if (inboxOpen) tasks.inboxView.onClose();
    if (pageAgent !== undefined) tasks.agentView.onClose();
    if (pagePerson !== undefined) tasks.personView.onClose();
    if (factoryOpen) tasks.factoryView.onClose();
    if (automationsOpen) tasks.automationsView.onClose();
    if (chatOpen) tasks.chatView.onClose();
    if (boardOpen) tasks.boardView.onClose();
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
    if (to.kind === PLACE_KIND.TASK && boundFor !== to.taskId) tasks.onSelect(to.taskId);
    if (to.kind === PLACE_KIND.TASK && to.panel !== undefined) standPanel(to.taskId, to.panel);
    if (to.kind === PLACE_KIND.HOME && boundFor !== undefined) tasks.onLeaveTask();
  };
  // The side panel as a narrow room's step held it: shut, or open on its tab.
  const standPanel = (taskId: string, panel: PanelStep) => {
    const { sidePanel } = tasks;
    if (panel.open && panel.tab !== undefined) sidePanel.onShow(taskId, panel.tab);
    else sidePanel.onSetOpen(panel.open);
  };
  const { backTo, upTo, ...history } = useHistory({
    place,
    address: addressOf(input.link),
    reachable,
    go,
    guard: tasks.leaveGuard.guard,
  });
  // Note that only a narrow room holds a list as a step of its own, so a wide one only stands it.
  const up = (to: Place, stand: () => void) => (narrow ? upTo(to, stand) : stand());
  return {
    ...history,
    onLeaveVersionHistory: () => {
      if (boundFor !== undefined && backTo({ kind: PLACE_KIND.TASK, taskId: boundFor })) return;
      tasks.history.onClose();
    },
    lists: {
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
      inbox: (listed) =>
        listed
          ? up({ kind: PLACE_KIND.INBOX, listed: true }, () => tasks.inboxView.onListed(true))
          : tasks.inboxView.onListed(false),
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
