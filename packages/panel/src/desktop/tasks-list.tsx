import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@luke/features/pin-order";
import { TASK_SECTION_WRITE, type TaskSectionWrite } from "@luke/features/task-section-wire";
import {
  TASK_BOUNDS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  type TaskStanding,
  type TaskSummary,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BUTTON_SIZE,
  CHIP_LOOK,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  cssCustomProperties,
  EllipsisIcon,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FoldChevronIcon,
  IconButton,
  InlineEdit,
  PAGE_FRAME,
  PAGE_WIDTH,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { actorName, creatorActor } from "@luke/ui/actor-model";
import { repositoryLabel, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import {
  placeWrites,
  sectionEntries,
  sectionOrder,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { RENAME_FAILED_NOTE, TASK_MARK } from "@luke/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  TASK_PROPERTY,
  TASK_PROPERTY_ORDER,
  TASKS_GROUP,
  type TaskProperty,
  type TasksGroup,
  type TasksGroupHead,
  type TasksSection,
  tasksListGroups,
} from "@luke/ui/tasks-page-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { Schema } from "effect";
import {
  FolderGitIcon,
  FolderIcon,
  FolderXIcon,
  ListTodoIcon,
  PinIcon,
  UserXIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { FadingWords } from "../fading-words.js";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { useMemberDirectory } from "../member-directory.js";
import { RepositoryPicture } from "../repository-picture.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import { RelativeTime } from "../tasks/relative-time.js";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS, TaskKey } from "../tasks/task-standing.js";
import { useMinute } from "../tasks/task-time.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { Tooltip } from "../tooltip.js";
import { readKept, writeKept } from "./folded-groups.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { useTaskMenu } from "./task-actions.js";
import { taskCardOf } from "./task-card.js";
import {
  PriorityChip,
  StatusChip,
  statusOf,
  TaskWorkMarks,
  useStandingDoor,
  WaitingBadge,
} from "./task-row-parts.js";
import {
  creatorWords,
  NO_CREATOR,
  NO_REPOSITORY,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { useRowDrag } from "./use-row-drag.js";

/**
 * tasks-list.tsx -- the Tasks page's List: the listed workspace's tasks under their pins, the account's sections, and the grouping chosen, each group folding under its head, each row a line of columns that stand one under another down the page, changed where it stands and dragged from group to group.
 *
 * It is one of the Tasks page's two views (`tasks-page.tsx`). It runs the
 * pinned tasks first, then each of the account's sections while it keeps
 * them, then the rest under the grouping chosen, by status from the work
 * under way at first (`tasksListGroups`). Every row of the page is a row of
 * one grid, as Linear's list stands its rows: the task's priority, key, and
 * status before its name, and after it how many Inbox threads of it wait on
 * the reader, its repository led by its owner's picture, as the sidebar
 * draws one (`repository-picture.tsx`), its creator's face, what its agents are doing
 * and the pull request they opened, when it last moved, and its ⋯, each
 * where the view draws it, so each column lines up down the whole page
 * whatever any one row holds.
 *
 * A row is changed where it stands, as a Board card is
 * (`task-row-parts.tsx`): its priority and status are chips dropping the
 * menu that changes them, and its ⋯, shown while the row is in hand, and a
 * right-click drop the task's own menu, whose Rename makes its name its
 * field. A press anywhere else on the row opens the task, and resting on it
 * hangs the task's card beside it, as its sidebar row does (`task-card.tsx`).
 *
 * A group's head folds it, kept on this Mac (`LIST_FOLDS_KEY`), its count
 * standing beside its name either way. A row is dragged by its press
 * (`use-row-drag.ts`): within Pinned or a section to a new place there; onto
 * another status's or priority's group, which sends it that status or
 * priority as the Board's columns do; onto Pinned, which pins it; and onto a
 * section, which keeps it there. As in the sidebar, a task stands in one
 * place, so a row dragged out of Pinned is unpinned and one dragged out of
 * a section leaves it. A group of a repository or of a creator takes no
 * drop, since a drag cannot say either. A phone's List has no room for
 * most columns beside a name, nor a drag beside its scrolling,
 * so it draws only a row's chips, its name, and its time, its rows changed
 * by their chips and menus, the rest on its card.
 */

/** What the page is called, to a screen reader. */
const TASKS = "Tasks";

/** What the page is read as while the tasks are. */
const READING_LINE = "Reading tasks";

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = "Your tasks could not be read.";

/** What the List says where the filter and the view leave no task standing. */
const NONE_STANDING = "No tasks match this view";

/** What a group with no task says, and a section with none where rows are dragged into it, as the sidebar's says. */
const NO_TASKS = "No tasks";
const DRAG_HERE = "Drag tasks here";

/** What a group of pinned tasks is called. */
const PINNED = "Pinned";

/** What a press must land on to carry a row: its press, which reaches every edge of the row but its chips and its ⋯. */
const ROW_HANDLE = ".tasks-list-press";

/** Where the folded groups are kept in the renderer's storage. */
const LIST_FOLDS_KEY = "luke.tasksListFolds";

/** The properties a phone's List has no room for beside a name: all but the chips and the time. */
const NARROW_LEFT_OUT: readonly TaskProperty[] = [
  TASK_PROPERTY.KEY,
  TASK_PROPERTY.WAITING,
  TASK_PROPERTY.REPOSITORY,
  TASK_PROPERTY.CREATOR,
  TASK_PROPERTY.AGENTS,
];

/** The drop zone Pinned is, and the zone of the run of every task; a section's is its id, and a status's or a priority's its value. */
const DROP_ZONE = {
  PINNED: "pinned",
  ALL: "all",
} as const;

/** How wide each column of the grid stands, by the property it draws: its content's own, the repository's held to a short name's. */
const COLUMN_WIDTH = {
  [TASK_PROPERTY.PRIORITY]: "auto",
  [TASK_PROPERTY.KEY]: "auto",
  [TASK_PROPERTY.STATUS]: "auto",
  [TASK_PROPERTY.WAITING]: "auto",
  [TASK_PROPERTY.REPOSITORY]: "fit-content(22ch)",
  [TASK_PROPERTY.CREATOR]: "auto",
  [TASK_PROPERTY.AGENTS]: "auto",
  [TASK_PROPERTY.UPDATED]: "auto",
} as const satisfies Record<TaskProperty, string>;

/** The properties drawn before a row's name; the rest stand after it. */
const LEADING: readonly TaskProperty[] = [
  TASK_PROPERTY.PRIORITY,
  TASK_PROPERTY.KEY,
  TASK_PROPERTY.STATUS,
];

/** The groups folded, each kind by the values its groups stand for; absent where none is. */
const storedFolds = Schema.fromJsonString(
  Schema.Struct({
    pinned: Schema.optionalKey(Schema.Boolean),
    sections: Schema.optionalKey(Schema.Array(Schema.String)),
    status: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_STATUS_ORDER))),
    priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
    repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  }),
);

type ListFolds = typeof storedFolds.Type;

/** A set of folded values with one folded or opened. */
function flipped<T>(held: readonly T[] | undefined, value: T): readonly T[] {
  const kept = held ?? [];
  return kept.includes(value) ? kept.filter((each) => each !== value) : [...kept, value];
}

/** Whether a group is folded; the run of every task has no head to fold it by. */
function foldedIn(folds: ListFolds, head: TasksGroupHead): boolean {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return folds.pinned === true;
    case TASKS_GROUP.SECTION:
      return folds.sections?.includes(head.sectionId) === true;
    case TASKS_GROUP.STATUS:
      return folds.status?.includes(head.status) === true;
    case TASKS_GROUP.PRIORITY:
      return folds.priority?.includes(head.priority) === true;
    case TASKS_GROUP.REPOSITORY:
      return folds.repository?.includes(head.repository) === true;
    case TASKS_GROUP.CREATOR:
      return folds.creator?.includes(head.creatorId) === true;
    case TASKS_GROUP.ALL:
      return false;
  }
}

