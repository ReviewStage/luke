import { inPinOrder } from "@luke/features/pin-order";
import {
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BADGE_TONE,
  Badge,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  List,
  ListRow,
  PAGE_FRAME,
  PAGE_WIDTH,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { creatorActor } from "@luke/ui/actor-model";
import { repositoryLabel, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { sectionOrder, workspaceSections } from "@luke/ui/task-sections-model";
import {
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_LIST_DISPLAY,
  filteredFields,
  NO_TASKS_FILTER,
  TASK_PROPERTY,
  TASK_PROPERTY_ORDER,
  TASKS_GROUP,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TaskProperty,
  type TasksDisplay,
  type TasksFilter,
  type TasksGroup,
  type TasksGroupHead,
  type TasksSection,
  tasksListGroups,
} from "@luke/ui/tasks-page-model";
import { Schema } from "effect";
import {
  FolderGitIcon,
  FolderIcon,
  FolderXIcon,
  ListTodoIcon,
  PinIcon,
  UserXIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { FIND_PAGE, PageFind } from "../find-in-tab.js";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import type { ShellRoom } from "../shell-room.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { useMinute } from "../tasks/task-time.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { readKept, writeKept } from "./folded-groups.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { TaskStatusMark as TaskWorkMark } from "./task-card.js";
import { TasksBoard } from "./tasks-board.js";
import {
  creatorWords,
  NO_CREATOR,
  NO_REPOSITORY,
  TasksFilterButton,
  TasksFilterChips,
  type TasksViewFrame,
  TasksViewOptions,
} from "./tasks-page-options.js";

/**
 * tasks-page.tsx -- the window's Tasks page: the listed workspace's tasks as a List or as the Board, chosen by a switch beside its title, narrowed by its Filter and laid out by its View options.
 *
 * It stands in the plan's place, opened by the sidebar's Tasks row, and its
 * way out is `EXIT_BOARD`, so Back, Escape, and the window's history treat it
 * as the place the Board alone once was. With the inbox-first sidebar on,
 * the sidebar lists the Inbox and this page is where the task list stands.
 *
 * Its toolbar ends in Filter and View options (`tasks-page-options.tsx`).
 * The filter is the page's, one for both views and one for each workspace,
 * since a creator and a repository are a workspace's own; each view keeps a
 * display of its own (`tasks-page-model.ts`). Which view it shows, the
 * filter, and both displays are kept on this Mac.
 *
 * The List runs the pinned tasks first, then each of the account's sections
 * while it keeps them, then the rest under the grouping chosen, by status
 * from the work under way at first (`tasksListGroups`). A row is the task's
 * priority, key, and status before its name, and at its end how many Inbox
 * threads of it wait on the reader, its repository, its creator's face,
 * what an agent is doing on it, and when it last moved, each where the view
 * draws it. A press opens the task.
 */

/** What the page is called, on its toolbar and to a screen reader. */
const TASKS = "Tasks";

/** The page's two views. */
export const TASKS_VIEW = {
  LIST: "list",
  BOARD: "board",
} as const;

export type TasksView = (typeof TASKS_VIEW)[keyof typeof TASKS_VIEW];

/** Where the view shown last, the filters (each workspace's by its id), and each view's display are kept in the renderer's storage. */
const VIEW_KEY = "luke.tasksPageView";
const FILTER_KEY = "luke.tasksFilter";
const DISPLAY_KEY = {
  [TASKS_VIEW.LIST]: "luke.tasksListDisplay",
  [TASKS_VIEW.BOARD]: "luke.tasksBoardDisplay",
} as const satisfies Record<TasksView, string>;

const storedView = Schema.fromJsonString(Schema.Literals(Object.values(TASKS_VIEW)));

/** The filters as kept: each workspace's by its id. */
const storedFilters = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      status: Schema.optionalKey(Schema.Array(Schema.Literals(Object.values(TASK_STATUS)))),
      priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
      creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
      repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    }),
  ),
);

/** A display as kept: each choice optional, so one kept by an earlier build reads over the view's own for whatever it lacks. */
const storedDisplay = Schema.fromJsonString(
  Schema.Struct({
    grouping: Schema.optionalKey(Schema.Literals(Object.values(TASKS_GROUPING))),
    order: Schema.optionalKey(Schema.Literals(Object.values(TASKS_ORDER))),
    emptyGroups: Schema.optionalKey(Schema.Boolean),
    done: Schema.optionalKey(Schema.Boolean),
    canceled: Schema.optionalKey(Schema.Boolean),
    pinnedFirst: Schema.optionalKey(Schema.Boolean),
    properties: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PROPERTY_ORDER))),
  }),
);

