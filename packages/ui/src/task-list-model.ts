import type { TasklessAgent } from "@luke/features/coding-agent-wire";
import { agentTabLabel } from "@luke/features/model-label";
import type { TaskSummary } from "@luke/features/task-wire";

/**
 * task-list-model.ts -- how the sidebar's task list is grouped, ordered, and filtered: the view a workspace keeps, the groups it draws, and the time each row shows.
 *
 * The list is one section of the sidebar, its tasks drawn under the groups
 * the view chooses: by repository, by who created them, or in one run.
 * Home's Recent and ⌘K order tasks by the same last activity (`taskTime`). The
 * order chosen orders the rows within a group and the groups themselves,
 * and is the time each row shows, so the order and the label never
 * disagree.
 *
 * A row of the sidebar's list is a task, or an agent an automation started
 * with no task, which stands among the tasks by the same rules rather than
 * in a group of its own: under its repository, under whoever started it, and
 * in the order chosen, a task's row timed as the task is (`taskTime`).
 */

/** How the list groups its tasks. */
export const TASK_GROUPING = {
  REPOSITORY: "repository",
  CREATOR: "creator",
  NONE: "none",
} as const;

export type TaskGrouping = (typeof TASK_GROUPING)[keyof typeof TASK_GROUPING];

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
}

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
  | { readonly kind: typeof TASK_ROW.TASK; readonly plan: TaskSummary }
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

/** A task as a row of the list. */
export function taskRow(task: TaskSummary): TaskRow {
  return { kind: TASK_ROW.TASK, plan: task };
}

/** An agent with no task as a row of the list. */
export function agentRow(agent: TasklessAgent): TaskRow {
  return { kind: TASK_ROW.AGENT, agent };
}

/** The row's name: its task's, or its agent's as its tab names it (`agentTabLabel`). */
export function taskRowName(row: TaskRow): string {
  return row.kind === TASK_ROW.TASK ? row.plan.name : agentTabLabel(row.agent);
}

/** The repository the row works in; null for a task with none chosen yet. */
export function taskRowRepository(row: TaskRow): string | null {
  return row.kind === TASK_ROW.TASK ? row.plan.repository : row.agent.repository;
}

/** Who created a plan, by account id: the creator the wire names, else its owner. */
function creatorIdOf(task: TaskSummary): string | undefined {
  return task.createdBy?.userId ?? task.ownerId;
}

/** Who created the row, by account id: a task's creator, or whoever started the agent, whose automation it ran on. */
function taskRowCreatorId(row: TaskRow): string | undefined {
  return row.kind === TASK_ROW.TASK ? creatorIdOf(row.plan) : row.agent.startedBy?.userId;
}

/**
 * The time a row shows and is ordered by: when it was started under
 * Created, else when it last saw activity, the later of its plan's last save
 * and its agents' last settled activity (`agents.activityAt`: one started,
 * handed a message, or a turn ended), so a task an agent is working through
 * stands with the tasks worked on lately, as "last activity" does in Linear
 * and Cursor. Neither moves while an agent's turn streams, so a row holds its
 * place while the agent works.
 */
export function taskTime(task: TaskSummary, order: TaskOrder): number {
  if (order === TASK_ORDER.CREATED) return task.createdAt;
  return Math.max(task.updatedAt, task.agents?.activityAt ?? 0);
}

/** The time a row shows and is ordered by: its task's (`taskTime`), or its agent's start under Created and its last activity otherwise. */
export function taskRowTime(row: TaskRow, order: TaskOrder): number {
  if (row.kind === TASK_ROW.TASK) return taskTime(row.plan, order);
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

/** The plans in the order chosen, as their rows are ordered. */
export function orderTasks(tasks: readonly TaskSummary[], order: TaskOrder): TaskSummary[] {
  return orderTaskRows(tasks.map(taskRow), order).flatMap((row) =>
    row.kind === TASK_ROW.TASK ? [row.plan] : [],
  );
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
