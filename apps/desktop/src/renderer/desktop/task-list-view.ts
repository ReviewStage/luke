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
import type { ArchivedView } from "./sidebar-task-view";

/**
 * task-list-view.ts -- how each workspace's task list is grouped, ordered, and filtered in the sidebar, kept per workspace on this Mac.
 *
 * The view is the developer's reading of a workspace's list, kept in the
 * renderer's own storage as the folds are, so a list grouped by creator on
 * one Mac stays grouped by repository on another, and one workspace's view
 * never changes another's. A workspace with no view kept draws today's,
 * by repository and last update, everyone's tasks. A fixture run draws that view and keeps
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
      createdBy: Schema.optionalKey(Schema.String),
    }),
  ),
);

type Views = Readonly<Record<string, TaskListView>>;

/** The listed workspace's view, and the presses that change it. */
export interface TaskListViewControl {
  readonly view: TaskListView;
  readonly onGrouping: (grouping: TaskGrouping) => void;
  readonly onOrder: (order: TaskOrder) => void;
  /** Lists one member's tasks, by account id, or everyone's for undefined. */
  readonly onCreatedBy: (createdBy: string | undefined) => void;
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
    onCreatedBy: (createdBy) =>
      choose(
        createdBy === undefined
          ? { grouping: view.grouping, order: view.order }
          : { ...view, createdBy },
      ),
  };
}

/** Where the window keeps the workspace its list stands turned to the archived tasks of, for its own life alone. */
const ARCHIVED_KEY = "luke.sidebarArchivedIn";

/** The workspace the list stands turned to the archived tasks of, or none where nothing is held or storage refuses the read. */
function readArchivedIn(): string | undefined {
  try {
    return window.sessionStorage.getItem(ARCHIVED_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Holds the workspace, or lets go; a write that fails costs only the view on the sidebar's return. */
function writeArchivedIn(workspaceId: string | undefined): void {
  try {
    if (workspaceId === undefined) window.sessionStorage.removeItem(ARCHIVED_KEY);
    else window.sessionStorage.setItem(ARCHIVED_KEY, workspaceId);
  } catch {
    // The list opens on the tasks when the sidebar comes back.
  }
}

/**
 * Whether the listed workspace's list stands turned to its archived tasks,
 * and the press that turns it. It is held in the window's session storage,
 * so Settings or a version history, which the sidebar steps aside for, find
 * it as they left it, while another workspace or the next launch opens on
 * the tasks. A fixture run holds nothing.
 */
export function useArchivedView(workspaceId: string | undefined, staged: boolean): ArchivedView {
  const [held, setHeld] = useState(() => (staged ? undefined : readArchivedIn()));
  const hold = (next: string | undefined) => {
    if (!staged) writeArchivedIn(next);
    setHeld(next);
  };
  // Note that the view is let go of as the workspace changes, rather than
  // only hidden, so coming back to the workspace opens on its tasks.
  if (held !== undefined && held !== workspaceId) hold(undefined);
  return {
    shown: held !== undefined && held === workspaceId,
    onShown: (shown) => hold(shown ? workspaceId : undefined),
  };
}