/** Each view's display until its reader changes it. */
const INITIAL_DISPLAY = {
  [TASKS_VIEW.LIST]: DEFAULT_LIST_DISPLAY,
  [TASKS_VIEW.BOARD]: DEFAULT_BOARD_DISPLAY,
} as const satisfies Record<TasksView, TasksDisplay>;

/** What the page is read as while the tasks are. */
const READING_LINE = "Reading tasks";

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = "Your tasks could not be read.";

/** What the List says where the filter and the view leave no task standing. */
const NONE_STANDING = "No tasks match this view";

/** What a group of pinned tasks is called. */
const PINNED = "Pinned";

/** What the page stands: its read, or none of the workspace's tasks. */
function listState(tasks: TasksControl, empty: boolean): CollectionState {
  if (tasks.listFailed && empty) return COLLECTION_STATE.ERROR;
  if (!tasks.listRead && !tasks.listFailed) return COLLECTION_STATE.LOADING;
  return empty ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
}

/** The List | Board switch beside the page's title. */
function ViewSwitch({
  view,
  onView,
}: {
  view: TasksView;
  onView: (view: TasksView) => void;
}): React.JSX.Element {
  return (
    <ChoiceBar<TasksView>
      label="Tasks view"
      items={[
        { value: TASKS_VIEW.LIST, label: "List" },
        { value: TASKS_VIEW.BOARD, label: "Board" },
      ]}
      value={view}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      size={CHOICE_BAR_SIZE.COMPACT}
      onChange={onView}
    />
  );
}

/** A view's display as kept, over its own initial one; its own where none was kept. */
function readDisplay(view: TasksView): TasksDisplay {
  return { ...INITIAL_DISPLAY[view], ...readKept(DISPLAY_KEY[view], storedDisplay, {}) };
}

/** The Tasks page, in the plan's place: the List or the Board, as the reader last chose, under its Filter and View options. */
export function TasksPage({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  const [view, setView] = useState(() => readKept(VIEW_KEY, storedView, TASKS_VIEW.LIST));
  const [displays, setDisplays] = useState(() => ({
    [TASKS_VIEW.LIST]: readDisplay(TASKS_VIEW.LIST),
    [TASKS_VIEW.BOARD]: readDisplay(TASKS_VIEW.BOARD),
  }));
  const [filters, setFilters] = useState<Readonly<Record<string, TasksFilter>>>(() =>
    readKept(FILTER_KEY, storedFilters, {}),
  );
  const workspaceId = tasks.workspace?.id;
  const filter =
    workspaceId === undefined ? NO_TASKS_FILTER : (filters[workspaceId] ?? NO_TASKS_FILTER);
  const onFilter = (next: TasksFilter) => {
    if (workspaceId === undefined) return;
    // Note that the record is read again before it is written, so another tab's filter for another workspace is kept.
    const kept = { ...readKept(FILTER_KEY, storedFilters, {}), [workspaceId]: next };
    setFilters(kept);
    writeKept(FILTER_KEY, storedFilters, kept);
  };
  const display = displays[view];
  const onDisplay = (next: TasksDisplay) => {
    setDisplays((held) => ({ ...held, [view]: next }));
    writeKept(DISPLAY_KEY[view], storedDisplay, next);
  };
  const choose = (next: TasksView) => {
    setView(next);
    writeKept(VIEW_KEY, storedView, next);
  };
  const shared = (tasks.workspace?.memberCount ?? 1) > 1;
  const listed = tasks.listed.tasks;
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{TASKS}</h1>
        <ViewSwitch view={view} onView={choose} />
      </div>
      <div className="desktop-toolbar-actions">
        <TasksFilterButton
          shown={tasks.shown}
          tasks={listed}
          filter={filter}
          onFilter={onFilter}
          shared={shared}
        />
        <TasksViewOptions
          shown={tasks.shown}
          board={view === TASKS_VIEW.BOARD}
          display={display}
          initial={INITIAL_DISPLAY[view]}
          onDisplay={onDisplay}
          shared={shared}
        />
      </div>
    </header>
  );
  const chips =
    filteredFields(filter).length === 0 ? null : (
      <TasksFilterChips tasks={listed} filter={filter} onFilter={onFilter} />
    );
  const frame = { toolbar, chips, filter, display };
  // Note that find's subject is the view shown, so a search in one view is let go as the other is chosen.
  return (
    <PageFind page={FIND_PAGE.BOARD} at={view} active={tasks.shown}>
      {/* A face names its creator, and the Filter offers the creators, against the listed workspace's members. */}
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        {view === TASKS_VIEW.BOARD ? (
          <TasksBoard tasks={tasks} room={room} title={TASKS} frame={frame} />
        ) : (
          <TasksList tasks={tasks} frame={frame} />
        )}
      </MemberDirectory>
    </PageFind>
  );
}

