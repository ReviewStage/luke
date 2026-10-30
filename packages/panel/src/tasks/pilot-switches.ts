/**
 * pilot-switches.ts -- whether a task's head shows a pilot tree's controls, the Auto-merge switch and Start or Stop, and what each reads.
 *
 * A pilot tree carries one merge policy (`MERGE_POLICY`) and one running
 * switch, both set on its top task, which its child tasks follow: so their
 * controls stand on a pilot task with no parent alone, and on no child task
 * and no task worked by its agents. A task from a service before merge
 * policies merges on green, as every task starts, and one from a service
 * before the running switch reads as stopped, as every pilot task starts.
 */

import {
  MERGE_POLICY,
  type MergePolicy,
  TASK_MODE,
  type TaskSummary,
} from "@luke/features/task-wire";

/** Whether a task stands at the top of a pilot tree, where its switches are set. */
function topPilotTask(task: Pick<TaskSummary, "mode" | "parentTaskId">): boolean {
  return task.mode === TASK_MODE.PILOT && task.parentTaskId === undefined;
}

/** The policy a task's head switches, where it shows the switch: a pilot task at the top of its tree; none for any other. */
export function mergePolicySwitchOf(
  task: Pick<TaskSummary, "mode" | "parentTaskId" | "mergePolicy">,
): MergePolicy | undefined {
  if (!topPilotTask(task)) return undefined;
  return task.mergePolicy ?? MERGE_POLICY.MERGE_ON_GREEN;
}

/** Whether a task's tree runs, where its head shows Start or Stop: a pilot task at the top of its tree; none for any other. */
export function runningSwitchOf(
  task: Pick<TaskSummary, "mode" | "parentTaskId" | "running">,
): boolean | undefined {
  if (!topPilotTask(task)) return undefined;
  return task.running ?? false;
}