/** The folds with a group folded or opened. */
function toggledIn(folds: ListFolds, head: TasksGroupHead): ListFolds {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return { ...folds, pinned: folds.pinned !== true };
    case TASKS_GROUP.SECTION:
      return { ...folds, sections: flipped(folds.sections, head.sectionId) };
    case TASKS_GROUP.STATUS:
      return { ...folds, status: flipped(folds.status, head.status) };
    case TASKS_GROUP.PRIORITY:
      return { ...folds, priority: flipped(folds.priority, head.priority) };
    case TASKS_GROUP.REPOSITORY:
      return { ...folds, repository: flipped(folds.repository, head.repository) };
    case TASKS_GROUP.CREATOR:
      return { ...folds, creator: flipped(folds.creator, head.creatorId) };
    case TASKS_GROUP.ALL:
      return folds;
  }
}

/** Which groups are folded, and the press that folds or opens one, kept on this Mac as it is pressed. */
function useListFolds(): {
  folded: (head: TasksGroupHead) => boolean;
  toggle: (head: TasksGroupHead) => void;
} {
  const [folds, setFolds] = useState<ListFolds>(() => readKept(LIST_FOLDS_KEY, storedFolds, {}));
  return {
    folded: (head) => foldedIn(folds, head),
    toggle: (head) => {
      const next = toggledIn(folds, head);
      setFolds(next);
      writeKept(LIST_FOLDS_KEY, storedFolds, next);
    },
  };
}

