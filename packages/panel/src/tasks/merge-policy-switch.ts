/**
 * merge-policy-switch.ts -- whether a task's head shows the merge-policy switch, and what it says.
 *
 * A pilot tree carries one merge policy (`MERGE_POLICY`), set on its top
 * task, which its child tasks follow: so the switch stands on a pilot task
 * with no parent alone, and on no child task and no task worked by its
 * agents. A task from a service before merge policies merges on green, as
 * every task starts.
 */

import {
  MERGE_POLICY,
  type MergePolicy,
  TASK_MODE,
  type TaskSummary,
} from "@luke/features/task-wire";

/** Each policy as the switch names it, and what its hint says it does. */
export const MERGE_POLICY_CHOICES = {
  [MERGE_POLICY.MERGE_ON_GREEN]: {
    label: "Merge on green",
    hint: "Pull requests merge once their checks pass",
  },
  [MERGE_POLICY.HOLD]: {
    label: "Hold every PR",
    hint: "Each pull request waits for your go once its checks pass",
  },
} as const satisfies Record<MergePolicy, { label: string; hint: string }>;

/** The policy a task's head switches, where it shows the switch: a pilot task at the top of its tree; none for any other. */
export function mergePolicySwitchOf(
  task: Pick<TaskSummary, "mode" | "parentTaskId" | "mergePolicy">,
): MergePolicy | undefined {
  if (task.mode !== TASK_MODE.PILOT || task.parentTaskId !== undefined) return undefined;
  return task.mergePolicy ?? MERGE_POLICY.MERGE_ON_GREEN;
}
