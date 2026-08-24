import type { AppSettingsView } from "#shared/wire/settings";
import { ERRAND_WAIT, type ErrandTarget, type ErrandWait } from "./luke-errand";
import type { PanelTab } from "./panel-tabs";
import type { SessionArrangement } from "./session-model";
import type { SettingsView } from "./settings-views";

/**
 * The order Luke signs his own work in, when one reply asked for more than one
 * act.
 *
 * A reply may carry several tool calls, and they are answered one after
 * another with nothing between them but a couple of IPC round trips — far
 * inside the beat an errand waits before it sets off. So the acts arrive as a
 * burst and the flights cannot: there is only ever one Luke on screen, one
 * panel, and one settings page drawn at a time, and each of those is something
 * a second act would take out from under the first. Handed straight to the
 * flight, the second act ends the first mid-air: the mark never leaves the
 * strip, both controls flip at once, and only the last act is seen being done
 * — which is the whole of what an errand is for.
 *
 * So the acts queue and the flights run in turn. Each act carries what it is
 * holding back — the settings snapshot the store answered with, or the
 * narrowing a spoken ask chose — so a hold belongs to the act that caught it
 * rather than to whichever flight happens to be out, and each is drawn on its
 * own tap. Each also carries where it has to be seen, so the panel is turned
 * to a page when the act that needs it comes up rather than when it was asked
 * for: a page turned at the ask would take the first act's control off screen
 * before Luke ever reached it.
 *
 * Two flights in sequence cost more than one, and that is the deliberate
 * choice. A chained flight waits only a beat, and the panel stays up across
 * the whole run rather than standing down and coming back — so the second act
 * costs one flight and nothing else. Folding several acts into one flight with
 * a stop on each control would be shorter still, and it was rejected: the two
 * settings may live on different pages, a page that is not drawn has nowhere
 * to land, and the page cannot turn under a mark in the air without the errand
 * deciding when to turn it — which is exactly the one thing the errand does
 * not do. A merged flight could therefore only ever cover the same-page case,
 * leaving two mechanisms where one does. Two acts are also two acts, and each
 * is worth being seen being done.
 *
 * Every function here is pure, and every hold that goes in comes out exactly
 * once — at the tap that signs it, when the flight it belonged to is over, or
 * in the flush that ends a run nobody can watch any more. A hold nobody
 * releases strands a switch showing the wrong state for as long as the panel
 * is open.
 */

/** What an act is holding back until Luke's tap lands on the control. */
export interface ErrandHold {
  /** The snapshot the settings store answered the write with. */
  settings?: AppSettingsView;
  /** The narrowing or re-ordering a spoken ask chose for the list. */
  view?: Partial<SessionArrangement>;
}

/** Holding nothing, which is what a run with everything drawn answers. */
export const NOTHING_HELD: ErrandHold = {};

/** One act waiting to be signed. */
export interface PendingErrand {
  /** Where it should be signed, best first. An act with none flies nowhere. */
  targets: readonly ErrandTarget[];
  /** The tab its control is drawn on. */
  tab: PanelTab;
  /** The settings page it is drawn on, when it is drawn on one at all. */
  page?: SettingsView;
  /** Whether this act is what stood the panel up. */
  opening: boolean;
  /**
   * Whether the panel is only borrowed to show this act. A switch has to be
   * seen moving, so a settings change stands the panel up to show one and
   * gives it back when the run is over; a panel someone asked for out loud is
   * the answer itself and stays where it was put.
   */
  borrowsPanel: boolean;
  hold: ErrandHold;
}

/** Every act one reply asked Luke to sign: the one in the air, then the rest. */
export interface ErrandRun {
  /** The act being signed right now, once it has been handed to the flight. */
  flying?: PendingErrand;
  /** The acts still waiting their turn, oldest first. */
  waiting: readonly PendingErrand[];
}

/** Nothing in the air and nothing waiting. */
export const EMPTY_ERRAND_RUN: ErrandRun = { waiting: [] };

/** Whether there is nothing left to sign, which is when a panel may stand down. */
export function errandRunIdle(run: ErrandRun): boolean {
  return run.flying === undefined && run.waiting.length === 0;
}

/** Adds an act to the end of the run. */
export function armErrand(run: ErrandRun, pending: PendingErrand): ErrandRun {
  return { ...run, waiting: [...run.waiting, pending] };
}

/**
 * The next act to hand to the flight, and the run with it in the air. Nothing
 * while one is already out — that is the whole point — and nothing when there
 * is none left waiting.
 */