/** The drop zone a group is, where a row may be dropped into it: none for a repository's or a creator's. */
function zoneOf(head: TasksGroupHead): string | undefined {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return DROP_ZONE.PINNED;
    case TASKS_GROUP.SECTION:
      return head.sectionId;
    case TASKS_GROUP.STATUS:
      return head.status;
    case TASKS_GROUP.PRIORITY:
      return head.priority;
    case TASKS_GROUP.ALL:
      return DROP_ZONE.ALL;
    default:
      return undefined;
  }
}

/** Whether a group keeps an order of its own, which a drag sets: Pinned's and a section's. */
function ordered(head: TasksGroupHead): boolean {
  return head.kind === TASKS_GROUP.PINNED || head.kind === TASKS_GROUP.SECTION;
}

/** What keys a group among the List's: the value it stands for, a section by its id, and the pins and the run of every task by their kind, none of which another group's value can be. */
function groupKey(head: TasksGroupHead): string {
  switch (head.kind) {
    case TASKS_GROUP.SECTION:
      return head.sectionId;
    case TASKS_GROUP.STATUS:
      return head.status;
    case TASKS_GROUP.PRIORITY:
      return head.priority;
    case TASKS_GROUP.REPOSITORY:
      return head.repository ?? NO_REPOSITORY;
    case TASKS_GROUP.CREATOR:
      return head.creatorId ?? NO_CREATOR;
    default:
      return head.kind;
  }
}

/** What the page stands: its read, or none of the workspace's tasks. */
function listState(tasks: TasksControl, empty: boolean): CollectionState {
  if (tasks.listFailed && empty) return COLLECTION_STATE.ERROR;
  if (!tasks.listRead && !tasks.listFailed) return COLLECTION_STATE.LOADING;
  return empty ? COLLECTION_STATE.EMPTY : COLLECTION_STATE.READY;
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

/** What heads a group of the List: its glyph and its name. */
interface GroupHead {
  readonly icon: ReactNode;
  readonly name: string;
}

/** What heads a group: its glyph and its name. */
function groupHead(
  head: TasksGroupHead,
  tasks: TasksControl,
  /** Every repository a group or a row stands for, which a repository's name tells its own apart from. */
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
        : {
            icon: (
              <RepositoryPicture
                repository={head.repository}
                pictures={tasks.repositories.pictures}
                fallback={<FolderGitIcon />}
              />
            ),
            name: repositoryLabel(head.repository, repositories),
          };
    case TASKS_GROUP.CREATOR:
      return head.creatorId === null
        ? { icon: <UserXIcon />, name: NO_CREATOR }
        : { icon: creatorMark(head.creatorId), name: creatorName(head.creatorId) };
    case TASKS_GROUP.ALL:
      return { icon: null, name: TASKS };
  }
}

