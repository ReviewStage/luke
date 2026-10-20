import { inPinOrder } from "@luke/features/pin-order";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BADGE_TONE,
  Badge,
  CHIP_LOOK,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  Chip,
  ChipName,
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
import {
  TASK_ORDER,
  TASKS_LIST_GROUP,
  TASKS_LIST_SHOWN_STATUSES,
  TASKS_LIST_STATUS_ORDER,
  type TasksListGroup,
  type TasksListSection,
  tasksListGroups,
  taskTime,
  toggledStatus,
} from "@luke/ui/task-list-model";
import { sectionOrder, workspaceSections } from "@luke/ui/task-sections-model";
import { Schema } from "effect";
import { FolderIcon, ListTodoIcon, PinIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import type { ShellRoom } from "../shell-room.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { useMinute } from "../tasks/task-time.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useExperiment } from "../use-app-state.js";
import { readKept, writeKept } from "./folded-groups.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { TaskStatusMark as TaskWorkMark } from "./task-card.js";
import { TasksBoard } from "./tasks-board.js";

/**
 * tasks-page.tsx -- the window's Tasks page, while the account has the inbox-first sidebar on: the listed workspace's tasks as a List or as the Board, chosen by a switch beside its title.
 *
 * With the experiment on, the sidebar is the Inbox, and the task list it
 * held stands here instead, in the plan's place, where the Board stood: the
 * Board's own sidebar row opens it, named Tasks, and its way out is the
 * Board's (`EXIT_BOARD`), so Back, Escape, and the window's history go on
 * treating it as the Board's place. Which view it shows is kept on this Mac.
 *
 * The List runs the pinned tasks first, then each of the account's sections
 * while it keeps them, then the rest under their status, the work under way
 * first (`tasksListGroups`). A row is the task's priority, key, and status
 * before its name, and at its end how many Inbox threads of it wait on the
 * reader, its repository, its creator's face, what an agent is doing on it,
 * and when it last moved. A press opens the task. Its status filter is its
 * own, kept on this Mac, and leaves only the settled out at first.
 */

/** What the page is called, on its toolbar and to a screen reader. */
const TASKS = "Tasks";

/** The page's two views. */
export const TASKS_VIEW = {
  LIST: "list",
  BOARD: "board",
} as const;

export type TasksView = (typeof TASKS_VIEW)[keyof typeof TASKS_VIEW];

/** Where the view shown last, and the List's status filter, are kept in the renderer's storage. */
const VIEW_KEY = "luke.tasksPageView";
const STATUSES_KEY = "luke.tasksListStatuses";

const storedView = Schema.fromJsonString(Schema.Literals(Object.values(TASKS_VIEW)));
const storedStatuses = Schema.fromJsonString(
  Schema.Array(Schema.Literals(Object.values(TASK_STATUS))),
);

/** What the page is read as while the tasks are. */
const READING_LINE = "Reading tasks";

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = "Your tasks could not be read.";

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

/** The Tasks page, in the plan's place: the List or the Board, as the reader last chose. */
export function TasksPage({
  tasks,
  room,
}: {
  tasks: TasksControl;
  room: ShellRoom;
}): React.JSX.Element {
  const [view, setView] = useState(() => readKept(VIEW_KEY, storedView, TASKS_VIEW.LIST));
  const choose = (next: TasksView) => {
    setView(next);
    writeKept(VIEW_KEY, storedView, next);
  };
  const switcher = <ViewSwitch view={view} onView={choose} />;
  return view === TASKS_VIEW.BOARD ? (
    <TasksBoard tasks={tasks} room={room} title={TASKS} switcher={switcher} />
  ) : (
    <TasksList tasks={tasks} switcher={switcher} />
  );
}

