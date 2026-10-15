import {
  DEFAULT_TASK_LIST_VIEW,
  TASK_GROUPING,
  TASK_ORDER,
  type TaskGrouping,
  type TaskListView,
  type TaskOrder,
} from "@luke/ui/task-list-model";
import { Schema } from "effect";
import { useState } from "react";
import { readKept, writeKept } from "./folded-groups";

/**
 * task-list-view.ts -- how each workspace's task list is grouped and ordered in the sidebar, kept per workspace on this Mac.
 *
 * The view is the developer's reading of a workspace's list, kept in the
 * renderer's own storage as the folds are, so a list grouped by creator on
 * one Mac stays grouped by repository on another, and one workspace's view
 * never changes another's. A workspace with no view kept draws today's,
 * by repository and last update. A fixture run draws that view and keeps
 * nothing, so its frames never wear a developer's choices.
 */

/** Where the views are kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidebarTaskViews";

/** Each workspace's view, by its id. */
const storedViews = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      grouping: Schema.Literals(Object.values(TASK_GROUPING)),
      order: Schema.Literals(Object.values(TASK_ORDER)),
    }),
  ),
);

type Views = Readonly<Record<string, TaskListView>>;

/** The listed workspace's view, and the presses that change it. */
export interface TaskListViewControl {
  readonly view: TaskListView;
  readonly onGrouping: (grouping: TaskGrouping) => void;
  readonly onOrder: (order: TaskOrder) => void;
}

/** The view of the workspace listed, kept as each choice is made, unless the run is `staged`. */
export function useTaskListView(
  workspaceId: string | undefined,
  staged: boolean,
): TaskListViewControl {
  const [kept, setKept] = useState<Views>(() => readKept(STORAGE_KEY, storedViews, {}));
  const [stagedViews, setStagedViews] = useState<Views>({});
  const views = staged ? stagedViews : kept;
  const view =
    (workspaceId === undefined ? undefined : views[workspaceId]) ?? DEFAULT_TASK_LIST_VIEW;
  const choose = (next: TaskListView) => {
    if (workspaceId === undefined) return;
    const all = { ...views, [workspaceId]: next };
    if (staged) {
      setStagedViews(all);
      return;
    }
    setKept(all);
    writeKept(STORAGE_KEY, storedViews, all);
  };
  return {
    view,
    onGrouping: (grouping) => choose({ ...view, grouping }),
    onOrder: (order) => choose({ ...view, order }),
  };
}