/** Where a pin stands among the pins: its position, and when it was pinned. */
const pinPlaceOf = (task: TaskSummary): PinPlace => ({
  position: task.pinPosition,
  at: task.pinnedAt ?? 0,
});

/** The pins' new places as the moves the account keeps. */
function pinMoves(positions: ReadonlyMap<TaskSummary, string>) {
  return [...positions].map(([task, position]) => ({ agent: false, id: task.id, position }));
}

/** The write that takes a task out of the section it is kept in; none where it is in none. */
function leaveSection(tasks: TasksControl, taskId: string): TaskSectionWrite[] {
  return sectionEntries(tasks.taskSections).has(taskId)
    ? [{ kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId: null }]
    : [];
}

/** A section's entries for the tasks its group draws, in its own order. */
function drawnEntries(tasks: TasksControl, group: TasksGroup, sectionId: string) {
  const drawn = new Set(group.tasks.map((task) => task.id));
  return sectionOrder(tasks.taskSections, sectionId).filter((entry) => drawn.has(entry.taskId));
}

/** What a group's drag does: its rows moved within it, where it keeps an order, and a row let go over another group's zone. */
interface ListDrops {
  readonly move: (group: TasksGroup) => ((from: number, to: number) => void) | undefined;
  readonly dropOut: (group: TasksGroup, from: number, zone: string, at: number) => void;
}

/**
 * The List's drag: a row moved within Pinned or a section stands there at
 * its new place; let go over another group, it is pinned there, kept in
 * that section, or sent that group's status or priority, and leaves Pinned
 * or its section where it came from one, as the sidebar keeps a task in one
 * place.
 */
function listDrops(
  tasks: TasksControl,
  groups: readonly TasksGroup[],
  setStanding: (task: TaskSummary, standing: TaskStanding, onKept?: () => void) => void,
): ListDrops {
  const pins = groups.find((group) => group.head.kind === TASKS_GROUP.PINNED)?.tasks ?? [];
  const move = (group: TasksGroup) => {
    const { head } = group;
    if (head.kind === TASKS_GROUP.PINNED) {
      return (from: number, to: number) =>
        tasks.onMovePins(pinMoves(pinPositionsForMove(group.tasks, from, to, pinPlaceOf)));
    }
    if (head.kind === TASKS_GROUP.SECTION) {
      return (from: number, to: number) => {
        const entries = drawnEntries(tasks, group, head.sectionId);
        const entry = entries[from];
        if (entry === undefined) return;
        tasks.onWriteSections(placeWrites(entries, entry.taskId, head.sectionId, to, Date.now()));
      };
    }
    return undefined;
  };
  const dropOut = (group: TasksGroup, from: number, zone: string, at: number) => {
    const task = group.tasks[from];
    const onto = groups.find((each) => zoneOf(each.head) === zone)?.head;
    if (task === undefined || onto === undefined) return;
    // A task stands in one place, so one carried out of Pinned is unpinned, and one carried out of its section leaves it.
    const fromPins = group.head.kind === TASKS_GROUP.PINNED;
    const leaving: TaskSectionWrite[] =
      group.head.kind === TASKS_GROUP.SECTION && onto.kind !== TASKS_GROUP.SECTION
        ? leaveSection(tasks, task.id)
        : [];
    const leave = () => {
      if (fromPins) tasks.onMarkTask(task.id, TASK_MARK.UNPIN);
      if (leaving.length > 0) tasks.onWriteSections(leaving);
    };
    switch (onto.kind) {
      case TASKS_GROUP.PINNED: {
        // Note that the task lands as one pinned now, with no place of its own yet, as the sidebar pins one dragged into Pinned.
        const { pinPosition: _position, ...rest } = task;
        const moving: TaskSummary = { ...rest, pinnedAt: Date.now() };
        leave();
        tasks.onMarkTask(task.id, TASK_MARK.PIN);
        const positions = pinPositionsForInsert(pins, moving, at, pinPlaceOf);
        tasks.onMovePins(pinMoves(positions));
        return;
      }
      case TASKS_GROUP.SECTION: {
        const target = groups.find(
          (each) =>
            each.head.kind === TASKS_GROUP.SECTION && each.head.sectionId === onto.sectionId,
        );
        const entries = target === undefined ? [] : drawnEntries(tasks, target, onto.sectionId);
        leave();
        tasks.onWriteSections(placeWrites(entries, task.id, onto.sectionId, at, Date.now()));
        return;
      }
      // Note that a row leaves Pinned or its section only once its new status or priority is kept, so a refused change leaves it where it stood.
      case TASKS_GROUP.STATUS:
        setStanding(task, { status: onto.status }, leave);
        return;
      case TASKS_GROUP.PRIORITY:
        setStanding(task, { priority: onto.priority }, leave);
        return;
      default:
        leave();
    }
  };
  return { move, dropOut };
}

