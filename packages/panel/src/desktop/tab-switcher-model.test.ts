import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { MainTab } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import {
  forgotten,
  moved,
  STOP_KIND,
  type Stop,
  SWITCH_STEP,
  SWITCHER_CARDS,
  SWITCHER_LET_GO,
  SWITCHER_PLACE,
  type SwitcherState,
  sameStop,
  shownStop,
  switcherChose,
  switcherPressed,
  switcherShown,
  switcherTarget,
  visited,
  type WindowStanding,
} from "./tab-switcher-model.js";

/**
 * tab-switcher-model.test.ts -- ⌃Tab's order and its keys: whole screens
 * most recent first across every task, a task's screen named by both its
 * panes' tabs, a tab chosen by a press a stop of its own and one the window
 * chose by itself taking the stop in place, a tap flipping to the screen
 * before, a hold stepping on and back around the cards, and a let-go on the
 * screen here going nowhere.
 */

const screen = (
  taskId: string,
  column?: MainTab,
  panel?: SidePanelTab,
  fullScreen = false,
): Stop => ({
  kind: STOP_KIND.TASK,
  taskId,
  column,
  panel,
  fullScreen,
});
const inbox: Stop = { kind: STOP_KIND.PLACE, place: SWITCHER_PLACE.INBOX };
const automationsPage: Stop = { kind: STOP_KIND.PLACE, place: SWITCHER_PLACE.AUTOMATIONS };

/** The stops visited in order, the last the most recent. */
function walked(...stops: Stop[]): readonly Stop[] {
  return stops.reduce<readonly Stop[]>((kept, stop) => visited(kept, stop), []);
}

/** The switcher after each press, from let go. */
function pressed(
  stops: readonly Stop[],
  here: Stop | undefined,
  ...steps: (1 | -1)[]
): SwitcherState {
  return steps.reduce<SwitcherState>(
    (state, step) => switcherPressed(state, { stops, here, step }),
    SWITCHER_LET_GO,
  );
}

describe("the stops", () => {
  test("are whole screens, most recent first, every task in one list, each once", () => {
    const work = screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN);
    const stops = walked(work, screen("b", { agent: "y" }), inbox, work);
    assert.deepEqual(stops, [work, inbox, screen("b", { agent: "y" })]);
  });

  test("tell a screen apart by either pane's tab, and a pane showing none from one showing a tab", () => {
    assert.equal(
      sameStop(
        screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN),
        screen("a", { agent: "x" }, SIDE_PANEL_TAB.CODE),
      ),
      false,
    );
    assert.equal(
      sameStop(screen("a", { agent: "x" }), screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN)),
      false,
    );
    assert.equal(
      sameStop(screen("a", undefined, { file: "f.ts" }), screen("a", undefined, { file: "f.ts" })),
      true,
    );
    assert.equal(
      sameStop(screen("a", undefined, { file: "f.ts" }), screen("b", undefined, { file: "f.ts" })),
      false,
    );
  });

  test("let a closed tab's screen go and keep the rest in order", () => {
    const stops = walked(screen("a", { agent: "x" }), screen("a", { agent: "y" }), inbox);
    const kept = forgotten(stops, (stop) => sameStop(stop, screen("a", { agent: "y" })));
    assert.deepEqual(kept, [inbox, screen("a", { agent: "x" })]);
  });
});

describe("a move of the window", () => {
  const work = screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN);

  test("onto a task records one stop for the screen, whatever both its panes show", () => {
    const stops = moved([inbox], inbox, work, false);
    assert.deepEqual(stops, [work, inbox]);
  });

  test("a tab the window chose by itself takes the screen standing in place, so ⌃Tab goes back where you came from", () => {
    const opening = moved([inbox], inbox, screen("a"), true);
    const loaded = moved(opening, screen("a"), work, false);
    assert.deepEqual(loaded, [work, inbox]);
    assert.deepEqual(switcherTarget(pressed(loaded, work, SWITCH_STEP.ON)), inbox);
  });

  test("a tab chosen by a press or a key, in either pane, is a stop of its own", () => {
    const coded = moved(
      [work, inbox],
      work,
      screen("a", { agent: "x" }, SIDE_PANEL_TAB.CODE),
      true,
    );
    assert.deepEqual(coded, [screen("a", { agent: "x" }, SIDE_PANEL_TAB.CODE), work, inbox]);
    const other = moved(coded, coded[0], screen("a", { agent: "z" }, SIDE_PANEL_TAB.CODE), true);
    assert.equal(other.length, 4);
  });

  test("to another page is a stop, pressed or not", () => {
    assert.deepEqual(moved([work], work, inbox, false), [inbox, work]);
  });

  test("onto nothing, as Settings, keeps the stops as they are", () => {
    assert.deepEqual(moved([work, inbox], work, undefined, true), [work, inbox]);
  });
});

