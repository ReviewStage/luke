import {
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { TASK_ORDER, taskTime } from "./task-list-model.js";

/**
 * tasks-page-model.ts -- how the Tasks page filters, groups, orders, and draws the workspace's tasks, in its List and on its Board.
 *
 * The page's view is two halves, as Linear's and Stage's boards hold theirs.
 * The filter says which tasks stand at all: each field, Status, Priority,
 * Creator, and Repository, keeps the values a task must hold one of, and a
 * field with none filters nothing; the fields are and-ed. It is one for
 * both views, since the List and the Board are two looks at the same
 * tasks. The display says how the tasks that stand are laid out: what
 * groups them (the Board's columns), how each group orders them, whether a
 * group with no task still stands, whether the settled, Done and Canceled,
 * stand beside the open work, whether the pins and the account's sections
 * lead the List, and which of a task's properties its row or card draws.
 * The List and the Board each keep a display of their own, because a board
 * wants every column in sight and the finished work in its last one, where a
 * list wants the work under way and nothing settled in the way of it.
 *
 * A task from a service before statuses stands as Todo, where a task
 * starts, and one before priorities as No priority, for every filter and
 * group alike; a creator nobody can be named for, and no repository, are
 * values of their own (`null`) a filter keeps and a group heads.
 */

/** The fields a filter narrows the tasks by. */
export const TASKS_FILTER_FIELD = {
  STATUS: "status",
  PRIORITY: "priority",
  CREATOR: "creator",
  REPOSITORY: "repository",
} as const;

export type TasksFilterField = (typeof TASKS_FILTER_FIELD)[keyof typeof TASKS_FILTER_FIELD];

/**
 * Which tasks stand: for each field, the values a task must hold one of; a
 * field absent or empty filters nothing. A creator is an account id, a
 * repository its full name, and `null` the tasks with none named.
 */
export interface TasksFilter {
  readonly status?: readonly TaskStatus[];
  readonly priority?: readonly TaskPriority[];
  readonly creator?: readonly (string | null)[];
  readonly repository?: readonly (string | null)[];
}

/** No filter: every task stands. */
export const NO_TASKS_FILTER: TasksFilter = {};

/** What groups the tasks: the List's groups and the Board's columns alike. */
export const TASKS_GROUPING = {
  STATUS: "status",
  PRIORITY: "priority",
  REPOSITORY: "repository",
  CREATOR: "creator",
  NONE: "none",
} as const;

export type TasksGrouping = (typeof TASKS_GROUPING)[keyof typeof TASKS_GROUPING];

/** What the Board may stand its columns by: a value a dragged card can be sent. */
export const BOARD_GROUPINGS: readonly TasksGrouping[] = [
  TASKS_GROUPING.STATUS,
  TASKS_GROUPING.PRIORITY,
];

/** How a group orders its tasks. */
export const TASKS_ORDER = {
  PRIORITY: "priority",
  UPDATED: "updated",
  CREATED: "created",
  NAME: "name",
} as const;

export type TasksOrder = (typeof TASKS_ORDER)[keyof typeof TASKS_ORDER];

/** The properties a row or a card may draw beside a task's name. */
export const TASK_PROPERTY = {
  PRIORITY: "priority",
  KEY: "key",
  STATUS: "status",
  WAITING: "waiting",
  REPOSITORY: "repository",
  CREATOR: "creator",
  AGENTS: "agents",
  UPDATED: "updated",
} as const;

export type TaskProperty = (typeof TASK_PROPERTY)[keyof typeof TASK_PROPERTY];

/** Every property, in the order a row draws them and the menu lists them. */
export const TASK_PROPERTY_ORDER: readonly TaskProperty[] = Object.values(TASK_PROPERTY);

/** The properties a Board's card has a place for: every one a row has. */
export const BOARD_PROPERTIES: readonly TaskProperty[] = TASK_PROPERTY_ORDER;

/**
 * The properties a Board's card offered before it offered every one, which a
 * Board display kept by an earlier build was chosen among: whatever it has
 * a place for since stands as the Board's own display draws it.
 */
export const EARLIER_BOARD_PROPERTIES: readonly TaskProperty[] = [
  TASK_PROPERTY.PRIORITY,
  TASK_PROPERTY.KEY,
  TASK_PROPERTY.STATUS,
  TASK_PROPERTY.REPOSITORY,
  TASK_PROPERTY.CREATOR,
];

/** How one view lays the tasks that stand out. */
export interface TasksDisplay {
  readonly grouping: TasksGrouping;
  readonly order: TasksOrder;
  /** Whether a status's or a priority's group stands with no task in it. */
  readonly emptyGroups: boolean;
  /** Whether the Done tasks stand. */
  readonly done: boolean;
  /** Whether the Canceled tasks stand. */
  readonly canceled: boolean;
  /** Whether the pinned tasks, then the account's sections, lead the List before its groups. */
  readonly pinnedFirst: boolean;
  /** The properties drawn, in `TASK_PROPERTY_ORDER`. */
  readonly properties: readonly TaskProperty[];
}

/** The List until its reader changes it: by status from the work under way, the most pressing first, nothing settled, the pins and sections leading. */
export const DEFAULT_LIST_DISPLAY: TasksDisplay = {
  grouping: TASKS_GROUPING.STATUS,
  order: TASKS_ORDER.PRIORITY,
  emptyGroups: false,
  done: false,
  canceled: false,
  pinnedFirst: true,
  properties: TASK_PROPERTY_ORDER,
};

/** The Board until its reader changes it: a column for every status but Canceled, every one standing, the most pressing first, each card drawing all but when it was last updated. */
export const DEFAULT_BOARD_DISPLAY: TasksDisplay = {
  grouping: TASKS_GROUPING.STATUS,
  order: TASKS_ORDER.PRIORITY,
  emptyGroups: true,
  done: true,
  canceled: false,
  pinnedFirst: false,
  properties: TASK_PROPERTY_ORDER.filter((property) => property !== TASK_PROPERTY.UPDATED),
};

/**
 * A display kept when its view offered only `offered`, read today: each
 * property offered since stands as the view's own display, `initial`, draws
 * it, so a property a card gained is drawn rather than read as one turned
 * off; the rest stand as kept.
 */
export function withPropertiesOffered(
  properties: readonly TaskProperty[],
  offered: readonly TaskProperty[],
  initial: readonly TaskProperty[],
): readonly TaskProperty[] {
  return TASK_PROPERTY_ORDER.filter((property) =>
    offered.includes(property) ? properties.includes(property) : initial.includes(property),
  );
}

/** What heads one group: a pin, a section, or a value of the grouping. */
export const TASKS_GROUP = {
  PINNED: "pinned",
  SECTION: "section",
  STATUS: "status",
  PRIORITY: "priority",
  REPOSITORY: "repository",
  CREATOR: "creator",
  ALL: "all",
} as const;

/** What one group stands for. */
export type TasksGroupHead =
  | { readonly kind: typeof TASKS_GROUP.PINNED }
  | { readonly kind: typeof TASKS_GROUP.SECTION; readonly sectionId: string }
  | { readonly kind: typeof TASKS_GROUP.STATUS; readonly status: TaskStatus }
  | { readonly kind: typeof TASKS_GROUP.PRIORITY; readonly priority: TaskPriority }
  | { readonly kind: typeof TASKS_GROUP.REPOSITORY; readonly repository: string | null }
  | { readonly kind: typeof TASKS_GROUP.CREATOR; readonly creatorId: string | null }
  | { readonly kind: typeof TASKS_GROUP.ALL };

/** One group as drawn: what heads it, and its tasks in order. */
export interface TasksGroup {
  readonly head: TasksGroupHead;
  readonly tasks: readonly TaskSummary[];
}

/** A section of the account's as the List is handed it: its id and its tasks' ids, in the section's own order. */
export interface TasksSection {
  readonly sectionId: string;
  readonly taskIds: readonly string[];
}

/**
 * The order the List runs its status groups in: the work under way first,
 * then what waits, then the settled, as a reader scans for what is moving
 * before what is filed. The Board's columns run as work moves instead
 * (`TASK_STATUS_ORDER`).
 */
const TASKS_LIST_STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.TODO,
  TASK_STATUS.BACKLOG,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

/** A task's status, Todo for one from a service before statuses. */
function statusOf(task: TaskSummary): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

/** A task's priority, No priority for one from a service before priorities. */
function priorityOf(task: TaskSummary): TaskPriority {
  return task.priority ?? TASK_PRIORITY.NONE;
}

/** Who created a task, by account id: the creator the wire names, else its owner; null where neither is. */
function creatorOf(task: TaskSummary): string | null {
  return task.createdBy?.userId ?? task.ownerId ?? null;
}

/** A field's value on one task. */
function fieldValue(task: TaskSummary, field: TasksFilterField): string | null {
  switch (field) {
    case TASKS_FILTER_FIELD.STATUS:
      return statusOf(task);
    case TASKS_FILTER_FIELD.PRIORITY:
      return priorityOf(task);
    case TASKS_FILTER_FIELD.CREATOR:
      return creatorOf(task);
    case TASKS_FILTER_FIELD.REPOSITORY:
      return task.repository;
  }
}

/** The values a filter keeps for one field; none where it filters nothing by it. */
export function filterValues(
  filter: TasksFilter,
  field: TasksFilterField,
): readonly (string | null)[] {
  return filter[field] ?? [];
}

/** The fields a filter narrows by, in `TASKS_FILTER_FIELD`'s order. */
export function filteredFields(filter: TasksFilter): readonly TasksFilterField[] {
  return Object.values(TASKS_FILTER_FIELD).filter(
    (field) => filterValues(filter, field).length > 0,
  );
}

/** Whether a task holds one of each filtered field's values. */
function inFilter(task: TaskSummary, filter: TasksFilter): boolean {
  return filteredFields(filter).every((field) =>
    filterValues(filter, field).includes(fieldValue(task, field)),
  );
}

/** The filter with one value of a field turned on or off; a field left with none is dropped. */
export function toggledFilter<F extends TasksFilterField>(
  filter: TasksFilter,
  field: F,
  value: NonNullable<TasksFilter[F]>[number],
): TasksFilter {
  const held = filterValues(filter, field);
  const next = held.includes(value) ? held.filter((each) => each !== value) : [...held, value];
  return withField(filter, field, next);
}

/** The filter with a field's values set; a field set to none is dropped. */
function withField(
  filter: TasksFilter,
  field: TasksFilterField,
  values: readonly (string | null)[],
): TasksFilter {
  const { [field]: _dropped, ...rest } = filter;
  return values.length === 0 ? rest : { ...rest, [field]: values };
}

/** The filter without one field. */
export function clearedField(filter: TasksFilter, field: TasksFilterField): TasksFilter {
  return withField(filter, field, []);
}

/** How many tasks hold each value of a field, among the tasks handed. */
export function valueCounts(
  tasks: readonly TaskSummary[],
  field: TasksFilterField,
): ReadonlyMap<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const task of tasks) {
    const value = fieldValue(task, field);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Whether a task's status is one the display lets stand: every open one, and the settled where it shows them. */
function settledShown(task: TaskSummary, display: TasksDisplay): boolean {
  const status = statusOf(task);
  if (status === TASK_STATUS.DONE) return display.done;
  if (status === TASK_STATUS.CANCELED) return display.canceled;
  return true;
}

/** The tasks that stand: those in the filter, the settled where the display shows them. */
function standingTasks(
  tasks: readonly TaskSummary[],
  filter: TasksFilter,
  display: TasksDisplay,
): readonly TaskSummary[] {
  return tasks.filter((task) => inFilter(task, filter) && settledShown(task, display));
}

/** A priority's rank, the most pressing first. */
function priorityRank(task: TaskSummary): number {
  return TASK_PRIORITY_ORDER.indexOf(priorityOf(task));
}

/** Two tasks in the order chosen; a tie falls to the later activity. */
function byOrder(order: TasksOrder): (a: TaskSummary, b: TaskSummary) => number {
  const latest = (a: TaskSummary, b: TaskSummary) =>
    taskTime(b, TASK_ORDER.UPDATED) - taskTime(a, TASK_ORDER.UPDATED);
  switch (order) {
    case TASKS_ORDER.PRIORITY:
      return (a, b) => priorityRank(a) - priorityRank(b) || latest(a, b);
    case TASKS_ORDER.UPDATED:
      return latest;
    case TASKS_ORDER.CREATED:
      return (a, b) => b.createdAt - a.createdAt || latest(a, b);
    case TASKS_ORDER.NAME:
      return (a, b) => a.name.localeCompare(b.name) || latest(a, b);
  }
}

/** A repository's name without its owner: `relay` of `acme/relay`. */
function repositoryNameOf(repository: string): string {
  return repository.slice(repository.indexOf("/") + 1);
}

/** The values a grouping by a finite field may stand groups for, in order, the filter's own where it keeps any. */
function finiteValues<T extends string>(
  order: readonly T[],
  kept: readonly (string | null)[],
  shown: (value: T) => boolean,
): readonly T[] {
  return order.filter((value) => shown(value) && (kept.length === 0 || kept.includes(value)));
}

/** What a grouping groups by, and the head of one value's group. */
interface GroupingRule {
  readonly keyOf: (task: TaskSummary) => string | null;
  readonly head: (value: string | null) => TasksGroupHead;
  /** The values that stand as groups even with no task in them, in order, where empty groups are shown. */
  readonly standing: readonly (string | null)[];
  /** The order of two values' groups. */
  readonly compare: (a: string | null, b: string | null) => number;
}

/** What each grouping groups by, under a filter and a display, and the order its groups run in. */
function groupingRule(grouping: TasksGrouping, context: GroupingContext): GroupingRule | undefined {
  const { filter, display, statusOrder, readerId, creatorName } = context;
  const ranked = (order: readonly (string | null)[]) => (a: string | null, b: string | null) =>
    order.indexOf(a) - order.indexOf(b);
  switch (grouping) {
    case TASKS_GROUPING.STATUS: {
      const statuses = finiteValues(
        statusOrder,
        filterValues(filter, TASKS_FILTER_FIELD.STATUS),
        (status) =>
          status === TASK_STATUS.DONE
            ? display.done
            : status === TASK_STATUS.CANCELED
              ? display.canceled
              : true,
      );
      return {
        keyOf: statusOf,
        head: (value) => ({
          kind: TASKS_GROUP.STATUS,
          status: TASK_STATUS_ORDER.find((status) => status === value) ?? TASK_STATUS.TODO,
        }),
        standing: statuses,
        compare: ranked(statusOrder),
      };
    }
    case TASKS_GROUPING.PRIORITY:
      return {
        keyOf: priorityOf,
        head: (value) => ({
          kind: TASKS_GROUP.PRIORITY,
          priority:
            TASK_PRIORITY_ORDER.find((priority) => priority === value) ?? TASK_PRIORITY.NONE,
        }),
        standing: finiteValues(
          TASK_PRIORITY_ORDER,
          filterValues(filter, TASKS_FILTER_FIELD.PRIORITY),
          () => true,
        ),
        compare: ranked(TASK_PRIORITY_ORDER),
      };
    case TASKS_GROUPING.REPOSITORY:
      return {
        keyOf: (task) => task.repository,
        head: (repository) => ({ kind: TASKS_GROUP.REPOSITORY, repository }),
        standing: [],
        // Note that the tasks with no repository stand last, whatever the names.
        compare: (a, b) =>
          a === null || b === null
            ? Number(a === null) - Number(b === null)
            : repositoryNameOf(a).localeCompare(repositoryNameOf(b)) || a.localeCompare(b),
      };
    case TASKS_GROUPING.CREATOR: {
      const rank = (id: string | null) => (id === null ? 2 : id === readerId ? 0 : 1);
      return {
        keyOf: creatorOf,
        head: (creatorId) => ({ kind: TASKS_GROUP.CREATOR, creatorId }),
        standing: [],
        compare: (a, b) =>
          rank(a) - rank(b) ||
          (a === null || b === null ? 0 : creatorName(a).localeCompare(creatorName(b))),
      };
    }
    case TASKS_GROUPING.NONE:
      return undefined;
  }
}

/** What a grouping is worked out against. */
interface GroupingContext {
  readonly filter: TasksFilter;
  readonly display: TasksDisplay;
  readonly statusOrder: readonly TaskStatus[];
  readonly readerId: string | undefined;
  readonly creatorName: (userId: string) => string;
}

/** A group from its head and its tasks. */
function group(head: TasksGroupHead, tasks: readonly TaskSummary[]): TasksGroup {
  return { head, tasks };
}

/** The tasks grouped by the grouping chosen, each group in the order chosen, the groups in their own order. */
function groupedBy(tasks: readonly TaskSummary[], context: GroupingContext): readonly TasksGroup[] {
  const { display } = context;
  const ordered = tasks.toSorted(byOrder(display.order));
  const rule = groupingRule(display.grouping, context);
  if (rule === undefined)
    return ordered.length === 0 ? [] : [group({ kind: TASKS_GROUP.ALL }, ordered)];
  const held = new Map<string | null, TaskSummary[]>();
  if (display.emptyGroups) for (const value of rule.standing) held.set(value, []);
  for (const task of ordered) {
    const value = rule.keyOf(task);
    const members = held.get(value);
    if (members === undefined) held.set(value, [task]);
    else members.push(task);
  }
  return [...held]
    .sort(([a], [b]) => rule.compare(a, b))
    .map(([value, members]) => group(rule.head(value), members));
}

/**
 * The List's groups: where the display leads with them, the pinned tasks
 * first, in the order handed, then each of the account's sections, in its
 * own order, then the rest under the grouping chosen. Every group holds only
 * the tasks that stand (`standingTasks`), and a task stands in one group
 * alone: a pin before its section, a section before its grouping's group.
 * Pinned left with no task is not drawn, nor a section whose every task the
 * view leaves out, though a section holding no task at all is, so a row may
 * be dragged into it; a status's or a priority's group is where the display
 * shows empty groups.
 */
export function tasksListGroups(
  tasks: readonly TaskSummary[],
  {
    filter,
    display,
    pinned,
    sections,
    readerId,
    creatorName,
  }: {
    filter: TasksFilter;
    display: TasksDisplay;
    /** The pinned tasks' ids, in the order the sidebar's Pinned draws them. */
    pinned: readonly string[];
    sections: readonly TasksSection[];
    readerId: string | undefined;
    /** A creator's name as the page says it, which the creators' groups are ordered by. */
    creatorName: (userId: string) => string;
  },
): readonly TasksGroup[] {
  const standing = standingTasks(tasks, filter, display);
  const groups: TasksGroup[] = [];
  const placed = new Set<string>();
  if (display.pinnedFirst) {
    const byId = new Map(standing.map((task) => [task.id, task]));
    const take = (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const task = byId.get(id);
        if (task === undefined || placed.has(id)) return [];
        placed.add(id);
        return [task];
      });
    const pins = take(pinned);
    if (pins.length > 0) groups.push(group({ kind: TASKS_GROUP.PINNED }, pins));
    // Note that a section holding no task at all still stands, empty, so a row can be dragged into it, as the sidebar draws one; one whose tasks are only filtered out does not.
    for (const { sectionId, taskIds } of sections) {
      const held = take(taskIds);
      if (held.length > 0 || taskIds.length === 0) {
        groups.push(group({ kind: TASKS_GROUP.SECTION, sectionId }, held));
      }
    }
  }
  const rest = standing.filter((task) => !placed.has(task.id));
  const context = { filter, display, statusOrder: TASKS_LIST_STATUS_ORDER, readerId, creatorName };
  return [...groups, ...groupedBy(rest, context)];
}

/**
 * The Board's columns: a column for each status, or each priority, the
 * display's grouping chooses, as work moves through them, each holding the
 * tasks that stand in it in the order chosen. A grouping the Board does not
 * stand columns by is read as Status. A column with no task stands where
 * the display shows empty groups.
 */
export function tasksBoardColumns(
  tasks: readonly TaskSummary[],
  { filter, display }: { filter: TasksFilter; display: TasksDisplay },
): readonly TasksGroup[] {
  const grouping = boardGrouping(display.grouping);
  return groupedBy(standingTasks(tasks, filter, display), {
    filter,
    display: { ...display, grouping },
    statusOrder: TASK_STATUS_ORDER,
    readerId: undefined,
    creatorName: () => "",
  });
}

/** The grouping the Board stands its columns by: the one chosen where it can, else Status. */
export function boardGrouping(grouping: TasksGrouping): TasksGrouping {
  return BOARD_GROUPINGS.includes(grouping) ? grouping : TASKS_GROUPING.STATUS;
}
