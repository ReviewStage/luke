import type { TasklessAgent } from "@luke/features/agent-wire";
import { agentName } from "@luke/features/model-label";
import {
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";

/**
 * task-list-model.ts -- how the sidebar's task list is grouped, ordered, and filtered: the view a workspace keeps, the groups it draws, and the time each row shows.
 *
 * The list is one section of the sidebar, its tasks drawn under the groups
 * the view chooses: by repository, by who they are assigned to, by who
 * created them, or in one run.
 * Home's Recent and ⌘K order tasks by the same last activity (`taskTime`). The
 * order chosen orders the rows within a group and the groups themselves,
 * and is the time each row shows, so the order and the label never
 * disagree.
 *
 * A row of the sidebar's list is a task, or an agent an automation started
 * with no task, which stands among the tasks by the same rules rather than
 * in a group of its own: under its repository, under whoever started it, as
 * its creator and as its assignee alike, and
 * in the order chosen, a task's row timed as the task is (`taskTime`).
 *
 * The list holds the tasks of the statuses the view shows, to do and in
 * progress until the reader chooses otherwise, so a filed backlog and the
 * settled tasks stay out of the way of the work under way; an agent with no
 * task, and a task from a service before statuses, has no status to leave
 * it out by and always stands. The Tasks page lays the same tasks out its
 * own way (`tasks-page-model.ts`).
 */

/** How the list groups its tasks. */
export const TASK_GROUPING = {
  REPOSITORY: "repository",
  ASSIGNEE: "assignee",
  CREATOR: "creator",
  NONE: "none",
} as const;

export type TaskGrouping = (typeof TASK_GROUPING)[keyof typeof TASK_GROUPING];

/**
 * The grouping a list is drawn by: the one its view keeps, but a grouping
 * by person, assignee or creator, kept for a workspace nobody shares now,
 * which has no people to group by, is drawn by repository.
 */
export function drawnGrouping(grouping: TaskGrouping, shared: boolean): TaskGrouping {
  const byPerson = grouping === TASK_GROUPING.ASSIGNEE || grouping === TASK_GROUPING.CREATOR;
  return byPerson && !shared ? TASK_GROUPING.REPOSITORY : grouping;
}

/** How the list orders its tasks, and its groups by them. */
export const TASK_ORDER = {
  UPDATED: "updated",
  CREATED: "created",
  NAME: "name",
} as const;

export type TaskOrder = (typeof TASK_ORDER)[keyof typeof TASK_ORDER];

/** How a workspace's list is drawn: today's, by repository and last update, everyone's, until it is changed. */
export interface TaskListView {
  readonly grouping: TaskGrouping;
  readonly order: TaskOrder;
  /** Whose tasks the list holds: one member's by account id, or everyone's where absent. */
  readonly createdBy?: string;
  /** Who the tasks the list holds are assigned to: one member by account id, or anyone, no one included, where absent. */
  readonly assignedTo?: string;
  /** The statuses whose tasks the list holds, in `TASK_STATUS_ORDER`; `DEFAULT_SHOWN_STATUSES` where absent. */
  readonly statuses?: readonly TaskStatus[];
}

/** The statuses a list shows until its reader chooses: the work to do and under way, the backlog and the settled left out. */
const DEFAULT_SHOWN_STATUSES: readonly TaskStatus[] = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS];

export const DEFAULT_TASK_LIST_VIEW: TaskListView = {
  grouping: TASK_GROUPING.REPOSITORY,
  order: TASK_ORDER.UPDATED,
};

/** What a row of the list stands for: a task, or an agent with no task. */
export const TASK_ROW = {
  TASK: "task",
  AGENT: "agent",
} as const;

/** One row of the list: a task, or an agent an automation started with no task. */
export type TaskRow =
  | { readonly kind: typeof TASK_ROW.TASK; readonly task: TaskSummary }
  | { readonly kind: typeof TASK_ROW.AGENT; readonly agent: TasklessAgent };

/** The rows of one repository, as the sidebar groups them under its header; null is the rows with none. */
export interface RepositoryGroup {
  readonly repository: string | null;
  readonly rows: readonly TaskRow[];
}

/** One creator's rows, by their account id; undefined is the rows nobody is named for. */
export interface CreatorGroup {
  readonly creatorId: string | undefined;
  readonly rows: readonly TaskRow[];
}

/** One assignee's rows, by their account id; undefined is the rows no one is assigned to. */
export interface AssigneeGroup {
  readonly assigneeId: string | undefined;
  readonly rows: readonly TaskRow[];
}

