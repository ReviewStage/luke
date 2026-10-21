import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { SIDE_PANEL_TAB, type SidePanelTab } from "../tasks/use-side-panel.js";
import {
  arrived,
  forgotten,
  STOP_KIND,
  type Stop,
  SWITCH_STEP,
  SWITCHER_CARDS,
  SWITCHER_LET_GO,
  SWITCHER_PLACE,
  type SwitcherState,
  shownStops,
  switcherChose,
  switcherPressed,
  switcherShown,
  switcherTarget,
  visited,
  type WindowStanding,
} from "./tab-switcher-model.js";

/**
 * tab-switcher-model.test.ts -- ⌃Tab's order and its keys: the stops most
 * recent first across both strips and every task, a tap flipping to the one
 * before, a hold stepping on and back around the cards, and a let-go on the
 * stop the window stands on going nowhere.
 */

const agentTab = (taskId: string, agent: string): Stop => ({
  kind: STOP_KIND.COLUMN,
  taskId,
  tab: { agent },
});
const panelTab = (taskId: string, tab: SidePanelTab): Stop => ({
  kind: STOP_KIND.PANEL,
  taskId,
  tab,
});
const inbox: Stop = { kind: STOP_KIND.PLACE, place: SWITCHER_PLACE.INBOX };
const home: Stop = { kind: STOP_KIND.PLACE, place: SWITCHER_PLACE.HOME };

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
  test("are most recent first, both strips and every task in one list, each once", () => {
    const plan = panelTab("a", SIDE_PANEL_TAB.PLAN);
    const stops = walked(agentTab("a", "x"), plan, agentTab("b", "y"), inbox, plan);
    assert.deepEqual(stops, [plan, inbox, agentTab("b", "y"), agentTab("a", "x")]);
  });

  test("tell one task's tab from the same tab on another", () => {
    const stops = walked(panelTab("a", { file: "f.ts" }), panelTab("b", { file: "f.ts" }));
    assert.equal(stops.length, 2);
  });

  test("let a closed tab go and keep the rest in order", () => {
    const stops = walked(agentTab("a", "x"), agentTab("a", "y"), inbox);
    const kept = forgotten(
      stops,
      (stop) => stop.kind === STOP_KIND.COLUMN && stop.tab.agent === "y",
    );
    assert.deepEqual(kept, [inbox, agentTab("a", "x")]);
  });
});

describe("⌃Tab", () => {
  const stops = walked(home, agentTab("b", "y"), inbox, panelTab("a", SIDE_PANEL_TAB.PLAN));
  const here = stops[0];

  test("tapped, goes to the stop before this one and shows nothing", () => {
    const state = pressed(stops, here, SWITCH_STEP.ON);
    assert.equal(state.held && state.shown, false);
    assert.deepEqual(switcherTarget(state), inbox);
  });

  test("tapped twice flips back, since the stop left is now the one before", () => {
    const first = switcherTarget(pressed(stops, here, SWITCH_STEP.ON));
    assert.ok(first !== undefined);
    const after = visited(stops, first);
    assert.deepEqual(switcherTarget(pressed(after, first, SWITCH_STEP.ON)), here);
  });

  test("held, shows the cards once the hold is long enough, the stop here first", () => {
    const state = switcherShown(pressed(stops, here, SWITCH_STEP.ON));
    assert.ok(state.held);
    assert.equal(state.shown, true);
    assert.deepEqual(state.cards[0], here);
    assert.equal(state.chosen, 1);
  });

  test("pressed again while held steps on and shows the cards at once, wrapping past the last", () => {
    const twice = pressed(stops, here, SWITCH_STEP.ON, SWITCH_STEP.ON);
    assert.ok(twice.held && twice.shown);
    assert.deepEqual(switcherTarget(twice), agentTab("b", "y"));
    const around = pressed(
      stops,
      here,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
      SWITCH_STEP.ON,
    );
    assert.equal(switcherTarget(around), undefined, "back on the stop here, so nothing moves");
  });

  test("with ⇧ steps back, starting from the last card", () => {
    assert.deepEqual(switcherTarget(pressed(stops, here, SWITCH_STEP.BACK)), home);
    assert.deepEqual(
      switcherTarget(pressed(stops, here, SWITCH_STEP.BACK, SWITCH_STEP.BACK)),
      agentTab("b", "y"),
    );
  });

  test("shows no more than five cards", () => {
    const many = walked(...Array.from({ length: 9 }, (_, at) => agentTab("a", String(at))));
    const state = pressed(many, many[0], SWITCH_STEP.BACK);
    assert.ok(state.held);
    assert.equal(state.cards.length, SWITCHER_CARDS);
    assert.deepEqual(switcherTarget(state), agentTab("a", "4"));
  });

  test("a card pointed at is the one chosen", () => {
    const state = switcherChose(pressed(stops, here, SWITCH_STEP.ON), 3);
    assert.deepEqual(switcherTarget(state), home);
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
    factory: false,
    board: false,
    automations: false,
    boundFor: "a",
    openTaskId: "a",
    column: { agent: "x" },
    panel: SIDE_PANEL_TAB.PLAN,
  };

  test("is the open task's two tabs, or the task where it shows neither", () => {
    assert.deepEqual(shownStops(standing), [
      agentTab("a", "x"),
      panelTab("a", SIDE_PANEL_TAB.PLAN),
    ]);
    assert.deepEqual(shownStops({ ...standing, column: undefined, panel: undefined }), [
      { kind: STOP_KIND.TASK, taskId: "a" },
    ]);
  });

  test("is the place standing in the task's place, and Home with no task", () => {
    assert.deepEqual(shownStops({ ...standing, inbox: true }), [inbox]);
    assert.deepEqual(shownStops({ ...standing, boundFor: undefined }), [home]);
    assert.deepEqual(shownStops({ ...standing, agentId: "z" }), [
      { kind: STOP_KIND.AGENT, agentId: "z" },
    ]);
  });

  test("is nothing under Settings or a version history, or while a task is on its way", () => {
    assert.deepEqual(shownStops({ ...standing, over: true }), []);
    assert.deepEqual(shownStops({ ...standing, boundFor: "b" }), []);
  });

  test("puts the strip holding the keyboard first when a task opens on both", () => {
    const after = shownStops(standing);
    const panelFirst = arrived([inbox], [inbox], after, STOP_KIND.PANEL);
    assert.deepEqual(panelFirst[0], panelTab("a", SIDE_PANEL_TAB.PLAN));
    const columnFirst = arrived([inbox], [inbox], after, STOP_KIND.COLUMN);
    assert.deepEqual(columnFirst[0], agentTab("a", "x"));
  });

  test("moves only the tab that changed when the other strip keeps its tab", () => {
    const before = shownStops(standing);
    const stops = arrived([], [], before, STOP_KIND.COLUMN);
    const after = shownStops({ ...standing, panel: { file: "f.ts" } });
    assert.deepEqual(arrived(stops, before, after, STOP_KIND.COLUMN), [
      panelTab("a", { file: "f.ts" }),
      agentTab("a", "x"),
      panelTab("a", SIDE_PANEL_TAB.PLAN),
    ]);
  });
});
