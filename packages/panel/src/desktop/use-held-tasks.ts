import type { TaskSummary } from "@luke/features/task-wire";
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
 * moves at once: one whose name, status, priority, or assignee given here
 * this window has yet to see the view carry (`pendingTasks`), and once more
 * as it stops waiting, so a change carried holds its new place and one
 * refused goes back to where the task stands. A task new to the list, or
 * one the filter or the completed window left out, stands where it is now,
 * and one gone from it is gone.
 */

/** No task waiting on the view. */
const NO_TASKS: ReadonlySet<string> = new Set();

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
 * module's head says while the page is shown, each task drawn as it is now.
 */
export function useHeldTasks(
  tasks: TasksControl,
  view: HeldTasksView,
  group: (tasks: readonly TaskSummary[]) => readonly TasksGroup[],
): readonly TasksGroup[] {
  const listed = tasks.listed.tasks;
  const live = new Map(listed.map((task) => [task.id, task] as const));
  // The tasks waiting on the view when the page was last drawn.
  const waited = useRef<ReadonlySet<string>>(NO_TASKS);
  const moving = (task: TaskSummary) =>
    tasks.pendingTasks?.has(task.id) === true || waited.current.has(task.id);
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
      // Note that only a task drawn holds its place, so one the filter or the completed window left out comes in where it stands once it is let in.
      placesOf: (drawn, held) => {
        const shown = new Set(drawn.flatMap((each) => each.tasks.map((task) => task.id)));
        return new Map(
          placed(held).flatMap((task) => (shown.has(task.id) ? [[task.id, task] as const] : [])),
        );
      },
    },
  );
  // Note that this runs after the held order keeps its places, so a task that stopped waiting is placed anew once before it holds still.
  useLayoutEffect(() => {
    waited.current = tasks.pendingTasks ?? NO_TASKS;
  });
  return groups;
}
