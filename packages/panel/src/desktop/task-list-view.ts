import { useAtom } from "@effect/atom-react";
import { type TaskStatus, taskStatusSchema } from "@luke/features/task-wire";
import {
  DEFAULT_TASK_LIST_VIEW,
  TASK_GROUPING,
  TASK_ORDER,
  type TaskGrouping,
  type TaskListView,
  type TaskOrder,
} from "@luke/ui/task-list-model";
import { Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useState } from "react";
import { readKept, writeKept } from "./folded-groups.js";
import type { ArchivedView } from "./sidebar-task-view.js";

/**
 * task-list-view.ts -- how each workspace's task list is grouped, ordered, and filtered in the sidebar, kept per workspace on this Mac.
 *
 * The view is the developer's reading of a workspace's list, kept in the
 * renderer's own storage as the folds are, so a list grouped by creator on
 * one Mac stays grouped by repository on another, and one workspace's view
 * never changes another's. A workspace with no view kept draws today's,
 * by repository and last update, everyone's tasks to do and under way. A fixture run draws that view and keeps
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
      statuses: Schema.optionalKey(Schema.Array(taskStatusSchema)),
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
  /** Lists the tasks of these statuses, in `TASK_STATUS_ORDER`. */
  readonly onStatuses: (statuses: readonly TaskStatus[]) => void;
}

/**
 * The views as this window has chosen them since it opened, none until its
 * first choice, the kept ones standing until then; and a fixture run's. One
 * for the window, so the sidebar and a person's page, which lists their
 * tasks there, read and change the same view.
 */
const chosenViewsAtom = Atom.keepAlive(Atom.make<Views | undefined>(undefined));
const stagedViewsAtom = Atom.keepAlive(Atom.make<Views>({}));

/** The view of the workspace listed, kept as each choice is made, unless the run is `staged`. */
export function useTaskListView(
  workspaceId: string | undefined,
  staged: boolean,
): TaskListViewControl {
  const [stored] = useState<Views>(() => readKept(STORAGE_KEY, storedViews, {}));
  const [chosen, setKept] = useAtom(chosenViewsAtom);
  const [stagedViews, setStagedViews] = useAtom(stagedViewsAtom);
  const kept = chosen ?? stored;
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
    // Note that everyone's tasks is the view with no creator named at all, its statuses kept.
    onCreatedBy: (createdBy) =>
      choose(
        createdBy === undefined
          ? {
              grouping: view.grouping,
              order: view.order,
              ...(view.statuses === undefined ? undefined : { statuses: view.statuses }),
            }
          : { ...view, createdBy },
      ),
    onStatuses: (statuses) => choose({ ...view, statuses }),
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
 * The workspace the window turned the list to the archived tasks of since it
 * opened, none until it first turned or turned back, the held one standing
 * until then. One for the window, so a person's page that lists their tasks
 * in the sidebar turns it back to the tasks it lists.
 */
const archivedInAtom = Atom.keepAlive(
  Atom.make<{ readonly held: string | undefined } | undefined>(undefined),
);

/**
 * Whether the listed workspace's list stands turned to its archived tasks,
 * and the press that turns it. It is held in the window's session storage,
 * so Settings or a version history, which the sidebar steps aside for, find
 * it as they left it, while another workspace or the next launch opens on
 * the tasks. A fixture run holds nothing.
 */
export function useArchivedView(workspaceId: string | undefined, staged: boolean): ArchivedView {
  const [stored] = useState(() => (staged ? undefined : readArchivedIn()));
  const [chosen, setChosen] = useAtom(archivedInAtom);
  const held = chosen === undefined ? stored : chosen.held;
  const hold = (next: string | undefined) => {
    if (!staged) writeArchivedIn(next);
    setChosen({ held: next });
  };
  // Note that the view is let go of as the workspace changes, rather than
  // only hidden, so coming back to the workspace opens on its tasks.
  if (held !== undefined && held !== workspaceId) hold(undefined);
  return {
    shown: held !== undefined && held === workspaceId,
    onShown: (shown) => hold(shown ? workspaceId : undefined),
  };
}