export function nextErrand(run: ErrandRun) {
  if (run.flying !== undefined) return { run } satisfies { run: ErrandRun; launch?: PendingErrand };
  const [next, ...rest] = run.waiting;
  if (next === undefined) return { run } satisfies { run: ErrandRun; launch?: PendingErrand };
  return { run: { flying: next, waiting: rest }, launch: next } satisfies {
    run: ErrandRun;
    launch?: PendingErrand;
  };
}

/**
 * Several holds drawn as one. The newest snapshot is the only true one — they
 * are cumulative, so the last carries every change made before it — while the
 * view patches are folded in the order they were chosen, because each names
 * only the part of the view it changed.
 */
export function foldErrandHolds(holds: readonly ErrandHold[]): ErrandHold {
  let settings: AppSettingsView | undefined;
  let view: Partial<SessionArrangement> | undefined;
  for (const hold of holds) {
    if (hold.settings !== undefined) settings = hold.settings;
    if (hold.view !== undefined) view = { ...view, ...hold.view };
  }
  return {
    ...(settings === undefined ? undefined : { settings }),
    ...(view === undefined ? undefined : { view }),
  };
}

/**
 * The tap has landed: what the act in the air was holding is drawn, and it is
 * left holding nothing, so the end of its own flight draws it no second time.
 */
export function landErrand(run: ErrandRun) {
  const flying = run.flying;
  if (flying === undefined) {
    return { run, hold: NOTHING_HELD } satisfies { run: ErrandRun; hold: ErrandHold };
  }
  return {
    run: { ...run, flying: { ...flying, hold: NOTHING_HELD } },
    hold: flying.hold,
  } satisfies { run: ErrandRun; hold: ErrandHold };
}

/**
 * The flight is over. The act leaves the air, and anything it is somehow still
 * holding is drawn — a flight that never reached its control still has to
 * leave the switch showing the truth.
 */
export function finishErrand(run: ErrandRun) {
  const flying = run.flying;
  if (flying === undefined) {
    return { run, hold: NOTHING_HELD } satisfies { run: ErrandRun; hold: ErrandHold };
  }
  return { run: { waiting: run.waiting }, hold: flying.hold } satisfies {
    run: ErrandRun;
    hold: ErrandHold;
  };
}

/**
 * The run cannot go on: the panel that was going to show it has gone, so there
 * is nothing to sign in front of anybody. Everything still held is drawn at
 * once, in the order it was caught.
 */
export function flushErrands(run: ErrandRun) {
  const held = [
    ...(run.flying === undefined ? [] : [run.flying.hold]),
    ...run.waiting.map((pending) => pending.hold),
  ];
  return { run: EMPTY_ERRAND_RUN, hold: foldErrandHolds(held) } satisfies {
    run: ErrandRun;
    hold: ErrandHold;
  };
}

/**
 * Another window changed the settings. Its push is newer than anything this
 * run is still carrying, so it takes every held snapshot with it: released
 * afterwards, one caught before the push arrived would draw the store as it
 * was rather than as it is. A held view is left alone — it is this window's own
 * choice about its own list, and no other window has said anything about it.
 */
export function supersedeErrandSettings(run: ErrandRun): ErrandRun {
  const superseded = (pending: PendingErrand): PendingErrand => {
    if (pending.hold.settings === undefined) return pending;
    const { settings: _stale, ...kept } = pending.hold;
    return { ...pending, hold: kept };
  };
  return {
    ...(run.flying === undefined ? undefined : { flying: superseded(run.flying) }),
    waiting: run.waiting.map(superseded),
  };
}

/**
 * Whether the panel is still the run's to put away once this act has been
 * taken up.
 *
 * A run signs its acts in turn under one panel, so the question is asked of
 * the run rather than of any single act. An act that borrows the panel to show
 * a switch claims it back only if it is the one that stood it up — a panel
 * that was already open is somewhere the developer had gone themselves. An act
 * that asked for the panel in its own right disclaims it outright, whichever
 * act put it there: once someone has asked out loud to see the panel, closing
 * it afterwards is taking it from them for having spoken.
 */
export function errandBorrowedPanel(borrowed: boolean, launch: PendingErrand): boolean {
  if (!launch.borrowsPanel) return false;
  return borrowed || launch.opening;
}

/**
 * A panel that had to open is a whole page of content arriving. Settings pages
 * swap without motion, but a page whose height changes still has to wait for
 * the black surface to reach its newly mounted control.
 */
export function errandWait(input: { opening: boolean; surfaceChanging: boolean }): ErrandWait {
  if (input.opening) return ERRAND_WAIT.CONTENT;
  return input.surfaceChanging ? ERRAND_WAIT.SURFACE : ERRAND_WAIT.AT_ONCE;
}
