import { MERGE_POLICY, TASK_MODE } from "@luke/features/task-wire";
import { expect, it } from "vitest";
import { mergePolicySwitchOf, runningSwitchOf } from "./pilot-switches.js";

/**
 * pilot-switches.test.ts -- a pilot tree's switches stand on its top task
 * alone, never on a child task, which follows its top task, nor on a task
 * worked by its agents; and a top task from a service before the running
 * switch reads as stopped.
 */

it.each([
  {
    task: { mode: TASK_MODE.PILOT, mergePolicy: MERGE_POLICY.HOLD, running: true },
    shown: { mergePolicy: MERGE_POLICY.HOLD, running: true },
  },
  {
    task: { mode: TASK_MODE.PILOT },
    shown: { mergePolicy: MERGE_POLICY.MERGE_ON_GREEN, running: false },
  },
  {
    task: {
      mode: TASK_MODE.PILOT,
      parentTaskId: "5b0c1a52-5d2f-4f5e-9b8e-0c3d6f1e2a47",
      mergePolicy: MERGE_POLICY.HOLD,
      running: true,
    },
    shown: { mergePolicy: undefined, running: undefined },
  },
  {
    task: { mode: TASK_MODE.AGENT, mergePolicy: MERGE_POLICY.MERGE_ON_GREEN, running: true },
    shown: { mergePolicy: undefined, running: undefined },
  },
])("a $task.mode task's head switches $shown", ({ task, shown }) => {
  expect({ mergePolicy: mergePolicySwitchOf(task), running: runningSwitchOf(task) }).toEqual(shown);
});
