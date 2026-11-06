import {
  DESCRIPTION_ACTOR,
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import { repositoryParts, TASK_ORDER, taskTime } from "./task-list-model.js";

export function taskIdOf(task: TaskSummary): string {
  return task.id;
}

export const TASKS_FILTER_FIELD = {
  STATUS: "status",
  PRIORITY: "priority",
  ASSIGNEE: "assignee",
  CREATOR: "creator",
  MADE_BY: "madeBy",
  REPOSITORY: "repository",
} as const;

export type TasksFilterField = (typeof TASKS_FILTER_FIELD)[keyof typeof TASKS_FILTER_FIELD];

export interface TasksFilter {
  readonly status?: readonly TaskStatus[];
  readonly priority?: readonly TaskPriority[];
  readonly assignee?: readonly (string | null)[];
  readonly creator?: readonly (string | null)[];
  readonly madeBy?: readonly TaskMaker[];
  readonly repository?: readonly (string | null)[];
}

export const TASK_MAKER = {
  PERSON: "person",
  AGENT: "agent",
  APP: "app",
} as const;

export type TaskMaker = (typeof TASK_MAKER)[keyof typeof TASK_MAKER];

export const TASK_MAKER_ORDER: readonly TaskMaker[] = Object.values(TASK_MAKER);

export const NO_TASKS_FILTER: TasksFilter = {};

export const TASKS_GROUPING = {
  STATUS: "status",
  PRIORITY: "priority",
  REPOSITORY: "repository",
  ASSIGNEE: "assignee",
  CREATOR: "creator",
  NONE: "none",
} as const;

export type TasksGrouping = (typeof TASKS_GROUPING)[keyof typeof TASKS_GROUPING];

export const BOARD_GROUPINGS: readonly TasksGrouping[] = [
  TASKS_GROUPING.STATUS,
  TASKS_GROUPING.PRIORITY,
  TASKS_GROUPING.ASSIGNEE,
];

export const TASKS_ORDER = {
  PRIORITY: "priority",
  UPDATED: "updated",
  CREATED: "created",
  NAME: "name",
} as const;

export type TasksOrder = (typeof TASKS_ORDER)[keyof typeof TASKS_ORDER];

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

export const LIST_COLUMN = {
  SUB_TASKS: "subTasks",
} as const;

export type ListColumn = TaskProperty | (typeof LIST_COLUMN)[keyof typeof LIST_COLUMN];

export const TASK_PROPERTY_ORDER: readonly TaskProperty[] = Object.values(TASK_PROPERTY);

export const BOARD_PROPERTIES: readonly TaskProperty[] = TASK_PROPERTY_ORDER;

export const EARLIER_LIST_PROPERTIES: readonly TaskProperty[] = TASK_PROPERTY_ORDER.filter(
  (property) => property !== TASK_PROPERTY.ASSIGNEE,
);

export const EARLIER_BOARD_PROPERTIES: readonly TaskProperty[] = [
  TASK_PROPERTY.PRIORITY,
  TASK_PROPERTY.KEY,
  TASK_PROPERTY.STATUS,
  TASK_PROPERTY.REPOSITORY,
  TASK_PROPERTY.CREATOR,
];

export const COMPLETED_WINDOW = {
  NONE: "none",
  PAST_WEEK: "past-week",
  PAST_MONTH: "past-month",
  ALL: "all",
} as const;

export type CompletedWindow = (typeof COMPLETED_WINDOW)[keyof typeof COMPLETED_WINDOW];

const DAY_MS = 24 * 60 * 60 * 1000;

const COMPLETED_WINDOW_MS = {
  [COMPLETED_WINDOW.PAST_WEEK]: 7 * DAY_MS,
  [COMPLETED_WINDOW.PAST_MONTH]: 30 * DAY_MS,
} as const;

export interface TasksDisplay {
  readonly grouping: TasksGrouping;
  readonly order: TasksOrder;
  readonly emptyGroups: boolean;
  readonly completed: CompletedWindow;
  readonly pinnedFirst: boolean;
  readonly properties: readonly TaskProperty[];
}

export type KeptTasksDisplay = Partial<TasksDisplay> & {
  readonly done?: boolean;
  readonly canceled?: boolean;
  readonly offered?: readonly TaskProperty[];
};

function withPropertiesOffered(
  properties: readonly TaskProperty[],
  offered: readonly TaskProperty[],
  initial: readonly TaskProperty[],
): readonly TaskProperty[] {
  return TASK_PROPERTY_ORDER.filter((property) =>
    offered.includes(property) ? properties.includes(property) : initial.includes(property),
  );
}

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

export const DEFAULT_LIST_DISPLAY: TasksDisplay = {
  grouping: TASKS_GROUPING.STATUS,
  order: TASKS_ORDER.PRIORITY,
  emptyGroups: false,
  completed: COMPLETED_WINDOW.NONE,
  pinnedFirst: true,
  properties: TASK_PROPERTY_ORDER.filter((property) => property !== TASK_PROPERTY.CREATOR),
};

export const LIST_FOLD_ORDER: readonly ListColumn[] = [
  TASK_PROPERTY.CREATOR,
  TASK_PROPERTY.AGENTS,
  LIST_COLUMN.SUB_TASKS,
  TASK_PROPERTY.REPOSITORY,
  TASK_PROPERTY.KEY,
  TASK_PROPERTY.WAITING,
];

const LIST_COLUMN_ROOM = {
  [TASK_PROPERTY.PRIORITY]: 32,
  [TASK_PROPERTY.KEY]: 72,
  [TASK_PROPERTY.STATUS]: 32,
  [TASK_PROPERTY.WAITING]: 36,
  [TASK_PROPERTY.REPOSITORY]: 160,
  [TASK_PROPERTY.ASSIGNEE]: 32,
  [TASK_PROPERTY.CREATOR]: 140,
  [TASK_PROPERTY.AGENTS]: 100,
  [LIST_COLUMN.SUB_TASKS]: 76,
  [TASK_PROPERTY.UPDATED]: 76,
} as const satisfies Record<ListColumn, number>;

const LIST_ROW_ROOM = 52;

const LIST_NAME_ROOM = 240;

export function listPropertiesFitting<Column extends ListColumn>(
  properties: readonly Column[],
  width: number,
): readonly Column[] {
  const needs = (shown: readonly Column[]) =>
    shown.reduce((room, property) => room + LIST_COLUMN_ROOM[property], LIST_ROW_ROOM);
  return LIST_FOLD_ORDER.reduce(
    (shown, folding) =>
      needs(shown) + LIST_NAME_ROOM <= width
        ? shown
        : shown.filter((property) => property !== folding),
    properties,
  );
}

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

export type TasksGroupHead =
  | { readonly kind: typeof TASKS_GROUP.PINNED }
  | { readonly kind: typeof TASKS_GROUP.SECTION; readonly sectionId: string }
  | { readonly kind: typeof TASKS_GROUP.STATUS; readonly status: TaskStatus }
  | { readonly kind: typeof TASKS_GROUP.PRIORITY; readonly priority: TaskPriority }
  | { readonly kind: typeof TASKS_GROUP.REPOSITORY; readonly repository: string | null }
  | { readonly kind: typeof TASKS_GROUP.ASSIGNEE; readonly assigneeId: string | null }
  | { readonly kind: typeof TASKS_GROUP.CREATOR; readonly creatorId: string | null }
  | { readonly kind: typeof TASKS_GROUP.ALL };

export interface TasksGroup {
  readonly head: TasksGroupHead;
  readonly tasks: readonly TaskSummary[];
  readonly older?: number;
}

export interface TasksSection {
  readonly sectionId: string;
  readonly taskIds: readonly string[];
}

const TASKS_LIST_STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.TODO,
  TASK_STATUS.BACKLOG,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

function statusOf(task: TaskSummary): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

function priorityOf(task: TaskSummary): TaskPriority {
  return task.priority ?? TASK_PRIORITY.NONE;
}

function assigneeOf(task: TaskSummary): string | null {
  return task.assignee?.userId ?? null;
}

function creatorOf(task: TaskSummary): string | null {
  return task.createdBy?.userId ?? task.ownerId ?? null;
}

function makerOf(task: Pick<TaskSummary, "origin">): TaskMaker {
  switch (task.origin?.actor) {
    case undefined:
      return TASK_MAKER.PERSON;
    case DESCRIPTION_ACTOR.AGENT:
      return TASK_MAKER.AGENT;
    case DESCRIPTION_ACTOR.NOTETAKER:
      return TASK_MAKER.APP;
  }
}

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

export function filterValues(
  filter: TasksFilter,
  field: TasksFilterField,
): readonly (string | null)[] {
  return filter[field] ?? [];
}

export function filteredFields(filter: TasksFilter): readonly TasksFilterField[] {
  return Object.values(TASKS_FILTER_FIELD).filter(
    (field) => filterValues(filter, field).length > 0,
  );
}

function inFilter(task: TaskSummary, filter: TasksFilter): boolean {
  return filteredFields(filter).every((field) =>
    filterValues(filter, field).includes(fieldValue(task, field)),
  );
}

export function toggledFilter<F extends TasksFilterField>(
  filter: TasksFilter,
  field: F,
  value: NonNullable<TasksFilter[F]>[number],
): TasksFilter {
  const held = filterValues(filter, field);
  const next = held.includes(value) ? held.filter((each) => each !== value) : [...held, value];
  return withField(filter, field, next);
}

function withField(
  filter: TasksFilter,
  field: TasksFilterField,
  values: readonly (string | null)[],
): TasksFilter {
  const { [field]: _dropped, ...rest } = filter;
  return values.length === 0 ? rest : { ...rest, [field]: values };
}

export function clearedField(filter: TasksFilter, field: TasksFilterField): TasksFilter {
  return withField(filter, field, []);
}

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

function isSettled(status: TaskStatus): boolean {
  return status === TASK_STATUS.DONE || status === TASK_STATUS.CANCELED;
}

function finishedAt(task: TaskSummary): number {
  return task.completedAt ?? task.updatedAt;
}

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

interface StandingTasks {
  readonly standing: readonly TaskSummary[];
  readonly older: readonly TaskSummary[];
}

function namedByFilter(filter: TasksFilter, status: TaskStatus): boolean {
  return filterValues(filter, TASKS_FILTER_FIELD.STATUS).includes(status);
}

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

function priorityRank(task: TaskSummary): number {
  return TASK_PRIORITY_ORDER.indexOf(priorityOf(task));
}

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

function finiteValues<T extends string>(
  order: readonly T[],
  kept: readonly (string | null)[],
  shown: (value: T) => boolean,
): readonly T[] {
  return order.filter((value) => shown(value) && (kept.length === 0 || kept.includes(value)));
}

function byPerson(
  readerId: string | undefined,
  personName: (userId: string) => string,
): (a: string | null, b: string | null) => number {
  const rank = (id: string | null) => (id === null ? 2 : id === readerId ? 0 : 1);
  return (a, b) =>
    rank(a) - rank(b) ||
    (a === null || b === null ? 0 : personName(a).localeCompare(personName(b)));
}

interface GroupingRule {
  readonly keyOf: (task: TaskSummary) => string | null;
  readonly head: (value: string | null) => TasksGroupHead;
  readonly standing: readonly (string | null)[];
  readonly compare: (a: string | null, b: string | null) => number;
}

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
        compare: (a, b) =>
          a === null || b === null
            ? Number(a === null) - Number(b === null)
            : repositoryParts(a).name.localeCompare(repositoryParts(b).name) || a.localeCompare(b),
      };
    case TASKS_GROUPING.ASSIGNEE: {
      const kept = filterValues(filter, TASKS_FILTER_FIELD.ASSIGNEE);
      const people = new Set([...(readerId === undefined ? [] : [readerId]), ...members]);
      return {
        keyOf: assigneeOf,
        head: (assigneeId) => ({ kind: TASKS_GROUP.ASSIGNEE, assigneeId }),
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

interface GroupingContext {
  readonly filter: TasksFilter;
  readonly display: TasksDisplay;
  readonly statusOrder: readonly TaskStatus[];
  readonly readerId: string | undefined;
  readonly personName: (userId: string) => string;
  readonly members: readonly string[];
}

function group(head: TasksGroupHead, tasks: readonly TaskSummary[], older = 0): TasksGroup {
  return older === 0 ? { head, tasks } : { head, tasks, older };
}

function countByStatus(tasks: readonly TaskSummary[]): ReadonlyMap<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const task of tasks) counts.set(statusOf(task), (counts.get(statusOf(task)) ?? 0) + 1);
  return counts;
}

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
    pinned: readonly string[];
    sections: readonly TasksSection[];
    readerId: string | undefined;
    personName: (userId: string) => string;
    members: readonly string[];
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
    personName: (userId: string) => string;
    members: readonly string[];
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

export function boardGrouping(grouping: TasksGrouping): TasksGrouping {
  return BOARD_GROUPINGS.includes(grouping) ? grouping : TASKS_GROUPING.STATUS;
}
