import { useAtom } from "@effect/atom-react";
import {
  ASSIGNED_TO,
  type AssignedTo,
  DEFAULT_TASK_LIST_VIEW,
  TASK_GROUPING,
  type TaskGrouping,
  type TaskListView,
} from "@repo/ui/task-list-model";
import { Schema, SchemaTransformation } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { keptKey, useKept } from "../use-kept.js";

const EARLIER_GROUPING = {
  ASSIGNEE: "assignee",
  CREATOR: "creator",
} as const;

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

const storedAssignedTo = Schema.Union([
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ME) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.ANYONE) }),
  Schema.Struct({ kind: Schema.Literal(ASSIGNED_TO.MEMBER), userId: Schema.String }),
]);

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

const KEPT = { VIEWS: keptKey("app.sidebarTaskViews", storedViews) } as const;

export interface TaskListViewControl {
  readonly view: TaskListView;
  readonly onGrouping: (grouping: TaskGrouping) => void;
  readonly onAssignedTo: (assignedTo: AssignedTo) => void;
}

const stagedViewsAtom = Atom.keepAlive(Atom.make<StoredViews>({}));

function viewOf(kept: StoredViews[string] | undefined): TaskListView {
  if (kept === undefined) return DEFAULT_TASK_LIST_VIEW;
  return {
    grouping: kept.grouping,
    assignedTo: kept.assignee ?? DEFAULT_TASK_LIST_VIEW.assignedTo,
  };
}

export function useTaskListView(
  workspaceId: string | undefined,
  staged: boolean,
): TaskListViewControl {
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