/** The key a row is followed by, out of one list and into another: its task's id, or its agent's. */
export function taskRowKey(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.task.id : row.agent.id;
}

/** A task as a row of the list. */
export function taskRow(task: TaskSummary): TaskRow {
  return { kind: TASK_ROW.TASK, task };
}

/** An agent with no task as a row of the list. */
export function agentRow(agent: TasklessAgent): TaskRow {
  return { kind: TASK_ROW.AGENT, agent };
}

/** The row's name: its task's, or its agent's as its tab names it (`agentName`). */
export function taskRowName(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.task.name : agentName(row.agent);
}

/** The repository the row works in; null for a task with none chosen yet. */
export function taskRowRepository(row: TaskRow): string | null {
  return row.kind === TASK_ROW.TASK ? row.task.repository : row.agent.repository;
}

/** Who created a plan, by account id: the creator the wire names, else its owner. */
function creatorIdOf(task: TaskSummary): string | undefined {
  return task.createdBy?.userId ?? task.ownerId;
}

/** Who created the row, by account id: a task's creator, or whoever started the agent, whose automation it ran on. */
function taskRowCreatorId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? creatorIdOf(row.task) : row.agent.startedBy?.userId;
}

/**
 * The time a row shows and is ordered by: when it was started under
 * Created, else when it last saw activity, the later of its plan's last save
 * and its agents' last settled activity (`agents.activityAt`: one started,
 * or a turn ended), so a task an agent worked through stands with the tasks
 * worked on lately, as "last activity" does in Linear and Cursor. Neither
 * moves when an agent's turn starts or while it runs, so a row holds its
 * place, and its time, while the agent works.
 */
export function taskTime(task: TaskSummary, order: TaskOrder): number {
  if (order === TASK_ORDER.CREATED) return task.createdAt;
  return Math.max(task.updatedAt, task.agents?.activityAt ?? 0);
}

/** The time a row shows and is ordered by: its task's (`taskTime`), or its agent's start under Created and its last activity otherwise. */
export function taskRowTime(row: TaskRow, order: TaskOrder): number {
  if (row.kind === TASK_ROW.TASK) return taskTime(row.task, order);
  return order === TASK_ORDER.CREATED ? row.agent.createdAt : row.agent.activityAt;
}

/** Two rows in the order chosen; a tie in name falls to the later activity. */
function byOrder(order: TaskOrder): (a: TaskRow, b: TaskRow) => number {
  if (order === TASK_ORDER.NAME) {
    return (a, b) =>
      taskRowName(a).localeCompare(taskRowName(b)) ||
      taskRowTime(b, TASK_ORDER.UPDATED) - taskRowTime(a, TASK_ORDER.UPDATED);
  }
  return (a, b) => taskRowTime(b, order) - taskRowTime(a, order);
}

/** The rows in the order chosen. */
export function orderTaskRows(rows: readonly TaskRow[], order: TaskOrder): TaskRow[] {
  return rows.toSorted(byOrder(order));
}

/** The rows split by a key, each run kept in the order it was handed. */
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

/** The latest time among a group's rows, under the order chosen. */
function latest(rows: readonly TaskRow[], order: TaskOrder): number {
  return Math.max(...rows.map((row) => taskRowTime(row, order)));
}

/** A repository's name without its owner: `relay` of `acme/relay`. */
function nameOf(repository: string): string {
  return repository.slice(repository.indexOf("/") + 1);
}

/**
 * The rows grouped by their repository, in the order chosen: under Last
 * updated or Created the group holding the latest row first, under Name
 * the repositories by name. The rows with none stand last whatever their
 * age or name.
 */
export function repositoryGroups(
  rows: readonly TaskRow[],
  order: TaskOrder = TASK_ORDER.UPDATED,
): readonly RepositoryGroup[] {
  const groups = [...grouped(orderTaskRows(rows, order), taskRowRepository)].map(
    ([repository, members]) => ({ repository, rows: members }),
  );
  return groups.sort((a, b) => {
    if (a.repository === null || b.repository === null) {
      return Number(a.repository === null) - Number(b.repository === null);
    }
    return order === TASK_ORDER.NAME
      ? nameOf(a.repository).localeCompare(nameOf(b.repository))
      : latest(b.rows, order) - latest(a.rows, order);
  });
}

/**
 * What a group's header says for its repository: the repository's name
 * alone, its owner left to the hover, unless another group's repository
 * shares the name, where both say `owner/name` so neither is mistaken.
 */
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