/** The account's sections in the listed workspace, each with its tasks' ids in its own order; none while it keeps no sections. */
function listSections(tasks: TasksControl): readonly TasksSection[] {
  const workspaceId = tasks.workspace?.id;
  if (workspaceId === undefined) return [];
  return workspaceSections(tasks.taskSections, workspaceId).map((section) => ({
    sectionId: section.id,
    taskIds: sectionOrder(tasks.taskSections, section.id).map((entry) => entry.taskId),
  }));
}

/** What heads a group of the List. */
interface GroupHead {
  readonly icon: ReactNode;
  readonly name: string;
}

/** What heads a group: its glyph and its name. */
function groupHead(
  head: TasksGroupHead,
  tasks: TasksControl,
  /** Every repository a group stands for, which a repository's head tells its own apart from. */
  repositories: readonly { readonly repository: string | null }[],
  creatorName: (creatorId: string | null) => string,
  creatorMark: (creatorId: string) => ReactNode,
): GroupHead {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return { icon: <PinIcon />, name: PINNED };
    case TASKS_GROUP.SECTION: {
      const section = tasks.taskSections.sections.find((each) => each.id === head.sectionId);
      return {
        icon: sectionGlyph(section?.icon) ?? <FolderIcon />,
        name: section?.title ?? "",
      };
    }
    case TASKS_GROUP.STATUS:
      return {
        icon: <TaskStatusMark status={head.status} />,
        name: TASK_STATUS_WORDS[head.status],
      };
    case TASKS_GROUP.PRIORITY:
      return {
        icon: <TaskPriorityMark priority={head.priority} />,
        name: TASK_PRIORITY_WORDS[head.priority],
      };
    case TASKS_GROUP.REPOSITORY:
      return head.repository === null
        ? { icon: <FolderXIcon />, name: NO_REPOSITORY }
        : { icon: <FolderGitIcon />, name: repositoryLabel(head.repository, repositories) };
    case TASKS_GROUP.CREATOR:
      return head.creatorId === null
        ? { icon: <UserXIcon />, name: NO_CREATOR }
        : { icon: creatorMark(head.creatorId), name: creatorName(head.creatorId) };
    case TASKS_GROUP.ALL:
      return { icon: null, name: TASKS };
  }
}

/** The value a group of the grouping chosen stands for, which keys it among its run; none for a pin, a section, the run of every task, and the tasks with no repository or creator. */
function groupValue(head: TasksGroupHead): string | undefined {
  switch (head.kind) {
    case TASKS_GROUP.STATUS:
      return head.status;
    case TASKS_GROUP.PRIORITY:
      return head.priority;
    case TASKS_GROUP.REPOSITORY:
      return head.repository ?? undefined;
    case TASKS_GROUP.CREATOR:
      return head.creatorId ?? undefined;
    default:
      return undefined;
  }
}

