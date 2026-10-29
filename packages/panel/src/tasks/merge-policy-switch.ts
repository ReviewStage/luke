/**
 * merge-policy-switch.ts -- whether a task's head shows the merge-policy switch.
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

/** The policy a task's head switches, where it shows the switch: a pilot task at the top of its tree; none for any other. */
export function mergePolicySwitchOf(
  task: Pick<TaskSummary, "mode" | "parentTaskId" | "mergePolicy">,
): MergePolicy | undefined {
  if (task.mode !== TASK_MODE.PILOT || task.parentTaskId !== undefined) return undefined;
  return task.mergePolicy ?? MERGE_POLICY.MERGE_ON_GREEN;
}
