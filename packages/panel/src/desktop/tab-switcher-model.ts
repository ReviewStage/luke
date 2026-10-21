/**
 * tab-switcher-model.ts -- what ⌃Tab steps through: the window's tabs and places in the order they were last used, across every task, and how a press, a hold, and a let-go move through them.
 *
 * A stop is somewhere the window stood: one tab of a task's column or of its
 * side panel, a task with neither on screen, or a place the window shows in
 * the task's place, Home, the Inbox, Chat, the Board, Automations, Factory,
 * an agent's own page, or a person's. Settings and a version history are no
 * stop, since each is a layer over the window rather than a place in it. The
 * stops are kept most recent first (`visited`), one list for both strips and
 * every task, so ⌃Tab and a let-go is the stop before this one wherever it
 * was, as ⌘Tab is the app before this one.
 *
 * The switcher (`tab-switcher.tsx`) shows the first few as cards. A press of
 * ⌃Tab chooses the card after the one the window stands on, and ⌃⇧Tab the
 * last, the choice wrapping around; another press while ⌃ is held moves it
 * one card on, or one back. Letting go of ⌃ goes to the card chosen, so a
 * quick tap flips between two stops and shows nothing. Held a beat, the
 * cards show. Escape lets go of nothing.
 */

import { type AgentStripTab, sameTab } from "@luke/ui/tab-strip-model";
import type { SidePanelTab } from "../tasks/use-side-panel.js";

/** How many stops the window keeps, most recent first: far more than the cards, so a closed tab's place is filled from further back. */
const STOPS_KEPT = 40;

/** How many cards the switcher shows, the stop the window stands on among them, as ⌘Tab counts the app in front. */
export const SWITCHER_CARDS = 5;

/** The places the window shows in a task's place, each opened by its own door. */
export const SWITCHER_PLACE = {
  HOME: "home",
  INBOX: "inbox",
  CHAT: "chat",
  BOARD: "board",
  AUTOMATIONS: "automations",
  FACTORY: "factory",
} as const;

export type SwitcherPlace = (typeof SWITCHER_PLACE)[keyof typeof SWITCHER_PLACE];

/** The kinds of stop. */
export const STOP_KIND = {
  /** One agent's tab in a task's column. */
  COLUMN: "column",
  /** One tab of a task's side panel. */
  PANEL: "panel",
  /** A task showing neither: no agent's tab, and its panel shut. */
  TASK: "task",
  PLACE: "place",
  /** An agent's own page, which stands in the task's place. */
  AGENT: "agent",
  /** A person's page. */
  PERSON: "person",
} as const;

export type Stop =
  | {
      readonly kind: typeof STOP_KIND.COLUMN;
      readonly taskId: string;
      readonly tab: AgentStripTab;
    }
  | { readonly kind: typeof STOP_KIND.PANEL; readonly taskId: string; readonly tab: SidePanelTab }
  | { readonly kind: typeof STOP_KIND.TASK; readonly taskId: string }
  | { readonly kind: typeof STOP_KIND.PLACE; readonly place: SwitcherPlace }
  | { readonly kind: typeof STOP_KIND.AGENT; readonly agentId: string }
  | {
      readonly kind: typeof STOP_KIND.PERSON;
      readonly userId: string;
      readonly name: string | undefined;
      readonly workspaceId: string | undefined;
    };

/** Whether two stops are the same place: a tab by the tab it is, on the same task. */
export function sameStop(a: Stop, b: Stop): boolean {
  switch (a.kind) {
    case STOP_KIND.COLUMN:
    case STOP_KIND.PANEL:
      return b.kind === a.kind && b.taskId === a.taskId && sameTab(b.tab, a.tab);
    case STOP_KIND.TASK:
      return b.kind === a.kind && b.taskId === a.taskId;
    case STOP_KIND.PLACE:
      return b.kind === a.kind && b.place === a.place;
    case STOP_KIND.AGENT:
      return b.kind === a.kind && b.agentId === a.agentId;
    case STOP_KIND.PERSON:
      return b.kind === a.kind && b.userId === a.userId && b.workspaceId === a.workspaceId;
  }
}

/** The task a stop is on, none for a place. */
export function stopTask(stop: Stop): string | undefined {
  return stop.kind === STOP_KIND.COLUMN ||
    stop.kind === STOP_KIND.PANEL ||
    stop.kind === STOP_KIND.TASK
    ? stop.taskId
    : undefined;
}

/** The stops with `stop` the most recent, taken out of wherever it stood before. */
export function visited(stops: readonly Stop[], stop: Stop): readonly Stop[] {
  if (stops[0] !== undefined && sameStop(stops[0], stop)) return stops;
  return [stop, ...stops.filter((each) => !sameStop(each, stop))].slice(0, STOPS_KEPT);
}

/** The stops without those `gone` says no longer stand, such as a tab closed or a task deleted. */
export function forgotten(stops: readonly Stop[], gone: (stop: Stop) => boolean): readonly Stop[] {
  const kept = stops.filter((stop) => !gone(stop));
  return kept.length === stops.length ? stops : kept;
}

/** Where the switcher stands: let go, or held with its cards, the one chosen, and whether they show. */
export type SwitcherState =
  | { readonly held: false }
  | {
      readonly held: true;
      readonly cards: readonly Stop[];
      /** Whether the first card is the stop the window stands on, which a let-go there leaves as it is. */
      readonly here: boolean;
      readonly chosen: number;
      readonly shown: boolean;
    };

export const SWITCHER_LET_GO: SwitcherState = { held: false };

