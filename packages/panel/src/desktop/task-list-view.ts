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
import { readKept, writeKept } from "../kept-storage.js";

/**
 * task-list-view.ts -- how each workspace's task list is grouped, ordered, and filtered in the sidebar, kept per workspace on this Mac.
 *
 * The view is the developer's reading of a workspace's list, kept in the
 * renderer's own storage as the folds are, so a list grouped by creator on
 * one Mac stays grouped by repository on another, and one workspace's view
 * never changes another's. A workspace with no view kept draws today's,
 * by repository and last update, everyone's tasks to do and under way,
 * assigned to anyone. A fixture run draws that view and keeps
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
      assignedTo: Schema.optionalKey(Schema.String),
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
  /** Lists the tasks assigned to one member, by account id, or to anyone for undefined. */
  readonly onAssignedTo: (assignedTo: string | undefined) => void;
  /** Lists everyone's tasks assigned to anyone, letting go of both filters by person in one choice. */
  readonly onEveryone: () => void;
  /** Lists every task one member created, whoever it is assigned to, in one choice, as their page's Show all asks. */
  readonly onCreatedByAlone: (createdBy: string) => void;
  /** Lists every task assigned to one member, whoever created it, in one choice, as ⌘K's Show my tasks asks. */
  readonly onAssignedToAlone: (assignedTo: string) => void;
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
    // Note that everyone's tasks is the view with no creator named at all, the rest of it kept.
    onCreatedBy: (createdBy) => {
      const { createdBy: _standing, ...rest } = view;
      choose(createdBy === undefined ? rest : { ...rest, createdBy });
    },
    // And anyone's is the view with no assignee named at all, the rest of it kept.
    onAssignedTo: (assignedTo) => {
      const { assignedTo: _standing, ...rest } = view;
      choose(assignedTo === undefined ? rest : { ...rest, assignedTo });
    },
    onCreatedByAlone: (createdBy) => {
      const { assignedTo: _assigned, ...rest } = view;
      choose({ ...rest, createdBy });
    },
    onAssignedToAlone: (assignedTo) => {
      const { createdBy: _created, ...rest } = view;
      choose({ ...rest, assignedTo });
    },
    onEveryone: () => {
      const { createdBy: _created, assignedTo: _assigned, ...rest } = view;
      choose(rest);
    },
    onStatuses: (statuses) => choose({ ...view, statuses }),
  };
}
