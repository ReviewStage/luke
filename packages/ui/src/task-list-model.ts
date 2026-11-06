import type { TasklessAgent } from "@repo/features/agent-wire";
import { agentName } from "@repo/features/model-label";
import {
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";

export const TASK_GROUPING = {
  REPOSITORY: "repository",
  NONE: "none",
} as const;

export type TaskGrouping = (typeof TASK_GROUPING)[keyof typeof TASK_GROUPING];

export const TASK_ORDER = {
  UPDATED: "updated",
  CREATED: "created",
  NAME: "name",
} as const;

export type TaskOrder = (typeof TASK_ORDER)[keyof typeof TASK_ORDER];

export const ASSIGNED_TO = {
  ME: "me",
  ANYONE: "anyone",
  MEMBER: "member",
} as const;

export type AssignedTo =
  | { readonly kind: typeof ASSIGNED_TO.ME }
  | { readonly kind: typeof ASSIGNED_TO.ANYONE }
  | { readonly kind: typeof ASSIGNED_TO.MEMBER; readonly userId: string };

export interface TaskListView {
  readonly grouping: TaskGrouping;
  readonly assignedTo: AssignedTo;
}

export const SHOWN_STATUSES: readonly TaskStatus[] = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS];

export const DEFAULT_TASK_LIST_VIEW: TaskListView = {
  grouping: TASK_GROUPING.REPOSITORY,
  assignedTo: { kind: ASSIGNED_TO.ME },
};

export const TASK_ROW = {
  TASK: "task",
  AGENT: "agent",
} as const;

export type TaskRow =
  | { readonly kind: typeof TASK_ROW.TASK; readonly task: TaskSummary }
  | { readonly kind: typeof TASK_ROW.AGENT; readonly agent: TasklessAgent };

export interface RepositoryGroup {
  readonly repository: string | null;
  readonly rows: readonly TaskRow[];
}

export function taskRowKey(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.task.id : row.agent.id;
}

export function taskRow(task: TaskSummary): TaskRow {
  return { kind: TASK_ROW.TASK, task };
}

export function agentRow(agent: TasklessAgent): TaskRow {
  return { kind: TASK_ROW.AGENT, agent };
}

export function taskRowName(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.task.name : agentName(row.agent);
}

export function taskRowRepository(row: TaskRow): string | null {
  return row.kind === TASK_ROW.TASK ? row.task.repository : row.agent.repository;
}

function creatorIdOf(task: TaskSummary): string | undefined {
  return task.createdBy?.userId ?? task.ownerId;
}

function taskRowCreatorId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? creatorIdOf(row.task) : row.agent.startedBy?.userId;
}

export function taskTime(task: TaskSummary, order: TaskOrder): number {
  if (order === TASK_ORDER.CREATED) return task.createdAt;
  return Math.max(task.updatedAt, task.agents?.activityAt ?? 0);
}

export function taskRowTime(row: TaskRow): number {
  return row.kind === TASK_ROW.TASK ? taskTime(row.task, TASK_ORDER.UPDATED) : row.agent.activityAt;
}

export function orderTaskRows(rows: readonly TaskRow[]): TaskRow[] {
  return rows.toSorted((a, b) => taskRowTime(b) - taskRowTime(a));
}

function grouped<K>(rows: readonly TaskRow[], keyOf: (row: TaskRow) => K): Map<K, TaskRow[]> {
  const groups = new Map<K, TaskRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

function latest(rows: readonly TaskRow[]): number {
  return Math.max(...rows.map(taskRowTime));
}

export const NO_REPOSITORY = "No repository";

export interface RepositoryParts {
  readonly owner: string | undefined;
  readonly name: string;
}

export function repositoryParts(repository: string): RepositoryParts {
  const slash = repository.indexOf("/");
  if (slash <= 0) return { owner: undefined, name: repository };
  return { owner: repository.slice(0, slash), name: repository.slice(slash + 1) };
}

function nameOf(repository: string): string {
  return repositoryParts(repository).name;
}

export function repositoryGroups(rows: readonly TaskRow[]): readonly RepositoryGroup[] {
  const groups = [...grouped(orderTaskRows(rows), taskRowRepository)].map(
    ([repository, members]) => ({ repository, rows: members }),
  );
  return groups.sort((a, b) => {
    if (a.repository === null || b.repository === null) {
      return Number(a.repository === null) - Number(b.repository === null);
    }
    return latest(b.rows) - latest(a.rows);
  });
}

export function repositoryLabel(
  repository: string,
  groups: readonly Pick<RepositoryGroup, "repository">[],
): string {
  const name = nameOf(repository);
  const shared = groups.some(
    (group) =>
      group.repository !== null &&
      group.repository !== repository &&
      nameOf(group.repository) === name,
  );
  return shared ? repository : name;
}

export function createdByOnly(
  tasks: readonly TaskSummary[],
  createdBy: string | undefined,
): readonly TaskSummary[] {
  return createdBy === undefined ? tasks : tasks.filter((task) => creatorIdOf(task) === createdBy);
}

function taskRowAssigneeId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.assignee?.userId : row.agent.startedBy?.userId;
}

