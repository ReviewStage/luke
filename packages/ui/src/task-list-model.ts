import type { PlanSummary } from "@luke/features/plan-wire";

/**
 * task-list-model.ts -- how the sidebar's task list is grouped and ordered: the view a workspace keeps, the groups it draws, and the time each row shows.
 *
 * The list is one section of the sidebar, its tasks drawn under the groups
 * the view chooses: by repository, by who created them, or in one run. The
 * order chosen orders the rows within a group and the groups themselves,
 * and is the time each row shows, so the order and the label never
 * disagree.
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

/** How a workspace's list is drawn: today's, by repository and last update, until it is changed. */
export interface TaskListView {
  readonly grouping: TaskGrouping;
  readonly order: TaskOrder;
}

export const DEFAULT_TASK_LIST_VIEW: TaskListView = {
  grouping: TASK_GROUPING.REPOSITORY,
  order: TASK_ORDER.UPDATED,
};

/** The plans of one repository, as the sidebar groups them under its header; null is the plans with none. */
export interface RepositoryGroup {
  readonly repository: string | null;
  readonly plans: readonly PlanSummary[];
}

/** One creator's plans, by their account id; undefined is the plans nobody is named for. */
export interface CreatorGroup {
  readonly creatorId: string | undefined;
  readonly plans: readonly PlanSummary[];
}

/** The time a row shows and is ordered by: when it was started under Created, else when it was last updated. */
export function taskTime(plan: PlanSummary, order: TaskOrder): number {
  return order === TASK_ORDER.CREATED ? plan.createdAt : plan.updatedAt;
}

/** Two plans in the order chosen; a tie in name falls to the newer update. */
function byOrder(order: TaskOrder): (a: PlanSummary, b: PlanSummary) => number {
  if (order === TASK_ORDER.NAME) {
    return (a, b) => a.name.localeCompare(b.name) || b.updatedAt - a.updatedAt;
  }
  return (a, b) => taskTime(b, order) - taskTime(a, order);
}

/** The plans in the order chosen. */
export function orderTasks(plans: readonly PlanSummary[], order: TaskOrder): PlanSummary[] {
  return plans.toSorted(byOrder(order));
}

/** The plans split by a key, each run kept in the order it was handed. */
function grouped<K>(
  plans: readonly PlanSummary[],
  keyOf: (plan: PlanSummary) => K,
): Map<K, PlanSummary[]> {
  const groups = new Map<K, PlanSummary[]>();
  for (const plan of plans) {
    const key = keyOf(plan);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [plan]);
    else group.push(plan);
  }
  return groups;
}

/** The latest time among a group's plans, under the order chosen. */
function latest(plans: readonly PlanSummary[], order: TaskOrder): number {
  return Math.max(...plans.map((plan) => taskTime(plan, order)));
}

/** A repository's name without its owner: `relay` of `acme/relay`. */
function nameOf(repository: string): string {
  return repository.slice(repository.indexOf("/") + 1);
}

/**
 * The plans grouped by their repository, in the order chosen: under Last
 * updated or Created the group holding the latest plan first, under Name
 * the repositories by name. The plans with none stand last whatever their
 * age or name.
 */
export function repositoryGroups(
  plans: readonly PlanSummary[],
  order: TaskOrder = TASK_ORDER.UPDATED,
): readonly RepositoryGroup[] {
  const groups = [...grouped(orderTasks(plans, order), (plan) => plan.repository)].map(
    ([repository, members]) => ({ repository, plans: members }),
  );
  return groups.sort((a, b) => {
    if (a.repository === null || b.repository === null) {
      return Number(a.repository === null) - Number(b.repository === null);
    }
    return order === TASK_ORDER.NAME
      ? nameOf(a.repository).localeCompare(nameOf(b.repository))
      : latest(b.plans, order) - latest(a.plans, order);
  });
}

/**
 * What a group's header says for its repository: the repository's name
 * alone, its owner left to the hover, unless another group's repository
 * shares the name, where both say `owner/name` so neither is mistaken.
 */
export function repositoryLabel(repository: string, groups: readonly RepositoryGroup[]): string {
  const name = nameOf(repository);
  const shared = groups.some(
    (group) =>
      group.repository !== null &&
      group.repository !== repository &&
      nameOf(group.repository) === name,
  );
  return shared ? repository : name;
}

/** Who created a plan, by account id: the creator the wire names, else its owner. */
function creatorIdOf(plan: PlanSummary): string | undefined {
  return plan.createdBy?.userId ?? plan.ownerId;
}

/**
 * The plans grouped by who created them, in the order chosen: the reader's
 * own first, then each teammate's, under Last updated or Created the one
 * holding the latest plan first, under Name by the creator's name as
 * `nameOf` says it, the name the group's header says, and the plans nobody
 * is named for last.
 */
export function creatorGroups(
  plans: readonly PlanSummary[],
  order: TaskOrder,
  readerId: string | undefined,
  nameOf: (plan: PlanSummary) => string,
): readonly CreatorGroup[] {
  const groups = [...grouped(orderTasks(plans, order), creatorIdOf)].map(
    ([creatorId, members]) => ({
      creatorId,
      plans: members,
    }),
  );
  const rank = (group: CreatorGroup) =>
    group.creatorId === undefined ? 2 : group.creatorId === readerId ? 0 : 1;
  const nameIn = (group: CreatorGroup) => {
    const first = group.plans[0];
    return first === undefined ? "" : nameOf(first);
  };
  return groups.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (order === TASK_ORDER.NAME
        ? nameIn(a).localeCompare(nameIn(b))
        : latest(b.plans, order) - latest(a.plans, order)),
  );
}
