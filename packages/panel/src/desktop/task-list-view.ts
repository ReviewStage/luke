import { useAtom } from "@effect/atom-react";
import {
  ASSIGNED_TO,
  type AssignedTo,
  DEFAULT_TASK_LIST_VIEW,
  TASK_GROUPING,
  type TaskGrouping,
  type TaskListView,
} from "@luke/ui/task-list-model";
import { Schema, SchemaTransformation } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { keptKey, useKept } from "../use-kept.js";

/**
 * task-list-view.ts -- how each workspace's task list is grouped, and whose tasks it holds, in the sidebar, kept per workspace on this Mac.
 *
 * The view is the developer's reading of a workspace's list, kept in the
 * renderer's own storage as the folds are, so a list grouped in one run on
 * one Mac stays grouped by repository on another, and one workspace's view
 * never changes another's. A workspace with no view kept draws today's, by
 * repository, the reader's own tasks. A fixture run draws that view and
 * keeps nothing, so its frames never wear a developer's choices.
 *
 * Note that Assigned to is kept under `assignee`, which no earlier build
 * wrote, and Me where it is absent, so every reader opens on their own
 * tasks once, whatever an earlier build kept under `assignedTo`, and a
 * later choice of Anyone is kept as one. An earlier build's order, creator,
 * and statuses read as nothing, and its grouping by person as by
 * repository.
 */

/** The groupings by person an earlier build kept, which read as by repository. */
const EARLIER_GROUPING = {
  ASSIGNEE: "assignee",
  CREATOR: "creator",
} as const;

/** A kept grouping, an earlier build's by person read as by repository. */
const storedGrouping = Schema.Literals([
  ...Object.values(TASK_GROUPING),
  ...Object.values(EARLIER_GROUPING),
]).pipe(
  Schema.decodeTo(
    Schema.Literals(Object.values(TASK_GROUPING)),
    SchemaTransformation.transform({
      decode: (kept): TaskGrouping =>
        kept === TASK_GROUPING.NONE ? TASK_GROUPING.NONE : TASK_GROUPING.REPOSITORY,
      encode: (grouping) => grouping,
    }),
  ),
);

/** A kept Assigned to. */
const storedAssignedTo = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ME) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ANYONE) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.MEMBER), userId: Schema.String }),
]);

/** Each workspace's view, by its id. */
const storedViews = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      grouping: storedGrouping,
      assignee: Schema.optionalKey(storedAssignedTo),
    }),
  ),
);

type StoredViews = typeof storedViews.Type;

/** Where the views are kept in the renderer's storage. */
const KEPT = { VIEWS: keptKey("luke.sidebarTaskViews", storedViews) } as const;

/** The listed workspace's view, and the presses that change it. */
export interface TaskListViewControl {
  readonly view: TaskListView;
  readonly onGrouping: (grouping: TaskGrouping) => void;
  /** Lists the reader's tasks, anyone's, or one teammate's. */
  readonly onAssignedTo: (assignedTo: AssignedTo) => void;
}

/** A fixture run's views, which keep nothing. One for the window, so the sidebar and a person's page, which lists their tasks there, read and change the same view. */
const stagedViewsAtom = Atom.keepAlive(Atom.make<StoredViews>({}));

/** A view as kept, Me where no Assigned to is. */
function viewOf(kept: StoredViews[string] | undefined): TaskListView {
  if (kept === undefined) return DEFAULT_TASK_LIST_VIEW;
  return {
    grouping: kept.grouping,
    assignedTo: kept.assignee ?? DEFAULT_TASK_LIST_VIEW.assignedTo,
  };
}

/** The view of the workspace listed, kept as each choice is made, unless the run is `staged`. */
export function useTaskListView(
  workspaceId: string | undefined,
  staged: boolean,
): TaskListViewControl {
  // Note that every surface holding the key draws a choice at once, so the sidebar and a person's page read and change the same view.
  const [kept, keep] = useKept<StoredViews>(KEPT.VIEWS, {});
  const [stagedViews, setStagedViews] = useAtom(stagedViewsAtom);
  const views = staged ? stagedViews : kept;
  const view = viewOf(workspaceId === undefined ? undefined : views[workspaceId]);
  const choose = (next: TaskListView) => {
    if (workspaceId === undefined) return;
    const all = {
      ...views,
      [workspaceId]: { grouping: next.grouping, assignee: next.assignedTo },
    };
    if (staged) {
      setStagedViews(all);
      return;
    }
    keep(all);
  };
  return {
    view,
    onGrouping: (grouping) => choose({ ...view, grouping }),
    onAssignedTo: (assignedTo) => choose({ ...view, assignedTo }),
  };
}
