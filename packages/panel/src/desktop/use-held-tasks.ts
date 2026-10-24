import type { TaskStanding, TaskSummary } from "@luke/features/task-wire";
import {
  filterValues,
  TASKS_FILTER_FIELD,
  type TasksDisplay,
  type TasksFilter,
  type TasksGroup,
} from "@luke/ui/tasks-page-model";
import { useLayoutEffect, useRef } from "react";
import { useHeldOrder } from "../tasks/use-held-order.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { standsAt } from "./task-row-parts.js";

/**
 * use-held-tasks.ts -- the Tasks page's List and Columns held still while
 * the page is shown (`use-held-order.ts`), so a row or a card the reader is
 * on stays where it is.
 *
 * While the page is shown under the same view (the workspace listed, the
 * filter, and the display's grouping, order, completed window, and whether
 * the pins lead), every task keeps the group and the place it was first
 * drawn in: it is grouped, ordered, and filtered as it stood then, and drawn
 * as it is now, so a teammate's change of its status, priority, assignee,
 * or name moves nothing under the reader. Hidden, or drawn under another
 * view, every task stands where it is now. A task the reader moved here
 * moves at once: one whose name or status this window has yet to see the
 * view carry (`pendingTasks`), and one this page sent a status, priority,
 * or assignee, until the view carries it or it is refused. A task new to
 * the list stands where it is now, and one gone from it is gone.
 */

/** What decides where the page stands its tasks: the workspace listed, the filter, and the display's layout of them. */
interface HeldTasksView {
  readonly workspaceId: string | undefined;
  readonly filter: TasksFilter;
  readonly display: TasksDisplay;
}

/** Whether two filters keep the same values of every field, in the same order. */
function sameFilter(a: TasksFilter, b: TasksFilter): boolean {
  return Object.values(TASKS_FILTER_FIELD).every((field) => {
    const was = filterValues(a, field);
    const now = filterValues(b, field);
    return was.length === now.length && was.every((value, at) => value === now[at]);
  });
}

/** Whether the page drawn under one view stands its tasks as it would under another. */
function sameTasksOrder(was: HeldTasksView, now: HeldTasksView): boolean {
  return (
    was.workspaceId === now.workspaceId &&
    was.display.grouping === now.display.grouping &&
    was.display.order === now.display.order &&
    was.display.completed === now.display.completed &&
    was.display.pinnedFirst === now.display.pinnedFirst &&
    sameFilter(was.filter, now.filter)
  );
}

/**
 * The groups `group` lays the listed tasks out in, held still as the
 * module's head says while the page is shown, each task drawn as it is now;
 * and the tab's control, its changes of where a task stands marked as the
 * reader's own, which the page's rows, cards, and drops send through.
 */
export function useHeldTasks(
  tasks: TasksControl,
  view: HeldTasksView,
  group: (tasks: readonly TaskSummary[]) => readonly TasksGroup[],
): { readonly groups: readonly TasksGroup[]; readonly tasks: TasksControl } {
  // The standing this page sent each task, until the view carries it or the service refuses it.
  const sent = useRef(new Map<string, TaskStanding>());
  const listed = tasks.listed.tasks;
  const live = new Map(listed.map((task) => [task.id, task] as const));
  const moving = (task: TaskSummary) =>
    tasks.pendingTasks?.has(task.id) === true || sent.current.has(task.id);
  // Each task as it was first drawn, or as it is now where it is new or the reader moved it.
  const placed = (held: ReadonlyMap<string, TaskSummary>) =>
    listed.map((task) => (moving(task) ? task : (held.get(task.id) ?? task)));
  const groups = useHeldOrder<HeldTasksView, TaskSummary, readonly TasksGroup[]>(
    view,
    tasks.shown,
    {
      sameOrder: sameTasksOrder,
      draw: (places) =>
        group(placed(places)).map((each) => ({
          ...each,
          tasks: each.tasks.map((task) => live.get(task.id) ?? task),
        })),
      placesOf: (_drawn, held) => new Map(placed(held).map((task) => [task.id, task] as const)),
    },
  );
  // Note that a standing the view now carries is let go only once its task's new place is held, so it never springs back.
  useLayoutEffect(() => {
    for (const [taskId, standing] of sent.current) {
      const task = live.get(taskId);
      if (task === undefined || standsAt(task, standing)) sent.current.delete(taskId);
    }
  });
  const onSetTaskStanding = (taskId: string, standing: TaskStanding): Promise<boolean> => {
    sent.current.set(taskId, standing);
    return tasks.onSetTaskStanding(taskId, standing).then((kept) => {
      if (!kept && sent.current.get(taskId) === standing) sent.current.delete(taskId);
      return kept;
    });
  };
  return { groups, tasks: { ...tasks, onSetTaskStanding } };
}