/**
 * One task's row: its press, which reaches every edge of the row under its
 * controls, opens the task, and hangs its card while the pointer rests on
 * it; then, each in its own column where the view draws it, the chips that
 * change its priority and its status, its key, what waits on the reader,
 * its repository, its creator's face, its agents' work, when it last moved,
 * and its ⋯. Renamed from its menu, its name is its field until the edit
 * ends.
 */
function TaskListRow({
  tasks,
  task,
  workspaceName,
  repositoryName,
  waiting,
  now,
  properties,
  onOpen,
  onStanding,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  workspaceName: string;
  /** The task's repository as the row says it: its name alone, unless another repository the List draws shares it. */
  repositoryName: string;
  /** How many of its Inbox threads wait on the reader. */
  waiting: number;
  now: number;
  properties: readonly TaskProperty[];
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  const maker = useTaskMaker(task);
  const reads = useReadMarks();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  const actions = useTaskMenu(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: reads.markedUnread(task.id),
  });
  const item = useRef<HTMLLIElement | null>(null);
  const press = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    press.current?.focus();
  }, [rename.editing]);
  const drawn = (property: TaskProperty) => properties.includes(property);
  const key = task.number === undefined ? undefined : taskKey(workspaceName, task.number);
  // Note that the marks before the name are a control and decoration to a screen reader, so the key and status are said in the press, and left out of find, which finds them drawn.
  const spoken = [
    drawn(TASK_PROPERTY.KEY) ? key : undefined,
    drawn(TASK_PROPERTY.STATUS) ? TASK_STATUS_WORDS[statusOf(task)] : undefined,
  ]
    .filter((each) => each !== undefined)
    .map((each) => `, ${each}`)
    .join("");
  const cell = (property: TaskProperty, content: ReactNode) =>
    drawn(property) ? (
      <span className="tasks-list-cell" data-cell={property}>
        {content}
      </span>
    ) : null;
  return (
    <li
      ref={item}
      className="tasks-list-row"
      data-task-id={task.id}
      data-menu-open={actions.open ? "true" : undefined}
      data-editing={rename.editing ? "true" : undefined}
    >
      <span className="tasks-list-cell" data-cell="name">
        {rename.editing ? (
          <span className="tasks-list-press">
            <InlineEdit
              value={task.name}
              label="Task name"
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              editing
              onEnd={(edit) => {
                refocus.current = edit.byKey;
                void rename.end(edit.value);
              }}
            />
          </span>
        ) : (
          <Tooltip label={task.name} card={taskCardOf(tasks, task, now)} cardRegion={item}>
            <button
              ref={press}
              type="button"
              className="tasks-list-press"
              disabled={actions.deletion.busy}
              onClick={() => {
                actions.close(false);
                onOpen();
              }}
              onKeyDown={actions.keyMenu}
              {...actions.contextMenu(press)}
            >
              <FadingWords className="tasks-list-name" words={task.name} />
              {spoken === "" ? null : (
                <span className="visually-hidden" {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
                  {spoken}
                </span>
              )}
            </button>
          </Tooltip>
        )}
        {rename.refused ? (
          <span className="tasks-list-note" role="alert">
            {RENAME_FAILED_NOTE}
          </span>
        ) : null}
      </span>
      {/* Note that a task from a service before priorities offers No priority, as one before statuses stands under Todo. */}
      {cell(
        TASK_PROPERTY.PRIORITY,
        <PriorityChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />,
      )}
      {cell(
        TASK_PROPERTY.KEY,
        <TaskKey workspaceName={workspaceName} number={task.number} decorative />,
      )}
      {cell(
        TASK_PROPERTY.STATUS,
        <StatusChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />,
      )}
      {cell(TASK_PROPERTY.WAITING, <WaitingBadge count={waiting} />)}
      {cell(
        TASK_PROPERTY.REPOSITORY,
        <>
          {task.repository === null ? (
            <FolderXIcon className="tasks-list-repository-glyph" aria-hidden="true" />
          ) : (
            <RepositoryPicture
              repository={task.repository}
              pictures={tasks.repositories.pictures}
              fallback={
                <FolderGitIcon className="tasks-list-repository-glyph" aria-hidden="true" />
              }
            />
          )}
          <FadingWords className="tasks-list-repository" words={repositoryName} />
        </>,
      )}
      {/* Note that a task Luke or an agent made names its maker before their square, the member it was made for worn on it, as every task surface does. */}
      {cell(
        TASK_PROPERTY.CREATOR,
        <>
          {maker === undefined ? null : (
            <span className="tasks-list-maker">{actorName(maker.actor)}</span>
          )}
          <ActorMark
            actor={maker?.actor ?? creator}
            size={ACTOR_SIZE.MARK}
            forWhom={maker === undefined ? undefined : creator}
          />
        </>,
      )}
      {cell(TASK_PROPERTY.AGENTS, <TaskWorkMarks task={task} most={1} />)}
      {cell(
        TASK_PROPERTY.UPDATED,
        <RelativeTime at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />,
      )}
      <span className="tasks-list-cell" data-cell="more">
        <Tooltip label="Task actions">
          <IconButton
            icon={<EllipsisIcon />}
            label={`Actions for ${task.name}`}
            size={BUTTON_SIZE.COMPACT}
            disabled={actions.deletion.busy}
            {...actions.trigger()}
          />
        </Tooltip>
      </span>
      {actions.menu}
      {actions.dialog}
    </li>
  );
}

