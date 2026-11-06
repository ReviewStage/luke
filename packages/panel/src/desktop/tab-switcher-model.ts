import { type StripTab, sameTab } from "@repo/ui/tab-strip-model";
import type { MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";

const STOPS_KEPT = 40;

const SWITCHER_CARDS = 5;

export const SWITCHER_PLACE = {
  HOME: "home",
  INBOX: "inbox",
  BOARD: "board",
  AUTOMATIONS: "automations",
} as const;

export type SwitcherPlace = (typeof SWITCHER_PLACE)[keyof typeof SWITCHER_PLACE];

export const STOP_KIND = {
  TASK: "task",
  PLACE: "place",
  AGENT: "agent",
  PERSON: "person",
} as const;

export type Stop =
  | {
      readonly kind: typeof STOP_KIND.TASK;
      readonly taskId: string;
      readonly column: MainTab | undefined;
      readonly panel: SidePanelTab | undefined;
      readonly fullScreen: boolean;
    }
  | { readonly kind: typeof STOP_KIND.PLACE; readonly place: SwitcherPlace }
  | { readonly kind: typeof STOP_KIND.AGENT; readonly agentId: string }
  | {
      readonly kind: typeof STOP_KIND.PERSON;
      readonly userId: string;
      readonly name: string | undefined;
      readonly workspaceId: string | undefined;
    };

function sameTabOrNone(a: StripTab | undefined, b: StripTab | undefined): boolean {
  return a === undefined ? b === undefined : sameTab(a, b);
}

export function sameStop(a: Stop, b: Stop): boolean {
  switch (a.kind) {
    case STOP_KIND.TASK:
      return (
        b.kind === a.kind &&
        b.taskId === a.taskId &&
        sameTabOrNone(a.column, b.column) &&
        sameTabOrNone(a.panel, b.panel) &&
        a.fullScreen === b.fullScreen
      );
    case STOP_KIND.PLACE:
      return b.kind === a.kind && b.place === a.place;
    case STOP_KIND.AGENT:
      return b.kind === a.kind && b.agentId === a.agentId;
    case STOP_KIND.PERSON:
      return b.kind === a.kind && b.userId === a.userId && b.workspaceId === a.workspaceId;
  }
}

export function stopTask(stop: Stop): string | undefined {
  return stop.kind === STOP_KIND.TASK ? stop.taskId : undefined;
}

function samePage(a: Stop, b: Stop): boolean {
  if (a.kind === STOP_KIND.TASK) return b.kind === STOP_KIND.TASK && b.taskId === a.taskId;
  return sameStop(a, b);
}

export function visited(stops: readonly Stop[], stop: Stop): readonly Stop[] {
  if (stops[0] !== undefined && sameStop(stops[0], stop)) return stops;
  return [stop, ...stops.filter((each) => !sameStop(each, stop))].slice(0, STOPS_KEPT);
}

export function forgotten(stops: readonly Stop[], gone: (stop: Stop) => boolean): readonly Stop[] {
  const kept = stops.filter((stop) => !gone(stop));
  return kept.length === stops.length ? stops : kept;
}

export type SwitcherState =
  | { readonly held: false }
  | {
      readonly held: true;
      readonly cards: readonly Stop[];
      readonly here: boolean;
      readonly chosen: number;
      readonly shown: boolean;
    };

export const SWITCHER_LET_GO: SwitcherState = { held: false };

export const SWITCH_STEP = {
  ON: 1,
  BACK: -1,
} as const;

export type SwitchStep = (typeof SWITCH_STEP)[keyof typeof SWITCH_STEP];

function wrapped(at: number, count: number): number {
  return ((at % count) + count) % count;
}

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

export function switcherShown(state: SwitcherState): SwitcherState {
  return state.held ? { ...state, shown: true } : state;
}

export function switcherChose(state: SwitcherState, at: number): SwitcherState {
  if (!state.held || at < 0 || at >= state.cards.length) return state;
  return { ...state, chosen: at };
}

export function switcherTarget(state: SwitcherState): Stop | undefined {
  if (!state.held || (state.here && state.chosen === 0)) return undefined;
  return state.cards[state.chosen];
}

export interface WindowStanding {
  readonly over: boolean;
  readonly inbox: boolean;
  readonly agentId: string | undefined;
  readonly person:
    | {
        readonly userId: string;
        readonly name: string | undefined;
        readonly workspaceId: string | undefined;
      }
    | undefined;
  readonly board: boolean;
  readonly automations: boolean;
  readonly home: boolean;
  readonly boundFor: string | undefined;
  readonly openTaskId: string | undefined;
  readonly column: MainTab | undefined;
  readonly panel: SidePanelTab | undefined;
  readonly fullScreen: boolean;
}

export function shownStop(standing: WindowStanding): Stop | undefined {
  if (standing.over) return undefined;
  const place = (place: SwitcherPlace): Stop => ({ kind: STOP_KIND.PLACE, place });
  if (standing.inbox) return place(SWITCHER_PLACE.INBOX);
  if (standing.agentId !== undefined) return { kind: STOP_KIND.AGENT, agentId: standing.agentId };
  if (standing.person !== undefined) return { kind: STOP_KIND.PERSON, ...standing.person };
  if (standing.board) return place(SWITCHER_PLACE.BOARD);
  if (standing.automations) return place(SWITCHER_PLACE.AUTOMATIONS);
  const taskId = standing.boundFor;
  if (taskId === undefined) return standing.home ? place(SWITCHER_PLACE.HOME) : undefined;
  if (taskId !== standing.openTaskId) return undefined;
  const { column, panel } = standing;
  return {
    kind: STOP_KIND.TASK,
    taskId,
    column,
    panel,
    fullScreen: panel !== undefined && standing.fullScreen,
  };
}

export function moved(
  stops: readonly Stop[],
  before: Stop | undefined,
  after: Stop | undefined,
  pressed: boolean,
): readonly Stop[] {
  if (after === undefined) return stops;
  if (before === undefined || pressed || !samePage(before, after) || sameStop(before, after)) {
    return visited(stops, after);
  }
  const rest = stops.filter((stop) => !sameStop(stop, before) && !sameStop(stop, after));
  return [after, ...rest].slice(0, STOPS_KEPT);
}
