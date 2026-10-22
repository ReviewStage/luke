import {
  PLAN_ACTOR,
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
 * Assignee, Creator, Made by, and Repository, keeps the values a task must hold one of, and a
 * field with none filters nothing; the fields are and-ed. It is one for
 * both views, since the List and the Board are two looks at the same
 * tasks. The display says how the tasks that stand are laid out: what
 * groups them (the Board's columns), how each group orders them, whether a
 * group with no task still stands, which of the settled, Done and Canceled,
 * stand beside the open work (none, those finished in the past week or
 * month, or all, as Linear's "completed issues" option reads, though a
 * settled status the filter names stands in full), whether the pins and the account's sections
 * lead the List, and which of a task's properties its row or card draws.
 * The List and the Board each keep a display of their own, because a board
 * wants every column in sight and the finished work in its last one, where a
 * list wants the work under way and nothing settled in the way of it.
 *
 * A task from a service before statuses stands as Todo, where a task
 * starts, and one before priorities as No priority, for every filter and
 * group alike; no assignee, a creator nobody can be named for, and no
 * repository, are values of their own (`null`) a filter keeps and a group
 * heads. A settled
 * task from a service before it kept when a task was finished counts as
 * finished at its last save (`updatedAt`).
 */

/** The fields a filter narrows the tasks by. */
export const TASKS_FILTER_FIELD = {
  STATUS: "status",
  PRIORITY: "priority",
  ASSIGNEE: "assignee",
  CREATOR: "creator",
  MADE_BY: "madeBy",
  REPOSITORY: "repository",
} as const;

export type TasksFilterField = (typeof TASKS_FILTER_FIELD)[keyof typeof TASKS_FILTER_FIELD];

/**
 * Which tasks stand: for each field, the values a task must hold one of; a
 * field absent or empty filters nothing. An assignee and a creator are an
 * account id, a repository its full name, and `null` the tasks with none
 * named.
 */
export interface TasksFilter {
  readonly status?: readonly TaskStatus[];
  readonly priority?: readonly TaskPriority[];
  readonly assignee?: readonly (string | null)[];
  readonly creator?: readonly (string | null)[];
  readonly madeBy?: readonly TaskMaker[];
  readonly repository?: readonly (string | null)[];
}

/** Who made a task, as the filter's Made by tells them apart: a person by hand, a coding agent, or Luke on a call. */
export const TASK_MAKER = {
  PERSON: "person",
  AGENT: "agent",
  LUKE: "luke",
} as const;

export type TaskMaker = (typeof TASK_MAKER)[keyof typeof TASK_MAKER];

/** Every maker, in the order the filter offers them. */
export const TASK_MAKER_ORDER: readonly TaskMaker[] = Object.values(TASK_MAKER);

/** No filter: every task stands. */
export const NO_TASKS_FILTER: TasksFilter = {};

/** What groups the tasks: the List's groups and the Board's columns alike. */
export const TASKS_GROUPING = {
  STATUS: "status",
  PRIORITY: "priority",
  REPOSITORY: "repository",
  ASSIGNEE: "assignee",
  CREATOR: "creator",
  NONE: "none",
} as const;

export type TasksGrouping = (typeof TASKS_GROUPING)[keyof typeof TASKS_GROUPING];

/** What the Board may stand its columns by: a value a dragged card can be sent. */
export const BOARD_GROUPINGS: readonly TasksGrouping[] = [
  TASKS_GROUPING.STATUS,
  TASKS_GROUPING.PRIORITY,
  TASKS_GROUPING.ASSIGNEE,
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
  ASSIGNEE: "assignee",
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
 * The properties a List's row offered before it offered the assignee, which a
 * List display kept by a build that did not say what it offered was chosen
 * among.
 */
export const EARLIER_LIST_PROPERTIES: readonly TaskProperty[] = TASK_PROPERTY_ORDER.filter(
  (property) => property !== TASK_PROPERTY.ASSIGNEE,
);

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

/** Which of the settled tasks, Done and Canceled, stand: none, those finished within the past week or month, or every one. */
export const COMPLETED_WINDOW = {
  NONE: "none",
  PAST_WEEK: "past-week",
  PAST_MONTH: "past-month",
  ALL: "all",
} as const;

export type CompletedWindow = (typeof COMPLETED_WINDOW)[keyof typeof COMPLETED_WINDOW];

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back each window that reaches back at all reaches, in milliseconds. */
const COMPLETED_WINDOW_MS = {
  [COMPLETED_WINDOW.PAST_WEEK]: 7 * DAY_MS,
  [COMPLETED_WINDOW.PAST_MONTH]: 30 * DAY_MS,
} as const;

/** How one view lays the tasks that stand out. */
export interface TasksDisplay {
  readonly grouping: TasksGrouping;
  readonly order: TasksOrder;
  /** Whether a status's or a priority's group stands with no task in it. */
  readonly emptyGroups: boolean;
  /** Which of the Done and Canceled tasks stand, by when each was finished. */
  readonly completed: CompletedWindow;
  /** Whether the pinned tasks, then the account's sections, lead the List before its groups. */
  readonly pinnedFirst: boolean;
  /** The properties drawn, in `TASK_PROPERTY_ORDER`. */
  readonly properties: readonly TaskProperty[];
}

/**
 * A display as a view keeps it: each choice optional, so one kept by an
 * earlier build reads over the view's own for whatever it lacks; the Done
 * and Canceled switches an earlier build kept before the completed window
 * replaced them; and the properties the view offered when it was kept,
 * absent from a build before it said so.
 */
export type KeptTasksDisplay = Partial<TasksDisplay> & {
  readonly done?: boolean;
  readonly canceled?: boolean;
  readonly offered?: readonly TaskProperty[];
};

/**
 * A display kept when its view offered only `offered`, read today: each
 * property offered since stands as the view's own display, `initial`, draws
 * it, so a property a card gained is drawn rather than read as one turned
 * off; the rest stand as kept.
 */
function withPropertiesOffered(
  properties: readonly TaskProperty[],
  offered: readonly TaskProperty[],
  initial: readonly TaskProperty[],
): readonly TaskProperty[] {
  return TASK_PROPERTY_ORDER.filter((property) =>
    offered.includes(property) ? properties.includes(property) : initial.includes(property),
  );
}

/**
 * The display a view kept, over its own `initial` for whatever it lacks. A
 * display kept with the earlier switches and no window reads as the past
 * week where it showed either settled status, and as none where it showed
 * neither, so nobody's saved view loses or floods its finished work. Its
 * properties were chosen among those it says it was offered, else among
 * `earlier`, what its view offered before a display said so; one offered
 * since stands as `initial` draws it (`withPropertiesOffered`).
 */
export function keptTasksDisplay(
  kept: KeptTasksDisplay,
  initial: TasksDisplay,
  earlier: readonly TaskProperty[],
): TasksDisplay {
  const { done, canceled, offered, properties, ...rest } = kept;
  const switched = done !== undefined || canceled !== undefined;
  const switchedWindow =
    done === true || canceled === true ? COMPLETED_WINDOW.PAST_WEEK : COMPLETED_WINDOW.NONE;
  return {
    ...initial,
    ...rest,
    completed: kept.completed ?? (switched ? switchedWindow : initial.completed),
    properties:
      properties === undefined
        ? initial.properties
        : withPropertiesOffered(properties, offered ?? earlier, initial.properties),
  };
}

/** The List until its reader changes it: by status from the work under way, the most pressing first, nothing settled, the pins and sections leading, each row drawing all but its creator, its assignee saying who is on it. */
export const DEFAULT_LIST_DISPLAY: TasksDisplay = {
  grouping: TASKS_GROUPING.STATUS,
  order: TASKS_ORDER.PRIORITY,
  emptyGroups: false,
  completed: COMPLETED_WINDOW.NONE,
  pinnedFirst: true,
  properties: TASK_PROPERTY_ORDER.filter((property) => property !== TASK_PROPERTY.CREATOR),
};

/** The Board until its reader changes it: a column for every status, every one standing, the most pressing first, the settled finished in the past week, each card drawing all but its creator and when it was last updated. */
export const DEFAULT_BOARD_DISPLAY: TasksDisplay = {
  grouping: TASKS_GROUPING.STATUS,
  order: TASKS_ORDER.PRIORITY,
  emptyGroups: true,
  completed: COMPLETED_WINDOW.PAST_WEEK,
  pinnedFirst: false,
  properties: TASK_PROPERTY_ORDER.filter(
    (property) => property !== TASK_PROPERTY.UPDATED && property !== TASK_PROPERTY.CREATOR,
  ),
};

/** What heads one group: a pin, a section, or a value of the grouping. */
export const TASKS_GROUP = {
  PINNED: "pinned",
  SECTION: "section",
  STATUS: "status",
  PRIORITY: "priority",
  REPOSITORY: "repository",
  ASSIGNEE: "assignee",
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
  | { readonly kind: typeof TASKS_GROUP.ASSIGNEE; readonly assigneeId: string | null }
  | { readonly kind: typeof TASKS_GROUP.CREATOR; readonly creatorId: string | null }
  | { readonly kind: typeof TASKS_GROUP.ALL };

/** One group as drawn: what heads it, and its tasks in order. */
export interface TasksGroup {
  readonly head: TasksGroupHead;
  readonly tasks: readonly TaskSummary[];
  /** How many of a settled status's tasks the completed window leaves out as finished before it; absent where it leaves none. */
  readonly older?: number;
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

/** Who a task is assigned to, by account id; null where no one is. */
function assigneeOf(task: TaskSummary): string | null {
  return task.assignee?.userId ?? null;
}

/** Who created a task, by account id: the creator the wire names, else its owner; null where neither is. */
function creatorOf(task: TaskSummary): string | null {
  return task.createdBy?.userId ?? task.ownerId ?? null;
}

/** Who made a task: a person by hand, read so for a task from a service before origins; a coding agent, one an automation's run started among them, whose task names the automation; or Luke on a call. */
function makerOf(task: Pick<TaskSummary, "origin">): TaskMaker {
  switch (task.origin?.actor) {
    case undefined:
      return TASK_MAKER.PERSON;
    case PLAN_ACTOR.AGENT:
      return TASK_MAKER.AGENT;
    case PLAN_ACTOR.NOTETAKER:
      return TASK_MAKER.LUKE;
  }
}

/** A field's value on one task. */
function fieldValue(task: TaskSummary, field: TasksFilterField): string | null {
  switch (field) {
    case TASKS_FILTER_FIELD.STATUS:
      return statusOf(task);
    case TASKS_FILTER_FIELD.PRIORITY:
      return priorityOf(task);
    case TASKS_FILTER_FIELD.ASSIGNEE:
      return assigneeOf(task);
    case TASKS_FILTER_FIELD.CREATOR:
      return creatorOf(task);
    case TASKS_FILTER_FIELD.MADE_BY:
      return makerOf(task);
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

/** Whether a status is settled: Done or Canceled. */
function isSettled(status: TaskStatus): boolean {
  return status === TASK_STATUS.DONE || status === TASK_STATUS.CANCELED;
}

/** When a settled task was finished: as the service kept it, else its last save, for one from a service before it kept that. */
function finishedAt(task: TaskSummary): number {
  return task.completedAt ?? task.updatedAt;
}

/** Whether a settled task finished at `at` falls within the window, as of `now`. */
function inWindow(completed: CompletedWindow, at: number, now: number): boolean {
  switch (completed) {
    case COMPLETED_WINDOW.NONE:
      return false;
    case COMPLETED_WINDOW.ALL:
      return true;
    case COMPLETED_WINDOW.PAST_WEEK:
    case COMPLETED_WINDOW.PAST_MONTH:
      return now - at <= COMPLETED_WINDOW_MS[completed];
  }
}

/** What the filter and the display leave of the tasks: those that stand, and the settled the window leaves out as finished before it. */
interface StandingTasks {
  readonly standing: readonly TaskSummary[];
  readonly older: readonly TaskSummary[];
}

/** Whether the filter names a status itself, so the completed window holds none of its tasks back. */
function namedByFilter(filter: TasksFilter, status: TaskStatus): boolean {
  return filterValues(filter, TASKS_FILTER_FIELD.STATUS).includes(status);
}

/**
 * The tasks that stand: those in the filter, every open one, every settled
 * one of a status the filter names, and the other settled the completed
 * window keeps; and beside them the settled it leaves out as older, none
 * where it keeps no settled task at all. A Status filter of Done is asked
 * for its Done tasks, so the window, which keeps finished work out of the
 * way of the open, never empties it.
 */
function standingTasks(
  tasks: readonly TaskSummary[],
  filter: TasksFilter,
  display: TasksDisplay,
  now: number,
): StandingTasks {
  const standing: TaskSummary[] = [];
  const older: TaskSummary[] = [];
  for (const task of tasks) {
    if (!inFilter(task, filter)) continue;
    const status = statusOf(task);
    if (
      !isSettled(status) ||
      namedByFilter(filter, status) ||
      inWindow(display.completed, finishedAt(task), now)
    ) {
      standing.push(task);
    } else if (display.completed !== COMPLETED_WINDOW.NONE) {
      older.push(task);
    }
  }
  return { standing, older };
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

/**
 * The order of two people's groups, each by account id: the reader's own
 * first, then each other's by their name, then the tasks with no one, as the
 * sidebar orders its people's groups.
 */
function byPerson(
  readerId: string | undefined,
  personName: (userId: string) => string,
): (a: string | null, b: string | null) => number {
  const rank = (id: string | null) => (id === null ? 2 : id === readerId ? 0 : 1);
  return (a, b) =>
    rank(a) - rank(b) ||
    (a === null || b === null ? 0 : personName(a).localeCompare(personName(b)));
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
  const { filter, display, statusOrder, readerId, personName, members } = context;
  const ranked = (order: readonly (string | null)[]) => (a: string | null, b: string | null) =>
    order.indexOf(a) - order.indexOf(b);
  switch (grouping) {
    case TASKS_GROUPING.STATUS: {
      const statuses = finiteValues(
        statusOrder,
        filterValues(filter, TASKS_FILTER_FIELD.STATUS),
        (status) =>
          !isSettled(status) ||
          namedByFilter(filter, status) ||
          display.completed !== COMPLETED_WINDOW.NONE,
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
    case TASKS_GROUPING.ASSIGNEE: {
      const kept = filterValues(filter, TASKS_FILTER_FIELD.ASSIGNEE);
      const people = new Set([...(readerId === undefined ? [] : [readerId]), ...members]);
      return {
        keyOf: assigneeOf,
        head: (assigneeId) => ({ kind: TASKS_GROUP.ASSIGNEE, assigneeId }),
        // Note that every member stands, and no one, where empty groups do, so a card has a column to be dropped onto for someone with no task yet.
        standing: [...people, null].filter((id) => kept.length === 0 || kept.includes(id)),
        compare: byPerson(readerId, personName),
      };
    }
    case TASKS_GROUPING.CREATOR:
      return {
        keyOf: creatorOf,
        head: (creatorId) => ({ kind: TASKS_GROUP.CREATOR, creatorId }),
        standing: [],
        compare: byPerson(readerId, personName),
      };
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
  readonly personName: (userId: string) => string;
  readonly members: readonly string[];
}

/** A group from its head and its tasks, with how many older settled tasks it leaves out where it leaves any. */
function group(head: TasksGroupHead, tasks: readonly TaskSummary[], older = 0): TasksGroup {
  return older === 0 ? { head, tasks } : { head, tasks, older };
}

/** How many of the tasks hold each status. */
function countByStatus(tasks: readonly TaskSummary[]): ReadonlyMap<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const task of tasks) counts.set(statusOf(task), (counts.get(statusOf(task)) ?? 0) + 1);
  return counts;
}

/**
 * The tasks grouped by the grouping chosen, each group in the order chosen,
 * the groups in their own order. Grouped by status, a settled status's group
 * counts the `older` tasks the window left out of it, and stands for them
 * even with no task of its own, so they are a press away.
 */
function groupedBy(
  { standing: tasks, older }: StandingTasks,
  context: GroupingContext,
): readonly TasksGroup[] {
  const { display } = context;
  const ordered = tasks.toSorted(byOrder(display.order));
  const rule = groupingRule(display.grouping, context);
  if (rule === undefined)
    return ordered.length === 0 ? [] : [group({ kind: TASKS_GROUP.ALL }, ordered)];
  const olderBy =
    display.grouping === TASKS_GROUPING.STATUS ? countByStatus(older) : new Map<string, number>();
  const held = new Map<string | null, TaskSummary[]>();
  if (display.emptyGroups) for (const value of rule.standing) held.set(value, []);
  for (const value of olderBy.keys()) if (!held.has(value)) held.set(value, []);
  for (const task of ordered) {
    const value = rule.keyOf(task);
    const members = held.get(value);
    if (members === undefined) held.set(value, [task]);
    else members.push(task);
  }
  return [...held]
    .sort(([a], [b]) => rule.compare(a, b))
    .map(([value, members]) => group(rule.head(value), members, olderBy.get(value)));
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
    personName,
    members,
    now,
  }: {
    filter: TasksFilter;
    display: TasksDisplay;
    /** The pinned tasks' ids, in the order the sidebar's Pinned draws them. */
    pinned: readonly string[];
    sections: readonly TasksSection[];
    readerId: string | undefined;
    /** A person's name as the page says it, which the assignees' and the creators' groups are ordered by. */
    personName: (userId: string) => string;
    /** The workspace's members, by account id, each of whom an assignee's group stands for where empty groups do. */
    members: readonly string[];
    /** Epoch milliseconds now, which the completed window reaches back from. */
    now: number;
  },
): readonly TasksGroup[] {
  const { standing, older } = standingTasks(tasks, filter, display, now);
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
  const context = {
    filter,
    display,
    statusOrder: TASKS_LIST_STATUS_ORDER,
    readerId,
    personName,
    members,
  };
  return [...groups, ...groupedBy({ standing: rest, older }, context)];
}

/**
 * The Board's columns: a column for each status, or each priority, as work
 * moves through them, or each assignee, the reader first, the display's
 * grouping chooses, each holding the tasks that stand in it in the order
 * chosen. A grouping the Board does not stand columns by is read as Status.
 * A column with no task stands where the display shows empty groups.
 */
export function tasksBoardColumns(
  tasks: readonly TaskSummary[],
  {
    filter,
    display,
    readerId,
    personName,
    members,
    now,
  }: {
    filter: TasksFilter;
    display: TasksDisplay;
    readerId: string | undefined;
    /** A person's name as the page says it, which the assignees' columns are ordered by. */
    personName: (userId: string) => string;
    /** The workspace's members, by account id, each of whom an assignee's column stands for where empty groups do. */
    members: readonly string[];
    /** Epoch milliseconds now, which the completed window reaches back from. */
    now: number;
  },
): readonly TasksGroup[] {
  const grouping = boardGrouping(display.grouping);
  return groupedBy(standingTasks(tasks, filter, display, now), {
    filter,
    display: { ...display, grouping },
    statusOrder: TASK_STATUS_ORDER,
    readerId,
    personName,
    members,
  });
}

/** The grouping the Board stands its columns by: the one chosen where it can, else Status. */
export function boardGrouping(grouping: TasksGrouping): TasksGrouping {
  return BOARD_GROUPINGS.includes(grouping) ? grouping : TASKS_GROUPING.STATUS;
}
