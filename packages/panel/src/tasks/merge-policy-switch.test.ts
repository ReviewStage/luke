import { MERGE_POLICY, TASK_MODE } from "@luke/features/task-wire";
import { expect, it } from "vitest";
import { mergePolicySwitchOf } from "./merge-policy-switch.js";

/**
 * merge-policy-switch.test.ts -- the merge-policy switch stands on a pilot
 * tree's top task alone, never on a child task, which follows its top
 * task's policy, nor on a task worked by its agents.
 */

it.each([
  {
    task: { mode: TASK_MODE.PILOT, mergePolicy: MERGE_POLICY.HOLD },
    shown: MERGE_POLICY.HOLD,
  },
  {
    task: {
      mode: TASK_MODE.PILOT,
      parentTaskId: "5b0c1a52-5d2f-4f5e-9b8e-0c3d6f1e2a47",
      mergePolicy: MERGE_POLICY.HOLD,
    },
    shown: undefined,
  },
  {
    task: { mode: TASK_MODE.AGENT, mergePolicy: MERGE_POLICY.MERGE_ON_GREEN },
    shown: undefined,
  },
])("a $task.mode task's head switches $shown", ({ task, shown }) => {
  expect(mergePolicySwitchOf(task)).toBe(shown);
});