export function taskRowsAssignedTo(
  rows: readonly TaskRow[],
  assignedTo: AssignedTo,
  readerId: string | undefined,
): readonly TaskRow[] {
  switch (assignedTo.kind) {
    case ASSIGNED_TO.ANYONE:
      return rows;
    case ASSIGNED_TO.MEMBER:
      return rows.filter((row) => taskRowAssigneeId(row) === assignedTo.userId);
    case ASSIGNED_TO.ME:
      if (readerId === undefined) return rows;
      return rows.filter((row) => {
        const assignee = taskRowAssigneeId(row);
        return assignee === undefined ? taskRowCreatorId(row) === readerId : assignee === readerId;
      });
  }
}

function taskRowStatus(row: TaskRow): TaskStatus | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.status : undefined;
}

export function taskRowInStatuses(
  row: TaskRow,
  statuses: readonly TaskStatus[],
  openParents: ReadonlySet<string>,
): boolean {
  const status = taskRowStatus(row);
  return (
    status === undefined ||
    statuses.includes(status) ||
    (row.kind === TASK_ROW.TASK && openParents.has(row.task.id))
  );
}

export function taskRowsInStatuses(
  rows: readonly TaskRow[],
  statuses: readonly TaskStatus[],
  openParents: ReadonlySet<string>,
): readonly TaskRow[] {
  return rows.filter((row) => taskRowInStatuses(row, statuses, openParents));
}

export interface HiddenStatus {
  readonly status: TaskStatus;
  readonly count: number;
}

export function hiddenStatuses(
  rows: readonly TaskRow[],
  statuses: readonly TaskStatus[],
  openParents: ReadonlySet<string>,
): readonly HiddenStatus[] {
  const hidden = rows.filter((row) => !taskRowInStatuses(row, statuses, openParents));
  return TASK_STATUS_ORDER.flatMap((status) => {
    if (statuses.includes(status)) return [];
    const count = hidden.filter((row) => taskRowStatus(row) === status).length;
    return count === 0 ? [] : [{ status, count }];
  });
}

export interface DrawnTaskRow {
  readonly row: TaskRow;
  readonly depth: number;
  readonly open: boolean | undefined;
}

interface TaskRowNode {
  readonly row: TaskRow;
  readonly children: readonly TaskRowNode[];
}

function parentIn(row: TaskRow, held: ReadonlySet<string>): string | undefined {
  if (row.kind !== TASK_ROW.TASK || row.task.pinnedAt !== undefined) return undefined;
  const { id, parentTaskId } = row.task;
  return parentTaskId !== undefined && parentTaskId !== id && held.has(parentTaskId)
    ? parentTaskId
    : undefined;
}

function taskRowTree(rows: readonly TaskRow[]): TaskRowNode[] {
  const held = new Set(rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : [])));
  const childrenOf = new Map<string, TaskRow[]>();
  const tops: TaskRow[] = [];
  for (const row of rows) {
    const parent = parentIn(row, held);
    if (parent === undefined) tops.push(row);
    else childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), row]);
  }
  const reached = new Set<string>();
  const node = (row: TaskRow): TaskRowNode => {
    reached.add(taskRowKey(row));
    const children = row.kind === TASK_ROW.TASK ? (childrenOf.get(row.task.id) ?? []) : [];
    return {
      row,
      children: children.filter((child) => !reached.has(taskRowKey(child))).map(node),
    };
  };
  const tree = tops.map(node);
  for (const row of rows) if (!reached.has(taskRowKey(row))) tree.push(node(row));
  return tree;
}