/** Which way a press steps: on to the next card, or back. */
export const SWITCH_STEP = {
  ON: 1,
  BACK: -1,
} as const;

export type SwitchStep = (typeof SWITCH_STEP)[keyof typeof SWITCH_STEP];

function wrapped(at: number, count: number): number {
  return ((at % count) + count) % count;
}

/**
 * The switcher after a press of ⌃Tab (`ON`) or ⌃⇧Tab (`BACK`). The first
 * press holds it on the cards as they stand, choosing the card after the one
 * the window stands on, or the last; a press while held steps the choice
 * and shows the cards. With nothing to switch to it stays let go.
 */
export function switcherPressed(
  state: SwitcherState,
  input: {
    readonly stops: readonly Stop[];
    readonly here: Stop | undefined;
    readonly step: SwitchStep;
  },
): SwitcherState {
  if (state.held) {
    return {
      ...state,
      chosen: wrapped(state.chosen + input.step, state.cards.length),
      shown: true,
    };
  }
  const cards = input.stops.slice(0, SWITCHER_CARDS);
  const first = cards[0];
  const here = input.here !== undefined && first !== undefined && sameStop(first, input.here);
  if (cards.length < (here ? 2 : 1)) return state;
  const after = here ? 1 : 0;
  const chosen = input.step === SWITCH_STEP.ON ? after : cards.length - 1;
  return { held: true, cards, here, chosen, shown: false };
}

/** The switcher once ⌃ was held long enough to show its cards. */
export function switcherShown(state: SwitcherState): SwitcherState {
  return state.held ? { ...state, shown: true } : state;
}

/** The switcher with the card at `at` chosen, as the pointer resting on it chooses it. */
export function switcherChose(state: SwitcherState, at: number): SwitcherState {
  if (!state.held || at < 0 || at >= state.cards.length) return state;
  return { ...state, chosen: at };
}

/** The stop a let-go goes to: the card chosen, or none where it is the one the window stands on. */
export function switcherTarget(state: SwitcherState): Stop | undefined {
  if (!state.held || (state.here && state.chosen === 0)) return undefined;
  return state.cards[state.chosen];
}

/**
 * Where the window stands, as the switcher reads it: the layers over it, the
 * place in the task's place, and the open task's two tabs, read in the order
 * the shell draws them (`desktop-shell.tsx`).
 */
export interface WindowStanding {
  /** Settings or a version history stands over the window, which is no stop. */
  readonly over: boolean;
  readonly chat: boolean;
  readonly inbox: boolean;
  readonly agentId: string | undefined;
  readonly person:
    | {
        readonly userId: string;
        readonly name: string | undefined;
        readonly workspaceId: string | undefined;
      }
    | undefined;
  readonly factory: boolean;
  readonly board: boolean;
  readonly automations: boolean;
  /** The task the window is on, or on its way to; none on Home. */
  readonly boundFor: string | undefined;
  /** The task the host has open, which the tabs below are of. */
  readonly openTaskId: string | undefined;
  /** The column's tab, none where it shows none or the panel fills the window over it. */
  readonly column: AgentStripTab | undefined;
  /** The side panel's tab, none while it is shut. */
  readonly panel: SidePanelTab | undefined;
}

/**
 * The stops on screen now: the place standing in the task's place, or the
 * open task's column tab and panel tab, or the task itself where it shows
 * neither. None under Settings or a version history, and none while a task
 * is on its way, so a half-open task is never a stop.
 */
export function shownStops(standing: WindowStanding): readonly Stop[] {
  if (standing.over) return [];
  const place = (place: SwitcherPlace): readonly Stop[] => [{ kind: STOP_KIND.PLACE, place }];
  if (standing.chat) return place(SWITCHER_PLACE.CHAT);
  if (standing.inbox) return place(SWITCHER_PLACE.INBOX);
  if (standing.agentId !== undefined) return [{ kind: STOP_KIND.AGENT, agentId: standing.agentId }];
  if (standing.person !== undefined) return [{ kind: STOP_KIND.PERSON, ...standing.person }];
  if (standing.factory) return place(SWITCHER_PLACE.FACTORY);
  if (standing.board) return place(SWITCHER_PLACE.BOARD);
  if (standing.automations) return place(SWITCHER_PLACE.AUTOMATIONS);
  const taskId = standing.boundFor;
  if (taskId === undefined) return place(SWITCHER_PLACE.HOME);
  if (taskId !== standing.openTaskId) return [];
  const tabs: Stop[] = [];
  if (standing.column !== undefined)
    tabs.push({ kind: STOP_KIND.COLUMN, taskId, tab: standing.column });
  if (standing.panel !== undefined)
    tabs.push({ kind: STOP_KIND.PANEL, taskId, tab: standing.panel });
  return tabs.length > 0 ? tabs : [{ kind: STOP_KIND.TASK, taskId }];
}

/**
 * The stops after the window moved from showing `before` to showing
 * `after`: each stop newly on screen visited, the one in the strip that
 * holds the keyboard (`front`) last, so it is the most recent.
 */
export function arrived(
  stops: readonly Stop[],
  before: readonly Stop[],
  after: readonly Stop[],
  front: typeof STOP_KIND.COLUMN | typeof STOP_KIND.PANEL,
): readonly Stop[] {
  const fresh = after.filter((stop) => !before.some((each) => sameStop(each, stop)));
  const ordered = [
    ...fresh.filter((stop) => stop.kind !== front),
    ...fresh.filter((stop) => stop.kind === front),
  ];
  return ordered.reduce(visited, stops);
}