/**
 * One group: its head, a press that folds and opens it, its glyph, name,
 * and count; and its rows, or a line saying it holds none. The group is a
 * drop zone where a row may be let go in it, and its rows are dragged
 * within it, where it keeps an order, and out of it.
 */
function TasksListGroup({
  group,
  head,
  folded,
  onToggle,
  drops,
  draggable,
  onShowOlder,
  children,
}: {
  group: TasksGroup;
  head: GroupHead;
  folded: boolean;
  onToggle: () => void;
  drops: ListDrops;
  /** Whether its rows are dragged at all: not on a phone, whose drag is its scroll. */
  draggable: boolean;
  /** Shows every settled task, as the group's "+ N older" line asks. */
  onShowOlder: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const move = folded ? undefined : drops.move(group);
  const drag = useRowDrag(move, {
    handle: ROW_HANDLE,
    onDropOut: (from, zone, at) => drops.dropOut(group, from, zone, at),
  });
  const zone = zoneOf(group.head);
  const titled = group.head.kind !== TASKS_GROUP.ALL;
  return (
    <section
      className="tasks-list-group"
      aria-label={head.name}
      data-row-drop={draggable ? zone : undefined}
      data-folded={folded ? "true" : undefined}
    >
      {/* Note that one run of every task, grouped by nothing, needs no head of its own. */}
      {titled ? (
        <h2 className="tasks-list-head">
          <button
            type="button"
            className="tasks-list-fold"
            aria-expanded={!folded}
            onClick={onToggle}
          >
            <span className="tasks-list-chevron" aria-hidden="true">
              <FoldChevronIcon />
            </span>
            <span className="tasks-list-glyph" aria-hidden="true">
              {head.icon}
            </span>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.SECTION} truncate>
              {head.name}
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
              {group.tasks.length}
            </Text>
          </button>
        </h2>
      ) : null}
      {folded ? null : group.tasks.length === 0 ? (
        group.older === undefined ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {draggable && ordered(group.head) ? DRAG_HERE : NO_TASKS}
          </Text>
        ) : null
      ) : (
        <ul
          className="tasks-list-rows"
          aria-label={head.name}
          data-row-drop-rows={ordered(group.head) ? "" : undefined}
          onPointerDown={draggable ? drag : undefined}
        >
          {children}
        </ul>
      )}
      {folded ? null : <OlderCompleted older={group.older} onShow={onShowOlder} />}
    </section>
  );
}

