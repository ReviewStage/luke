import assert from "node:assert/strict";
import { agentTab, fileTab } from "@repo/ui/tab-strip-model";
import { test } from "vitest";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { STEP_WITHIN, type StepLed, type StepShown, stepWithin } from "./task-step.js";

/**
 * task-step.test.ts -- what a task's step shows within its page written as
 * Back and Forward keep it: a step of its own where the developer led to
 * it or a narrow room's pane opened over another, the standing step taken
 * in place where the window settled on it, and the standing step itself
 * where only what was not yet known arrived. Synthetic ids.
 */

const PRESSED: StepLed = { pressed: true, opened: false };
const BY_ITSELF: StepLed = { pressed: false, opened: false };
const OPENED: StepLed = { pressed: false, opened: true };

const AGENT_A = agentTab("agent-a");
const AGENT_B = agentTab("agent-b");
const NOTES = fileTab("docs/notes.md");

test.each<readonly [string, StepShown, StepShown, StepLed, string]>([
  [
    "a column tab a press led to is a step of its own",
    { column: AGENT_A, side: null },
    { column: AGENT_B, side: null },
    PRESSED,
    STEP_WITHIN.VISIT,
  ],
  [
    "a column tab the window chose by itself, as an agent's tab shown as it starts, takes the standing step in place",
    { column: AGENT_A, side: null },
    { column: AGENT_B, side: null },
    BY_ITSELF,
    STEP_WITHIN.SETTLE,
  ],
  [
    "a side panel tab chosen in its strip, by a press no door naming a thing made, takes the standing step in place",
    { column: AGENT_A, side: SIDE_PANEL_TAB.COMMENTS },
    { column: AGENT_A, side: NOTES },
    PRESSED,
    STEP_WITHIN.SETTLE,
  ],
  [
    "a page a door naming it opened in the side panel is a step of its own",
    { column: AGENT_A, side: null },
    { column: AGENT_A, side: NOTES },
    OPENED,
    STEP_WITHIN.VISIT,
  ],
  [
    "a task's tabs arriving after it opens fill in the standing step",
    { column: undefined, side: undefined },
    { column: AGENT_A, side: SIDE_PANEL_TAB.COMMENTS },
    PRESSED,
    STEP_WITHIN.SAME,
  ],
  [
    "a narrow room's side panel opened over the plan is a step of its own, though no press led to it",
    { column: AGENT_A, panel: { open: false, tab: undefined } },
    { column: AGENT_A, panel: { open: true, tab: NOTES } },
    BY_ITSELF,
    STEP_WITHIN.VISIT,
  ],
])("%s", (_rule, standing, next, led, written) => {
  assert.equal(stepWithin(standing, next, led), written);
});