describe("⌃Tab", () => {
  const here = screen("a", undefined, SIDE_PANEL_TAB.PLAN);
  const stops = walked(automationsPage, screen("b", { agent: "y" }), inbox, here);

  test("tapped, goes to the screen before this one and shows nothing", () => {
    const state = pressed(stops, here, SWITCH_STEP.ON);
    assert.equal(state.held && state.shown, false);
    assert.deepEqual(switcherTarget(state), inbox);
  });

  test("tapped twice flips back, since the screen left is now the one before", () => {
    const first = switcherTarget(pressed(stops, here, SWITCH_STEP.ON));
    assert.ok(first !== undefined);
    const after = visited(stops, first);
    assert.deepEqual(switcherTarget(pressed(after, first, SWITCH_STEP.ON)), here);
  });

  test("held, shows the cards once the hold is long enough, the screen here first", () => {
    const state = switcherShown(pressed(stops, here, SWITCH_STEP.ON));
    assert.ok(state.held);
    assert.equal(state.shown, true);
    assert.deepEqual(state.cards[0], here);
    assert.equal(state.chosen, 1);
  });

  test("pressed again while held steps on and shows the cards at once, wrapping past the last", () => {
    const twice = pressed(stops, here, SWITCH_STEP.ON, SWITCH_STEP.ON);
    assert.ok(twice.held && twice.shown);
    assert.deepEqual(switcherTarget(twice), screen("b", { agent: "y" }));
    const around = pressed(
      stops,
      here,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
    );
    assert.equal(switcherTarget(around), undefined, "back on the screen here, so nothing moves");
  });

  test("with ⇧ steps back, starting from the last card", () => {
    assert.deepEqual(switcherTarget(pressed(stops, here, SWITCH_STEP.BACK)), automationsPage);
    assert.deepEqual(
      switcherTarget(pressed(stops, here, SWITCH_STEP.BACK, SWITCH_STEP.BACK)),
      screen("b", { agent: "y" }),
    );
  });

  test("shows no more than five cards", () => {
    const many = walked(
      ...Array.from({ length: 9 }, (_, at) => screen("a", { agent: String(at) })),
    );
    const state = pressed(many, many[0], SWITCH_STEP.BACK);
    assert.ok(state.held);
    assert.equal(state.cards.length, SWITCHER_CARDS);
    assert.deepEqual(switcherTarget(state), screen("a", { agent: "4" }));
  });

  test("a card pointed at is the one chosen", () => {
    const state = switcherChose(pressed(stops, here, SWITCH_STEP.ON), 3);
    assert.deepEqual(switcherTarget(state), automationsPage);
  });

  test("with nothing else to go to, holds nothing", () => {
    assert.equal(pressed([inbox], inbox, SWITCH_STEP.ON).held, false);
  });

  test("from somewhere that is no stop, as Settings, goes to the most recent stop", () => {
    assert.deepEqual(switcherTarget(pressed(stops, undefined, SWITCH_STEP.ON)), here);
  });
});

describe("what is on screen", () => {
  const standing: WindowStanding = {
    over: false,
    chat: false,
    inbox: false,
    agentId: undefined,
    person: undefined,
    board: false,
    automations: false,
    boundFor: "a",
    openTaskId: "a",
    column: { agent: "x" },
    panel: SIDE_PANEL_TAB.PLAN,
    fullScreen: false,
  };

  test("is the open task with both its panes' tabs, either of them none", () => {
    assert.deepEqual(shownStop(standing), screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN));
    assert.deepEqual(
      shownStop({ ...standing, column: { draft: "d" }, panel: undefined }),
      screen("a", { draft: "d" }),
    );
    assert.deepEqual(shownStop({ ...standing, column: undefined, panel: undefined }), screen("a"));
  });

  test("keeps the column's tab under a panel filling the window, the screen told apart by it", () => {
    const filled = shownStop({ ...standing, fullScreen: true });
    assert.deepEqual(filled, screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN, true));
    assert.equal(
      filled !== undefined && sameStop(filled, screen("a", { agent: "x" }, SIDE_PANEL_TAB.PLAN)),
      false,
    );
  });

  test("is the place standing in the task's place, and none with no task and nothing in its place", () => {
    assert.deepEqual(shownStop({ ...standing, inbox: true }), inbox);
    assert.equal(shownStop({ ...standing, boundFor: undefined }), undefined);
    assert.deepEqual(shownStop({ ...standing, agentId: "z" }), {
      kind: STOP_KIND.AGENT,
      agentId: "z",
    });
  });

  test("is nothing under Settings or a version history, or while a task is on its way", () => {
    assert.equal(shownStop({ ...standing, over: true }), undefined);
    assert.equal(shownStop({ ...standing, boundFor: "b" }), undefined);
  });
});