/** The account's sections in the listed workspace, each with its tasks' ids in its own order; none while it keeps no sections. */
function listSections(tasks: TasksControl, shown: boolean): readonly TasksListSection[] {
  const workspaceId = tasks.workspace?.id;
  if (!shown || workspaceId === undefined) return [];
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
function groupHead(group: TasksListGroup, tasks: TasksControl): GroupHead {
  switch (group.kind) {
    case TASKS_LIST_GROUP.PINNED:
      return { icon: <PinIcon />, name: PINNED };
    case TASKS_LIST_GROUP.SECTION: {
      const section = tasks.taskSections.sections.find((each) => each.id === group.sectionId);
      return {
        icon: sectionGlyph(section?.icon) ?? <FolderIcon />,
        name: section?.title ?? "",
      };
    }
    case TASKS_LIST_GROUP.STATUS:
      return {
        icon: <TaskStatusMark status={group.status} />,
        name: TASK_STATUS_WORDS[group.status],
      };
  }
}

/** One task's row: its priority, key, and status before its name, and at its end what waits on the reader, its repository, its creator, its work, and its time. */
function TaskListRow({
  task,
  workspaceName,
  waiting,
  now,
  onOpen,
}: {
  task: TaskSummary;
  workspaceName: string;
  /** How many of its Inbox threads wait on the reader. */
  waiting: number;
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  return (
    <ListRow
      leading={
        <span className="tasks-list-lead">
          {task.priority === undefined ? null : <TaskPriorityMark priority={task.priority} />}
          <span className="tasks-list-key">
            {task.number === undefined ? null : taskKey(workspaceName, task.number)}
          </span>
          {task.status === undefined ? null : <TaskStatusMark status={task.status} />}
        </span>
      }
      title={task.name}
      meta={
        <span className="home-row-meta">
          {waiting === 0 ? null : (
            <Badge tone={BADGE_TONE.ATTENTION}>
              {`${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`}
            </Badge>
          )}
          <span className="home-row-context">{task.repository ?? "No repository"}</span>
          <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
          <TaskWorkMark task={task} />
          <RelativeTime at={taskTime(task, TASK_ORDER.UPDATED)} now={now} />
        </span>
      }
      onPress={onOpen}
    />
  );
}

/** The List: the listed workspace's tasks under their pins, sections, and statuses. */
function TasksList({
  tasks,
  switcher,
}: {
  tasks: TasksControl;
  switcher: ReactNode;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const [statuses, setStatuses] = useState<readonly TaskStatus[]>(() =>
    readKept(STATUSES_KEY, storedStatuses, TASKS_LIST_SHOWN_STATUSES),
  );
  const sectionsOn = useExperiment(EXPERIMENT.SECTIONS);
  const now = useMinute();
  const { waiting } = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const waitingOn = new Map(waiting.map((each) => [each.taskId, each.items.length]));
  const listed = tasks.listed.tasks;
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    (task) => ({ position: task.pinPosition, at: task.pinnedAt ?? 0 }),
  ).map((task) => task.id);
  const groups = tasksListGroups(listed, {
    pinned,
    sections: listSections(tasks, sectionsOn),
    statuses,
  });
  const workspaceName = tasks.workspace?.name ?? "";
  const toggle = (status: TaskStatus) => {
    const next = toggledStatus(statuses, status);
    setStatuses(next);
    writeKept(STATUSES_KEY, storedStatuses, next);
  };
  const toolbar = (
    <header className="desktop-toolbar">
      <div className="desktop-toolbar-heading">
        <h1 className="desktop-toolbar-title">{TASKS}</h1>
        {switcher}
      </div>
      <div className="desktop-toolbar-actions">
        {TASKS_LIST_STATUS_ORDER.map((status) => (
          <Chip
            key={status}
            look={CHIP_LOOK.FILTER}
            aria-pressed={statuses.includes(status)}
            onClick={() => toggle(status)}
          >
            <TaskStatusMark status={status} />
            <ChipName>{TASK_STATUS_WORDS[status]}</ChipName>
          </Chip>
        ))}
      </div>
    </header>
  );
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      width={PAGE_WIDTH.FULL}
      label={TASKS}
      toolbar={toolbar}
      state={listState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={<EmptyState icon={<ListTodoIcon />}>No tasks yet</EmptyState>}
      error={
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
        <div className="tasks-list">
          {groups.length === 0 ? (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              No tasks in the statuses shown
            </Text>
          ) : null}
          {groups.map((group) => {
            const { icon, name } = groupHead(group, tasks);
            const key =
              group.kind === TASKS_LIST_GROUP.SECTION
                ? group.sectionId
                : group.kind === TASKS_LIST_GROUP.STATUS
                  ? group.status
                  : group.kind;
            return (
              <section key={key} className="tasks-list-group" aria-label={name}>
                <h2 className="tasks-list-head">
                  {icon}
                  <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
                    {name}
                  </Text>
                  <Text
                    as={TEXT_ELEMENT.SPAN}
                    variant={TEXT_VARIANT.CAPTION}
                    tone={TEXT_TONE.SUBTLE}
                  >
                    {group.tasks.length}
                  </Text>
                </h2>
                <List label={name}>
                  {group.tasks.map((task) => (
                    <TaskListRow
                      key={task.id}
                      task={task}
                      workspaceName={workspaceName}
                      waiting={waitingOn.get(task.id) ?? 0}
                      now={now}
                      onOpen={() => tasks.onSelect(task.id)}
                    />
                  ))}
                </List>
              </section>
            );
          })}
        </div>
      </MemberDirectory>
    </CollectionPage>
  );
}