/** The plans one member created, or every plan where the view names nobody. */
export function createdByOnly(
  tasks: readonly TaskSummary[],
  createdBy: string | undefined,
): readonly TaskSummary[] {
  return createdBy === undefined ? tasks : tasks.filter((task) => creatorIdOf(task) === createdBy);
}

/** The rows one member created, or every row where the view names nobody. */
export function taskRowsCreatedBy(
  rows: readonly TaskRow[],
  createdBy: string | undefined,
): readonly TaskRow[] {
  return createdBy === undefined ? rows : rows.filter((row) => taskRowCreatorId(row) === createdBy);
}

/**
 * Who the row is assigned to, by account id: a task's assignee, none for a
 * task no one is on, or whoever started an agent with no task, which is
 * theirs as it is theirs by Created by.
 */
function taskRowAssigneeId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.assignee?.userId : row.agent.startedBy?.userId;
}

/** The rows assigned to one member, or every row where the view names nobody. */
export function taskRowsAssignedTo(
  rows: readonly TaskRow[],
  assignedTo: string | undefined,
): readonly TaskRow[] {
  return assignedTo === undefined
    ? rows
    : rows.filter((row) => taskRowAssigneeId(row) === assignedTo);
}

/** The statuses a view shows, in `TASK_STATUS_ORDER`. */
export function shownStatuses(view: TaskListView): readonly TaskStatus[] {
  return view.statuses ?? DEFAULT_SHOWN_STATUSES;
}

/** Whether the view shows other statuses than a list shows until its reader chooses, which is a status filter on. */
export function statusesFiltered(view: TaskListView): boolean {
  const shown = shownStatuses(view);
  return (
    shown.length !== DEFAULT_SHOWN_STATUSES.length ||
    !DEFAULT_SHOWN_STATUSES.every((status) => shown.includes(status))
  );
}

/** The statuses shown with one turned on or off, kept in `TASK_STATUS_ORDER`. */
export function toggledStatus(
  statuses: readonly TaskStatus[],
  status: TaskStatus,
): readonly TaskStatus[] {
  const on = !statuses.includes(status);
  return TASK_STATUS_ORDER.filter((each) => (each === status ? on : statuses.includes(each)));
}

/** The status a row is left out by: its task's, or none for an agent with no task or a task from a service before statuses. */
function taskRowStatus(row: TaskRow): TaskStatus | undefined {
  return row.kind === TASK_ROW.TASK ? row.task.status : undefined;
}

/** The rows of the statuses shown, and every row with no status to leave it out by. */
export function taskRowsInStatuses(
  rows: readonly TaskRow[],
  statuses: readonly TaskStatus[],
): readonly TaskRow[] {
  return rows.filter((row) => {
    const status = taskRowStatus(row);
    return status === undefined || statuses.includes(status);
  });
}

/** How many of the rows each status the view leaves out holds, in `TASK_STATUS_ORDER`, a status holding none left unsaid. */
export interface HiddenStatus {
  readonly status: TaskStatus;
  readonly count: number;
}

/** The rows the statuses shown leave out, counted by status; none where every row stands. */
export function hiddenStatuses(
  rows: readonly TaskRow[],
  statuses: readonly TaskStatus[],
): readonly HiddenStatus[] {
  return TASK_STATUS_ORDER.flatMap((status) => {
    if (statuses.includes(status)) return [];
    const count = rows.filter((row) => taskRowStatus(row) === status).length;
    return count === 0 ? [] : [{ status, count }];
  });
}

/**
 * The rows grouped by who created them, in the order chosen: the reader's
 * own first, then each teammate's, under Last updated or Created the one
 * holding the latest row first, under Name by the creator's name as
 * `nameOf` says it, the name the group's header says, and the rows nobody
 * is named for last.
 */
export function creatorGroups(
  rows: readonly TaskRow[],
  order: TaskOrder,
  readerId: string | undefined,
  nameOf: (row: TaskRow) => string,
): readonly CreatorGroup[] {
  const groups = [...grouped(orderTaskRows(rows, order), taskRowCreatorId)].map(
    ([creatorId, members]) => ({
      creatorId,
      rows: members,
    }),
  );
  const rank = (group: CreatorGroup) =>
    group.creatorId === undefined ? 2 : group.creatorId === readerId ? 0 : 1;
  const nameIn = (group: CreatorGroup) => {
    const first = group.rows[0];
    return first === undefined ? "" : nameOf(first);
  };
  return groups.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (order === TASK_ORDER.NAME
        ? nameIn(a).localeCompare(nameIn(b))
        : latest(b.rows, order) - latest(a.rows, order)),
  );
}