/** The grid's columns for the properties drawn, in the order a row draws them: those before the name, the name, those after it, and the ⋯. */
function gridColumns(properties: readonly TaskProperty[]): string {
  const drawn = TASK_PROPERTY_ORDER.filter((property) => properties.includes(property));
  const width = (property: TaskProperty) => COLUMN_WIDTH[property];
  const before = drawn.filter((property) => LEADING.includes(property)).map(width);
  const after = drawn.filter((property) => !LEADING.includes(property)).map(width);
  return [...before, "minmax(0, 1fr)", ...after, "auto"].join(" ");
}

/** The List: the listed workspace's tasks under their pins, sections, and the grouping chosen, in one grid whose columns line up down the page. */
export function TasksList({
  tasks,
  room,
  frame,
}: {
  tasks: TasksControl;
  room: ShellRoom;
  frame: TasksViewFrame;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_BOARD, tasks.boardView.onClose);
  const { filter, display } = frame;
  const directory = useMemberDirectory();
  const now = useMinute();
  const folds = useListFolds();
  const setStanding = useStandingDoor(tasks);
  const { waiting } = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const waitingOn = new Map(waiting.map((each) => [each.taskId, each.items.length]));
  const narrow = room === SHELL_ROOM.NARROW;
  const properties = narrow
    ? display.properties.filter((property) => !NARROW_LEFT_OUT.includes(property))
    : display.properties;
  const listed = tasks.listed.tasks;
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    pinPlaceOf,
  ).map((task) => task.id);
  const creatorName = (creatorId: string | null) => creatorWords(creatorId, directory, listed);
  const groups = tasksListGroups(listed, {
    filter,
    display,
    pinned,
    sections: listSections(tasks),
    readerId: tasks.me,
    creatorName,
    now,
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
    group.tasks.map((task) => ({ repository: task.repository })),
  );
  const workspaceName = tasks.workspace?.name ?? "";
  const drops = listDrops(tasks, groups, setStanding);
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
      <div
        className="tasks-list"
        data-row-drop-scope=""
        style={cssCustomProperties({ "--tasks-list-columns": gridColumns(properties) })}
      >
        {/* Note that an empty section stands as a place to drag into, so the view matches nothing where no group holds a task. */}
        {groups.every((group) => group.tasks.length === 0) ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {NONE_STANDING}
          </Text>
        ) : null}
        {groups.map((group) => (
          <TasksListGroup
            key={groupKey(group.head)}
            group={group}
            head={groupHead(group.head, tasks, repositories, creatorName, creatorMark)}
            folded={folds.folded(group.head)}
            onToggle={() => folds.toggle(group.head)}
            drops={drops}
            draggable={!narrow}
            onShowOlder={() => frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })}
          >
            {group.tasks.map((task) => (
              <TaskListRow
                key={task.id}
                tasks={tasks}
                task={task}
                workspaceName={workspaceName}
                repositoryName={
                  task.repository === null
                    ? NO_REPOSITORY
                    : repositoryLabel(task.repository, repositories)
                }
                waiting={waitingOn.get(task.id) ?? 0}
                now={now}
                properties={properties}
                onOpen={() => tasks.onSelect(task.id)}
                onStanding={(standing) => setStanding(task, standing)}
              />
            ))}
          </TasksListGroup>
        ))}
      </div>
    </CollectionPage>
  );
}