function holdsStanding(node: TaskRowNode, standing: (row: TaskRow) => boolean): boolean {
  return standing(node.row) || node.children.some((child) => holdsStanding(child, standing));
}

export function drawnTaskRows(
  rows: readonly TaskRow[],
  opened: (taskId: string) => boolean,
  standing: (row: TaskRow) => boolean,
): DrawnTaskRow[] {
  const drawn: DrawnTaskRow[] = [];
  const draw = (node: TaskRowNode, depth: number) => {
    const { row, children } = node;
    const open =
      children.length === 0 || row.kind !== TASK_ROW.TASK ? undefined : opened(row.task.id);
    drawn.push({ row, depth, open });
    const under =
      open === false ? children.filter((child) => holdsStanding(child, standing)) : children;
    for (const child of under) draw(child, depth + 1);
  };
  for (const node of taskRowTree(rows)) draw(node, 0);
  return drawn;
}

export function homedTaskRows(lists: readonly (readonly TaskRow[])[]): TaskRow[][] {
  const listOf = new Map<string, number>();
  const byId = new Map<string, TaskSummary>();
  lists.forEach((rows, list) => {
    for (const row of rows) {
      if (row.kind !== TASK_ROW.TASK || listOf.has(row.task.id)) continue;
      listOf.set(row.task.id, list);
      byId.set(row.task.id, row.task);
    }
  });
  const homeOf = (row: TaskRow, list: number): number | undefined => {
    if (row.kind !== TASK_ROW.TASK) return list;
    const walked = new Set([row.task.id]);
    let at = row.task;
    while (at.pinnedAt === undefined && at.parentTaskId !== undefined) {
      const parent = byId.get(at.parentTaskId);
      if (parent === undefined) return undefined;
      if (walked.has(parent.id)) break;
      walked.add(parent.id);
      at = parent;
    }
    return listOf.get(at.id);
  };
  const homed = lists.map((rows, list) => rows.map((row) => ({ row, home: homeOf(row, list) })));
  return lists.map((_, list) => [
    ...(homed[list] ?? []).flatMap(({ row, home }) => (home === list ? [row] : [])),
    ...homed.flatMap((rows, from) =>
      from === list ? [] : rows.flatMap(({ row, home }) => (home === list ? [row] : [])),
    ),
  ]);
}

export interface ChildTaskCount {
  readonly finished: number;
  readonly total: number;
}

export function taskFinished(task: TaskSummary): boolean {
  return task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.CANCELED;
}

export function subTasksOf(
  tasks: readonly TaskSummary[],
  parentId: string,
): readonly TaskSummary[] {
  return tasks
    .filter((task) => task.parentTaskId === parentId && task.id !== parentId)
    .toSorted((one, other) => one.createdAt - other.createdAt);
}

export function subTaskCount(subTasks: readonly TaskSummary[]): ChildTaskCount {
  return { finished: subTasks.filter(taskFinished).length, total: subTasks.length };
}

export function childTaskCounts(
  tasks: readonly TaskSummary[],
): ReadonlyMap<string, ChildTaskCount> {
  const counts = new Map<string, ChildTaskCount>();
  for (const task of tasks) {
    const { id, parentTaskId } = task;
    if (parentTaskId === undefined || parentTaskId === id) continue;
    const was = counts.get(parentTaskId) ?? { finished: 0, total: 0 };
    counts.set(parentTaskId, {
      finished: was.finished + (taskFinished(task) ? 1 : 0),
      total: was.total + 1,
    });
  }
  return counts;
}

export function openParentIds(
  tasks: readonly TaskSummary[],
  statuses: readonly TaskStatus[],
): ReadonlySet<string> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const open = new Set<string>();
  for (const task of tasks) {
    if (task.status !== undefined && !statuses.includes(task.status)) continue;
    let parentId = task.parentTaskId;
    while (parentId !== undefined && parentId !== task.id && !open.has(parentId)) {
      open.add(parentId);
      parentId = byId.get(parentId)?.parentTaskId;
    }
  }
  return open;
}