/**
 * The rows grouped by who they are assigned to (`taskRowAssigneeId`): the
 * reader's own first, then each teammate's by their name as `nameOf` says
 * it, the name the group's header says, and the rows no one is assigned to
 * last. The rows within each group stand in the order chosen.
 */
export function assigneeGroups(
  rows: readonly TaskRow[],
  order: TaskOrder,
  readerId: string | undefined,
  nameOf: (row: TaskRow) => string,
): readonly AssigneeGroup[] {
  const groups = [...grouped(orderTaskRows(rows, order), taskRowAssigneeId)].map(
    ([assigneeId, members]) => ({ assigneeId, rows: members }),
  );
  const rank = (group: AssigneeGroup) =>
    group.assigneeId === undefined ? 2 : group.assigneeId === readerId ? 0 : 1;
  const nameIn = (group: AssigneeGroup) => {
    const first = group.rows[0];
    return first === undefined ? "" : nameOf(first);
  };
  return groups.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      nameIn(a).localeCompare(nameIn(b)) ||
      latest(b.rows, order) - latest(a.rows, order),
  );
}

/** One row as a list nesting child tasks draws it: how deep it stands, and whether the child tasks under it stand open. */
export interface DrawnTaskRow {
  readonly row: TaskRow;
  /** How deep it stands: 0 at the top, one more for each parent above it. */
  readonly depth: number;
  /** Whether its child tasks stand open under it; undefined where the list holds none of them. */
  readonly open: boolean | undefined;
}

/** One row and the rows standing under it, each a tree of its own. */
interface TaskRowNode {
  readonly row: TaskRow;
  readonly children: readonly TaskRowNode[];
}

/** The parent a row stands under where `rows` holds it: a task's parent task; none for an agent, a task at the top, or one naming itself. */
function parentIn(row: TaskRow, held: ReadonlySet<string>): string | undefined {
  if (row.kind !== TASK_ROW.TASK) return undefined;
  const { id, parentTaskId } = row.task;
  return parentTaskId !== undefined && parentTaskId !== id && held.has(parentTaskId)
    ? parentTaskId
    : undefined;
}

/**
 * The rows as a tree, each in the order `rows` hands it. Note that a loop
 * of parents, which nothing writes, is reached from no row at the top, so
 * its first row is stood at the top, the loop cut where it closes, rather
 * than the loop leaving the list.
 */
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

/** Whether a row or any row under it is one `standing` keeps drawn. */
function holdsStanding(node: TaskRowNode, standing: (row: TaskRow) => boolean): boolean {
  return standing(node.row) || node.children.some((child) => holdsStanding(child, standing));
}

/**
 * The rows as a list nesting child tasks draws them, in order: each row,
 * then the child tasks under it while `opened` says it stands open, to any
 * depth, each in the order `rows` hands it. A task stands under its parent
 * only where `rows` holds that parent: a child whose parent the list leaves
 * out, one the reader cannot see, the view filters out, a pin holds, or
 * another group or section holds, stands at the top, so it is never out of
 * reach, and no row stands twice. A row folded shut still draws the one
 * `standing` keeps (the open task), and the rows between it and that one,
 * so the task worked on never leaves the list, as a folded group keeps it.
 */
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

/** How many of a task's child tasks are finished, of all of them. */
export interface ChildTaskCount {
  readonly finished: number;
  readonly total: number;
}

/** Whether a task has settled: done, or canceled, which is as settled as done. */
function finished(task: TaskSummary): boolean {
  return task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.CANCELED;
}

/**
 * How many of each parent's child tasks are finished (done or canceled),
 * by the parent's id, for the parents with any. Note that only a task's
 * direct children count, never theirs, and that `tasks` is every task the
 * workspace holds rather than the rows a view draws, since the view
 * hides the finished ones by default and the count is how many of them there are.
 */
export function childTaskCounts(
  tasks: readonly TaskSummary[],
): ReadonlyMap<string, ChildTaskCount> {
  const counts = new Map<string, ChildTaskCount>();
  for (const task of tasks) {
    const { id, parentTaskId } = task;
    if (parentTaskId === undefined || parentTaskId === id) continue;
    const was = counts.get(parentTaskId) ?? { finished: 0, total: 0 };
    counts.set(parentTaskId, {
      finished: was.finished + (finished(task) ? 1 : 0),
      total: was.total + 1,
    });
  }
  return counts;
}