/** One task's row: its priority, key, and status before its name, and at its end what waits on the reader, its repository, its creator, its work, and its time, each where the view draws it. */
function TaskListRow({
  task,
  workspaceName,
  waiting,
  now,
  properties,
  onOpen,
}: {
  task: TaskSummary;
  workspaceName: string;
  /** How many of its Inbox threads wait on the reader. */
  waiting: number;
  now: number;
  properties: readonly TaskProperty[];
  onOpen: () => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  const drawn = (property: TaskProperty) => properties.includes(property);
  const key =
    task.number === undefined || !drawn(TASK_PROPERTY.KEY)
      ? undefined
      : taskKey(workspaceName, task.number);
  return (
    <ListRow
      leading={
        <span className="tasks-list-lead">
          {drawn(TASK_PROPERTY.PRIORITY) ? (
            <TaskPriorityMark priority={task.priority ?? TASK_PRIORITY.NONE} />
          ) : null}
          {key === undefined ? null : <span className="tasks-list-key">{key}</span>}
          {drawn(TASK_PROPERTY.STATUS) ? (
            <TaskStatusMark status={task.status ?? TASK_STATUS.TODO} />
          ) : null}
        </span>
      }
      title={
        <>
          {task.name}
          {/* Note that the leading marks are decoration to a screen reader, so the key and status are said here, and left out of find, which finds them drawn. */}
          <span className="visually-hidden" {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
            {[
              key,
              drawn(TASK_PROPERTY.STATUS) && task.status !== undefined
                ? TASK_STATUS_WORDS[task.status]
                : undefined,
            ]
              .filter((each) => each !== undefined)
              .map((each) => `, ${each}`)
              .join("")}
          </span>
        </>
      }
      meta={
        <span className="home-row-meta">
          {waiting === 0 || !drawn(TASK_PROPERTY.WAITING) ? null : (
            <Badge tone={BADGE_TONE.ATTENTION}>
              {`${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`}
            </Badge>
          )}
          {drawn(TASK_PROPERTY.REPOSITORY) ? (
            <span className="home-row-context">{task.repository ?? NO_REPOSITORY}</span>
          ) : null}
          {drawn(TASK_PROPERTY.CREATOR) ? (
            <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
          ) : null}
          {drawn(TASK_PROPERTY.AGENTS) ? <TaskWorkMark task={task} /> : null}
          {drawn(TASK_PROPERTY.UPDATED) ? (
            <RelativeTime at={taskTime(task, TASK_ORDER.UPDATED)} now={now} />
          ) : null}
        </span>
      }
      onPress={onOpen}
    />
  );
}

/** The List: the listed workspace's tasks under their pins, sections, and the grouping chosen. */
function TasksList({
  tasks,
  frame,
}: {
  tasks: TasksControl;
  frame: TasksViewFrame;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const { filter, display } = frame;
  const directory = useMemberDirectory();
  const now = useMinute();
  const { waiting } = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const waitingOn = new Map(waiting.map((each) => [each.taskId, each.items.length]));
  const listed = tasks.listed.tasks;
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    (task) => ({ position: task.pinPosition, at: task.pinnedAt ?? 0 }),
  ).map((task) => task.id);
  const creatorName = (creatorId: string | null) => creatorWords(creatorId, directory, listed);
  const groups = tasksListGroups(listed, {
    filter,
    display,
    pinned,
    sections: listSections(tasks),
    readerId: tasks.me,
    creatorName,
  });
  const creatorMark = (creatorId: string) => {
    const named = listed.find((task) => (task.createdBy?.userId ?? task.ownerId) === creatorId);
    return (
      <ActorMark
        actor={creatorActor(named ?? { ownerId: creatorId }, directory, undefined)}
        size={ACTOR_SIZE.MARK}
      />
    );
  };
  const repositories = groups.flatMap((group) =>
    group.head.kind === TASKS_GROUP.REPOSITORY ? [{ repository: group.head.repository }] : [],
  );
  const workspaceName = tasks.workspace?.name ?? "";
  const drawGroup = (group: TasksGroup) => {
    const { icon, name } = groupHead(group.head, tasks, repositories, creatorName, creatorMark);
    return (
      <section className="tasks-list-group" aria-label={name}>
        {/* Note that one run of every task, grouped by nothing, needs no head of its own. */}
        {group.head.kind === TASKS_GROUP.ALL ? null : (
          <h2 className="tasks-list-head">
            {icon}
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
              {name}
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
              {group.tasks.length}
            </Text>
          </h2>
        )}
        {group.tasks.length === 0 ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            No tasks
          </Text>
        ) : (
          <List label={name}>
            {group.tasks.map((task) => (
              <TaskListRow
                key={task.id}
                task={task}
                workspaceName={workspaceName}
                waiting={waitingOn.get(task.id) ?? 0}
                now={now}
                properties={display.properties}
                onOpen={() => tasks.onSelect(task.id)}
              />
            ))}
          </List>
        )}
      </section>
    );
  };
  const pins = groups.find((group) => group.head.kind === TASKS_GROUP.PINNED);
  const sections = groups.flatMap((group) =>
    group.head.kind === TASKS_GROUP.SECTION ? [{ sectionId: group.head.sectionId, group }] : [],
  );
  const valued = groups.flatMap((group) => {
    const value = groupValue(group.head);
    return value === undefined ? [] : [{ value, group }];
  });
  const unvalued = groups.find(
    (group) =>
      group.head.kind === TASKS_GROUP.ALL ||
      (group.head.kind === TASKS_GROUP.REPOSITORY && group.head.repository === null) ||
      (group.head.kind === TASKS_GROUP.CREATOR && group.head.creatorId === null),
  );
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      width={PAGE_WIDTH.FULL}
      label={TASKS}
      toolbar={frame.toolbar}
      filters={frame.chips}
      state={listState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={<EmptyState icon={<ListTodoIcon />}>No tasks yet</EmptyState>}
      error={
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      <div className="tasks-list">
        {groups.length === 0 ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {NONE_STANDING}
          </Text>
        ) : null}
        {/* Note that each run of groups is keyed by the value its groups stand for, the pins and the run of every task by their place alone. */}
        {pins === undefined ? null : drawGroup(pins)}
        {sections.map(({ sectionId, group }) => (
          <Fragment key={sectionId}>{drawGroup(group)}</Fragment>
        ))}
        {valued.map(({ value, group }) => (
          <Fragment key={value}>{drawGroup(group)}</Fragment>
        ))}
        {unvalued === undefined ? null : drawGroup(unvalued)}
      </div>
    </CollectionPage>
  );
}
