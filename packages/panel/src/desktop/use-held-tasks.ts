import type { TaskSummary } from "@repo/features/task-wire";
import { sameShape } from "@repo/features/turn-rows";
import {
  filterValues,
  TASKS_FILTER_FIELD,
  type TasksDisplay,
  type TasksFilter,
  type TasksGroup,
} from "@repo/ui/tasks-page-model";
import { useLayoutEffect, useRef } from "react";
import { useHeldOrder } from "../tasks/use-held-order.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";

const NO_TASKS: ReadonlySet<string> = new Set();

const LAID_OUT_DEPTH = 2;

interface HeldTasksView {
  readonly workspaceId: string | undefined;
  readonly filter: TasksFilter;
  readonly display: TasksDisplay;
}

function sameFilter(a: TasksFilter, b: TasksFilter): boolean {
  return Object.values(TASKS_FILTER_FIELD).every((field) => {
    const was = filterValues(a, field);
    const now = filterValues(b, field);
    return was.length === now.length && was.every((value, at) => value === now[at]);
  });
}

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

export function useHeldTasks(
  tasks: TasksControl,
  view: HeldTasksView,
  group: (tasks: readonly TaskSummary[]) => readonly TasksGroup[],
): readonly TasksGroup[] {
  const listed = tasks.listed.tasks;
  const live = new Map(listed.map((task) => [task.id, task] as const));
  const waited = useRef<ReadonlySet<string>>(NO_TASKS);
  const moving = (task: TaskSummary) =>
    tasks.pendingTasks?.has(task.id) === true || waited.current.has(task.id);
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
      placesOf: (drawn, held) => {
        const shown = new Set(drawn.flatMap((each) => each.tasks.map((task) => task.id)));
        return new Map(
          placed(held).flatMap((task) => (shown.has(task.id) ? [[task.id, task] as const] : [])),
        );
      },
    },
  );
  const laidOut = useRef(groups);
  const steady = sameShape(laidOut.current, groups, LAID_OUT_DEPTH) ? laidOut.current : groups;
  useLayoutEffect(() => {
    waited.current = tasks.pendingTasks ?? NO_TASKS;
    laidOut.current = steady;
  });
  return steady;
}
