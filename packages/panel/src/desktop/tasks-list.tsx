import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@repo/features/pin-order";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TASK_SECTION_WRITE, type TaskSectionWrite } from "@repo/features/task-section-wire";
import { isAgentEntry } from "@repo/features/task-section-writes";
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  type TaskStanding,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  noneYetWords,
  REFRESH_FAILED_WORDS,
  readFailedWords,
  readingWords,
  TERM,
} from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  AVATAR_SIZE,
  CARD_PRESS_SELECTOR,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  cssCustomProperties,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GAP,
  GROUP_HEAD,
  GROUP_ROWS,
  GROUP_SURFACE,
  GroupHeader,
  joinRefs,
  LAYOUT_ELEMENT,
  ListMotion,
  motionKey,
  motionRows,
  NoRepositoryGlyph,
  PAGE_FRAME,
  PAGE_WIDTH,
  RepositoryPicture,
  reachedKey,
  SelectionBar,
  SelectionRegion,
  Stack,
  TaskPriorityMark,
  type TaskRowCell,
  TaskRowDraft,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  taskRowColumns,
  useLeaving,
  useMinute,
  useRovingKeys,
} from "@repo/ui";
import { actorName, creatorActor } from "@repo/ui/actor-model";
import { GLYPH, ListTodoIcon, PinIcon, UserXIcon } from "@repo/ui/icons";
import { childTaskCounts, NO_REPOSITORY, repositoryLabel } from "@repo/ui/task-list-model";
import {
  placeWrites,
  restoreWrites,
  sectionEntries,
  sectionOrder,
  sectionTaskIds,
  workspaceSections,
} from "@repo/ui/task-sections-model";
import { TASK_MARK } from "@repo/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  LIST_COLUMN,
  type ListColumn,
  TASK_PROPERTY,
  TASKS_GROUP,
  TASKS_GROUPING,
  type TasksGroup,
  type TasksGroupHead,
  type TasksSection,
  taskIdOf,
  tasksListGroups,
} from "@repo/ui/tasks-page-model";
import {
  useVirtualRuns,
  VIRTUAL_ROW_KEY_ATTRIBUTE,
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
  type VirtualRuns,
} from "@repo/ui/virtual-rows";
import { Schema } from "effect";
import {
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor } from "../steady-door.js";
import { newTaskAction } from "../tasks/inbox-list.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
} from "../tasks/task-standing.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { keptKey, useKept } from "../use-kept.js";
import { useFittedColumns } from "./fitted-columns.js";
import { groupNewTaskWords, NewTaskInButton, quickAddInto } from "./new-task-button.js";
import { useTasksWaiting } from "./places-waiting.js";
import { type DraftParts, type QuickAddLine, QuickAddLines, useQuickAdd } from "./quick-add.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { groupCount, sidebarFold } from "./sidebar-fold.js";
import { type OpenedTask, openedTaskOf, type TaskRowTab, useTaskRowTab } from "./task-actions.js";
import { TaskListRow } from "./task-list-row.js";
import { CreatorFace, useStandingDoor, WaitingBadge } from "./task-row-parts.js";
import {
  assigneeFor,
  assigneeWords,
  creatorWords,
  NO_CREATOR,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { type ChosenTasks, useTasksSelection } from "./tasks-selection.js";
import { useHeldTasks } from "./use-held-tasks.js";
import { useTaskDrag } from "./use-row-drag.js";

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
 * draws one (`RepositoryPicture`), its assignee's face, or the dashed
 * unassigned mark, its creator's face, the one icon of how its agents
 * stand (`TaskAgentsMark`), when it last moved, and its ⋯, each
 * where the view draws it, so each column lines up down the whole page
 * whatever any one row holds.
 *
 * A row is changed where it stands, as a Board card is
 * (`task-row-parts.tsx`): its priority, status, and assignee are chips
 * dropping the menu that changes them, and the task's own menu, whose Rename makes
 * its name its field, which its ⋯, shown while the row is in hand, a right-click, and
 * the menu key open alike (`useRowMenu`). A press anywhere else on the row opens the
 * task. The row hangs no card for the whole task, which would say what its columns
 * already do; its assignee's face and its creator's hang their own instead.
 *
 * Each group draws only the rows near the view (`VirtualRows`), as the
 * Inbox's list does, so a long workspace's List draws as quickly as a short
 * one; every row while a find bar stands open over it, and the row holding
 * the keyboard wherever the page is scrolled. The keys, the choosing, and a
 * drag still reach the rows left undrawn, each brought in where it is
 * reached.
 *
 * A group's head folds it, kept on this Mac (`KEPT.FOLDS`), its count
 * standing beside its name either way. A row is dragged by its press
 * (`use-row-drag.ts`): within Pinned or a section to a new place there; onto
 * another status's, priority's, or assignee's group, which sends it that
 * status or priority, or assigns it to that person, No assignee's assigning
 * it to no one, as the Board's columns do; onto Pinned, which pins it; and
 * onto a section, which keeps it there. As in the sidebar, a task stands in
 * one place, so a row dragged out of Pinned is unpinned and one dragged out
 * of a section leaves it. A group of a repository or of a creator takes no
 * drop, since a drag cannot say either. A row under an assignee's group
 * leaves its own assignee's cell empty, as the group's head says it, but on
 * a phone, whose rows are changed by their chips alone. A phone's List has no room for
 * most columns beside a name, nor a drag beside its scrolling,
 * so it draws only a row's chips, its name, and its time, its rows changed
 * by their chips and menus, the rest on its card. A wider List narrowed,
 * beside a side panel or in a small window, folds those same columns away
 * by its own width, one by one in a fixed order, before its names are
 * squeezed (`fitted-columns.ts`).
 *
 * Rows are chosen together (`SelectionRegion`): by the box in a row's gutter,
 * which comes in under the pointer and stays on every row while any is
 * chosen, by X on the row in hand, and as a Mac's list chooses them, ⌘-click
 * one in or out, ⇧-click a run, ⇧↑↓ grow it, ⌘A every row of an open group, and Esc
 * none, across every group, while a plain press still opens the task. While any is chosen, a bar floating at the foot of the page acts on
 * them all at once: Mark done, Set status, and Move to section, each
 * answered by one toast whose Undo puts every task back where it stood.
 */

/** What the page is called, to a screen reader. */
const TASKS = "Tasks";

/** What the page is read as while the tasks are. */
const READING_LINE = readingWords(TERM.TASK.many);

/** What the page says where the tasks could not be read. */
const UNREAD_LINE = readFailedWords(`your ${TERM.TASK.many}`);

/** What the List says where the filter and the view leave no task standing. */
const NONE_STANDING = "No tasks match this view";

/** What a group with no task says, and a section with none where rows are dragged into it, as the sidebar's says. */
const NO_TASKS = "No tasks";
const DRAG_HERE = "Drag tasks here";

/** What a group of pinned tasks is called. */
const PINNED = "Pinned";

/** What a press must land on to carry a row: its press, which reaches every edge of the row but its chips and its ⋯. */
const ROW_HANDLE = CARD_PRESS_SELECTOR;

/** How tall a row is taken to be before it is drawn, in pixels: a control's height and its insets (`min-h-tasks-list-row`). */
const ROW_ESTIMATE_PX = 36;

/** A group's rows, and the lines its quick add draws over them: each a subgrid of the List's columns, its rows edge to edge. */
const ROWS_GRID =
  "col-span-full m-0 grid list-none grid-cols-subgrid content-start gap-x-[normal] p-0";

/** The drop zone Pinned is, the zone of the run of every task, and No assignee's; a section's is its id, a status's or a priority's its value, and an assignee's their account id. */
const DROP_ZONE = {
  PINNED: "pinned",
  ALL: "all",
  NO_ASSIGNEE: "no-assignee",
} as const;

/** The groups folded, each kind by the values its groups stand for; absent where none is. */
const storedFolds = Schema.fromJsonString(
  Schema.Struct({
    pinned: Schema.optionalKey(Schema.Boolean),
    sections: Schema.optionalKey(Schema.Array(Schema.String)),
    status: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_STATUS_ORDER))),
    priority: Schema.optionalKey(Schema.Array(Schema.Literals(TASK_PRIORITY_ORDER))),
    repository: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    assignee: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  }),
);

type ListFolds = typeof storedFolds.Type;

/** The List's folded groups, kept on this Mac. */
const KEPT = {
  FOLDS: keptKey("app.tasksListFolds", storedFolds),
} as const;

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
    case TASKS_GROUP.ASSIGNEE:
      return folds.assignee?.includes(head.assigneeId) === true;
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
    case TASKS_GROUP.ASSIGNEE:
      return { ...folds, assignee: flipped(folds.assignee, head.assigneeId) };
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
  const [folds, keep] = useKept(KEPT.FOLDS, {});
  return {
    folded: (head) => foldedIn(folds, head),
    toggle: (head) => keep(toggledIn(folds, head)),
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
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId ?? DROP_ZONE.NO_ASSIGNEE;
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
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId ?? NO_ASSIGNEE_WORDS;
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
    taskIds: sectionTaskIds(tasks.taskSections, section.id),
  }));
}

/** What heads a group of the List: its glyph, its name, and its hint where the name does not say the whole of it. */
interface GroupHead {
  readonly icon: ReactNode;
  readonly name: string;
  readonly hint?: string | undefined;
}

/** How the List names and draws the people its groups stand for: by account id, null for no one. */
interface GroupPeople {
  readonly creatorName: (creatorId: string | null) => string;
  readonly creatorMark: (creatorId: string) => ReactNode;
  readonly assigneeName: (assigneeId: string | null) => string;
  readonly assigneeMark: (assigneeId: string) => ReactNode;
}

/** What heads a group: its glyph and its name. */
function groupHead(
  head: TasksGroupHead,
  tasks: TasksControl,
  /** Every repository a group or a row stands for, which a repository's name tells its own apart from. */
  repositories: readonly { readonly repository: string | null }[],
  people: GroupPeople,
): GroupHead {
  switch (head.kind) {
    case TASKS_GROUP.PINNED:
      return { icon: <PinIcon />, name: PINNED };
    case TASKS_GROUP.SECTION: {
      const section = tasks.taskSections.sections.find((each) => each.id === head.sectionId);
      return {
        icon: sectionGlyph(section?.icon) ?? <GLYPH.SECTION />,
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
        ? { icon: <NoRepositoryGlyph />, name: NO_REPOSITORY }
        : {
            icon: (
              <RepositoryPicture
                repository={head.repository}
                pictures={tasks.repositories.pictures}
                size={AVATAR_SIZE.GLYPH}
              />
            ),
            name: repositoryLabel(head.repository, repositories),
            hint: head.repository,
          };
    case TASKS_GROUP.ASSIGNEE:
      return head.assigneeId === null
        ? { icon: <UnassignedMark size={ACTOR_SIZE.MARK} decorative />, name: NO_ASSIGNEE_WORDS }
        : {
            icon: people.assigneeMark(head.assigneeId),
            name: people.assigneeName(head.assigneeId),
          };
    case TASKS_GROUP.CREATOR:
      return head.creatorId === null
        ? { icon: <UserXIcon />, name: NO_CREATOR }
        : { icon: people.creatorMark(head.creatorId), name: people.creatorName(head.creatorId) };
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

/** A section's entries for the tasks its group draws, in its own order; its agents, which the List draws not, left out. */
function drawnEntries(tasks: TasksControl, group: TasksGroup, sectionId: string) {
  const drawn = new Set(group.tasks.map((task) => task.id));
  return sectionOrder(tasks.taskSections, sectionId).flatMap((entry) =>
    !isAgentEntry(entry) && drawn.has(entry.taskId) ? [entry] : [],
  );
}

/** What a group's drag does, each row heard by its task's id: its rows moved within it, where it keeps an order, and a row let go over another group's zone. */
interface ListDrops {
  readonly move: (group: TasksGroup) => ((taskId: string, to: number) => void) | undefined;
  readonly dropOut: (group: TasksGroup, taskId: string, zone: string, at: number) => void;
}

/**
 * The List's drag: a row moved within Pinned or a section stands there at
 * its new place; let go over another group, it is pinned there, kept in
 * that section, or sent that group's status, priority, or assignee, and
 * leaves Pinned or its section where it came from one, as the sidebar keeps
 * a task in one place. Each lands at once; a status, priority, or assignee
 * the service refuses goes back, and so does the row, to Pinned or its
 * section, as the tab reads when the refusal comes (`latest`).
 */
function listDrops(
  tasks: TasksControl,
  latest: () => TasksControl,
  groups: readonly TasksGroup[],
  setStanding: (task: TaskSummary, standing: TaskStanding, onRefused?: () => void) => void,
): ListDrops {
  const pins = groups.find((group) => group.head.kind === TASKS_GROUP.PINNED)?.tasks ?? [];
  const move = (group: TasksGroup) => {
    const { head } = group;
    if (head.kind === TASKS_GROUP.PINNED) {
      return (taskId: string, to: number) => {
        const from = group.tasks.findIndex((each) => each.id === taskId);
        if (from < 0) return;
        tasks.onMovePins(pinMoves(pinPositionsForMove(group.tasks, from, to, pinPlaceOf)));
      };
    }
    if (head.kind === TASKS_GROUP.SECTION) {
      return (taskId: string, to: number) => {
        const entries = drawnEntries(tasks, group, head.sectionId);
        const entry = entries.find((each) => each.taskId === taskId);
        if (entry === undefined) return;
        const member = { agent: false, id: entry.taskId };
        tasks.onWriteSections(placeWrites(entries, member, head.sectionId, to, Date.now()));
      };
    }
    return undefined;
  };
  const dropOut = (group: TasksGroup, taskId: string, zone: string, at: number) => {
    const task = group.tasks.find((each) => each.id === taskId);
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
    // Note that a row put back is pinned anew, so it is placed as a new pin dropped at its place among every pin of the workspace, the filter's hidden ones too, any neighbor its new pin instant would cross given a position, as a row dragged into Pinned is; and kept in its section under the rows it stood under.
    const before = tasks.taskSections;
    const allPins = inPinOrder(
      tasks.listed.tasks.filter((each) => each.pinnedAt !== undefined),
      pinPlaceOf,
    );
    const back = () => {
      const now = latest();
      if (fromPins) {
        const others = allPins.filter((each) => each.id !== task.id);
        const at = allPins.findIndex((each) => each.id === task.id);
        const { pinPosition: _position, ...rest } = task;
        const again: TaskSummary = { ...rest, pinnedAt: Date.now() };
        now.onMarkTask(task.id, TASK_MARK.PIN);
        now.onMovePins(pinMoves(pinPositionsForInsert(others, again, at, pinPlaceOf)));
      }
      if (leaving.length === 0) return;
      const member = { agent: false, id: task.id };
      const writes = restoreWrites(before, now.taskSections, [member], null, Date.now());
      if (writes.length > 0) now.onWriteSections(writes);
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
        const member = { agent: false, id: task.id };
        tasks.onWriteSections(placeWrites(entries, member, onto.sectionId, at, Date.now()));
        return;
      }
      case TASKS_GROUP.STATUS:
        leave();
        setStanding(task, { status: onto.status }, back);
        return;
      case TASKS_GROUP.PRIORITY:
        leave();
        setStanding(task, { priority: onto.priority }, back);
        return;
      case TASKS_GROUP.ASSIGNEE:
        leave();
        setStanding(task, { assigneeId: onto.assigneeId }, back);
        return;
      default:
        leave();
    }
  };
  return { move, dropOut };
}

/**
 * One task's row on the page (`task-list-row.tsx`), and the cells only the
 * page draws, each in its own column where the view draws it: what waits on
 * the reader, and its creator's face, its maker named before it. Note
 * that it is held while what it is handed stands (`memo`), each prop a plain
 * value or a steady door, so a change to one task draws its row alone, and
 * the minute moves only its time.
 */
const TasksPageRow = memo(function TasksPageRow({
  tasks,
  task,
  opened,
  workspaceName,
  repositoryName,
  waiting,
  properties,
  assigneeHeld,
  subTasksFinished,
  subTasksTotal,
  chosen,
  more,
  onSelect,
  onStanding,
  place,
}: {
  tasks: TaskRowTab;
  task: TaskSummary;
  /** The task the window has open, where it is this one (`openedTaskOf`). */
  opened: OpenedTask | undefined;
  workspaceName: string;
  /** The task's repository as the row says it: its name alone, unless another repository the List draws shares it. */
  repositoryName: string;
  /** How many of its questions wait on the reader, as the Inbox counts them (`useTasksWaiting`). */
  waiting: number;
  properties: readonly TaskRowCell[];
  /** Whether its group's head says who it is assigned to, so its own assignee's cell stands empty. */
  assigneeHeld: boolean;
  /** How many of its sub-tasks are finished, of all of them, `subTasksTotal`; none where it has none. */
  subTasksFinished: number;
  subTasksTotal: number;
  /** The selection it stands in, where it is one of several chosen: how many, and what the bar does to them all. */
  chosen: ChosenTasks | undefined;
  /** Whether it draws its menu's ⋯, which a finger's List leaves out. */
  more: boolean;
  /** Opens a task by its id. */
  onSelect: (taskId: string) => void;
  onStanding: (task: TaskSummary, standing: TaskStanding) => void;
  /** Where it stands in its group's run of rows (`VirtualRows`). */
  place: VirtualRowPlace;
}): React.JSX.Element {
  const maker = useTaskMaker(task);
  const onOpen = () => onSelect(task.id);
  return (
    <TaskListRow
      tasks={tasks}
      task={task}
      opened={opened}
      workspaceName={workspaceName}
      cells={properties}
      repositoryName={repositoryName}
      assigneeHeld={assigneeHeld}
      subTasks={
        subTasksTotal === 0 ? undefined : { finished: subTasksFinished, total: subTasksTotal }
      }
      chosen={chosen}
      more={more}
      place={place}
      onOpen={onOpen}
      onStanding={(standing) => onStanding(task, standing)}
      content={{
        [TASK_PROPERTY.WAITING]: <WaitingBadge count={waiting} />,
        // Note that a task the app or an agent made names its maker before their square, the member it was made for worn on it, as every task surface does.
        [TASK_PROPERTY.CREATOR]: (
          <>
            {maker === undefined ? null : (
              <Text
                as={TEXT_ELEMENT.SPAN}
                variant={TEXT_VARIANT.INHERIT}
                truncate
                className="tasks-list-maker max-w-tasks-list-maker"
              >
                {actorName(maker.actor)}
              </Text>
            )}
            <CreatorFace task={task} onOpen={onOpen} />
          </>
        ),
      }}
    />
  );
});

/** The chips a quick add's draft draws in the cells of the properties the List draws, by the property each says. */
const DRAFT_CELLS = [TASK_PROPERTY.PRIORITY, TASK_PROPERTY.STATUS, TASK_PROPERTY.ASSIGNEE] as const;

/** The draft's chip for a property, where it has one. */
function draftChip(draft: DraftParts, property: TaskRowCell): ReactNode {
  if (property === TASK_PROPERTY.PRIORITY) return draft.priority;
  if (property === TASK_PROPERTY.STATUS) return draft.status;
  if (property === TASK_PROPERTY.ASSIGNEE) return draft.assignee;
  return null;
}

/**
 * A List group's quick add line: a row of the list's own cells, raised as a
 * card off the page as a Board's draft is, so it reads as one being written, the draft's
 * chips in the cells of its priority, status, and assignee and its bare
 * title in the name's, so it reads as the row it is about to be; a chip
 * whose column the List does not draw stands after the title, so each
 * stays in reach. An add still out stands as its row, its name muted, and
 * why one was refused in the name's cell.
 */
function listQuickAddLine(properties: readonly TaskRowCell[]): QuickAddLine {
  return ({ draft, pending, refused }) => (
    <TaskRowDraft
      cells={properties}
      content={
        draft === undefined
          ? {}
          : Object.fromEntries(
              DRAFT_CELLS.map((property) => [property, draftChip(draft, property)]),
            )
      }
      name={
        <>
          {draft?.title ?? pending}
          {draft === undefined
            ? null
            : DRAFT_CELLS.filter((property) => !properties.includes(property)).map((property) => (
                <Fragment key={property}>{draftChip(draft, property)}</Fragment>
              ))}
        </>
      }
      note={refused}
      drafting={draft !== undefined}
      pending={pending !== undefined}
    />
  );
}

/**
 * Where the List's runs of rows stand: the page's scroller they stand in,
 * the List's grid, whose resizing moves the runs below a group that grew or
 * folded, whether a find bar stands open, which draws every row so the find
 * covers them, and where each run is held while it stands, so a row out of
 * view can be brought in.
 */
interface ListRunsPlace {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly list: RefObject<HTMLElement | null>;
  readonly finding: boolean;
  readonly holdRun: VirtualRuns["hold"];
}

/**
 * One group: its head, a press that folds and opens it, its glyph, name,
 * and count, and the + that adds a task in it in place (`quick-add.tsx`),
 * its lines standing over the rows; and its rows, drawing only those near
 * the view (`VirtualRows`), or a line saying it holds none. The group is a
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
  tasks,
  properties,
  place,
  row,
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
  tasks: TasksControl;
  /** The cells the rows draw, which a quick add's line stands its own on. */
  properties: readonly TaskRowCell[];
  place: ListRunsPlace;
  /** Draws a task's row, wearing its place in the run. */
  row: (task: TaskSummary, at: VirtualRowPlace) => ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(group.tasks, taskIdOf);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const run = useRef<VirtualRowsHandle>(null);
  const { holdRun } = place;
  useLayoutEffect(() => holdRun(run), [holdRun]);
  const move = folded ? undefined : drops.move(group);
  const drag = useTaskDrag(move, {
    handle: ROW_HANDLE,
    onDropOut: (taskId, zone, at) => drops.dropOut(group, taskId, zone, at),
  });
  const zone = zoneOf(group.head);
  const titled = group.head.kind !== TASKS_GROUP.ALL;
  const into = quickAddInto(group.head);
  const quick = useQuickAdd(tasks, into ?? {});
  const adding = quick.shown;
  // A folded group opens as its + asks, so the draft stands in sight.
  const add = () => {
    if (folded) onToggle();
    quick.open();
  };
  const rows =
    drawn.length === 0 && !adding ? (
      group.older === undefined ? (
        <Text
          variant={TEXT_VARIANT.CAPTION}
          tone={TEXT_TONE.MUTED}
          className="tasks-list-group-empty px-row-inset py-tight-gap"
        >
          {draggable && ordered(group.head) ? DRAG_HERE : NO_TASKS}
        </Text>
      ) : null
    ) : (
      <>
        {/* Note that the quick add's lines stand in a list of their own, over the run, because a run draws only its rows. */}
        {adding ? (
          <Stack
            as={LAYOUT_ELEMENT.UL}
            gap={GAP.NONE}
            moves
            className={`tasks-list-adds ${ROWS_GRID}`}
          >
            <QuickAddLines quick={quick} line={listQuickAddLine(properties)} />
          </Stack>
        ) : null}
        {drawn.length === 0 ? null : (
          <VirtualRows
            scroller={place.scroller}
            shiftedBy={place.list}
            keys={keys}
            estimate={ROW_ESTIMATE_PX}
            overscan={place.finding ? keys.length : undefined}
            anchor={VIRTUAL_ROWS_ANCHOR.START}
            listItems
            moves
            holdsFocus
            className={`tasks-list-rows ${ROWS_GRID} data-[dragging=true]:cursor-grabbing`}
            aria-label={head.name}
            data-row-drop-rows={ordered(group.head) ? "" : undefined}
            onPointerDown={draggable ? drag : undefined}
            handle={run}
          >
            {(index, at) => {
              const entry = drawn[index];
              return entry === undefined ? null : row(entry.value, at);
            }}
          </VirtualRows>
        )}
      </>
    );
  const body = (
    <>
      {rows}
      <OlderCompleted older={group.older} onShow={onShowOlder} />
    </>
  );
  return (
    <section
      className="tasks-list-group col-span-full grid grid-cols-subgrid content-start gap-y-list-gap rounded-ui-10 transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit data-leaving:grid-cols-tasks-list data-leaving:gap-x-block-gap data-[drop-target=true]:bg-muted [&>:not(.tasks-list-rows)]:col-span-full"
      aria-label={head.name}
      {...motionKey(groupKey(group.head))}
      data-row-drop={draggable ? zone : undefined}
      data-folded={folded ? "true" : undefined}
    >
      {/* Note that one run of every task, grouped by nothing, needs no head of its own, and no fold. */}
      {titled ? (
        <GroupHeader
          label={head.name}
          glyph={head.icon}
          tooltip={head.hint === head.name ? undefined : head.hint}
          fold={sidebarFold(folded, onToggle)}
          count={groupCount(group.tasks.length)}
          surface={GROUP_SURFACE.WIDE}
          head={GROUP_HEAD.STICKS}
          rows={GROUP_ROWS.SUBGRID}
          actions={
            into === undefined || !tasks.signedIn ? undefined : (
              <NewTaskInButton label={groupNewTaskWords(group.head, head.name)} onPress={add} />
            )
          }
        >
          {body}
        </GroupHeader>
      ) : (
        body
      )}
    </section>
  );
}

/** The List's groups, each drawn on after its last task left it, or the filter took it away, until its exit has played (`ListMotion`); kept while the grouping stands, so changing it swaps every group at once. */
function LeavingTasksGroups({
  groups,
  group,
}: {
  groups: readonly TasksGroup[];
  group: (group: TasksGroup) => ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(groups, (each) => groupKey(each.head));
  return <>{drawn.map(({ value }) => group(value))}</>;
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
  const waitingOn = useTasksWaiting(tasks);
  const narrow = room === SHELL_ROOM.NARROW;
  // Note that a finger's rows draw no ⋯, as a phone's mail list draws none, so their names keep the room: a long press opens a row's menu.
  const more = !useCoarsePointer();
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const subTaskCounts = useMemo(() => childTaskCounts(tasks.listed.tasks), [tasks.listed.tasks]);
  // The columns its display chose, and the sub-tasks' count beside them where any task has sub-tasks, folded for its own width (`fitted-columns.ts`).
  const chosen = useMemo(
    () =>
      subTaskCounts.size > 0 ? [...display.properties, LIST_COLUMN.SUB_TASKS] : display.properties,
    [display.properties, subTaskCounts.size],
  );
  const properties = useFittedColumns<ListColumn>(listElement, chosen, { narrow });
  const listed = tasks.listed.tasks;
  const pinned = inPinOrder(
    listed.filter((task) => task.pinnedAt !== undefined),
    pinPlaceOf,
  ).map((task) => task.id);
  const people: GroupPeople = {
    creatorName: (creatorId) => creatorWords(creatorId, directory, listed),
    creatorMark: (creatorId) => {
      const named = listed.find((task) => (task.createdBy?.userId ?? task.ownerId) === creatorId);
      return (
        <ActorMark
          actor={creatorActor(named ?? { ownerId: creatorId }, directory, undefined)}
          size={ACTOR_SIZE.MARK}
        />
      );
    },
    assigneeName: (assigneeId) => assigneeWords(assigneeId, directory, listed),
    assigneeMark: (assigneeId) => (
      <ActorMark actor={assigneeFor(assigneeId, directory, listed)} size={ACTOR_SIZE.MARK} />
    ),
  };
  // While the page is shown each task keeps the group and the place it was first drawn in, so one a teammate's change would move stays under the reader's eye.
  const groups = useHeldTasks(
    tasks,
    { workspaceId: tasks.workspace?.id, filter, display },
    (standing) =>
      tasksListGroups(standing, {
        filter,
        display,
        pinned,
        sections: listSections(tasks),
        readerId: tasks.me,
        personName:
          display.grouping === TASKS_GROUPING.ASSIGNEE ? people.assigneeName : people.creatorName,
        members: (directory.members ?? []).map((member) => member.userId),
        now,
      }),
  );
  // Note that every door a row is handed stands across draws, so a row held while what it is handed does (`memo`) holds.
  const setStanding = useSteadyDoor(useStandingDoor(tasks));
  const rowTab = useTaskRowTab(tasks);
  const { region, agents } = tasks;
  const opened = useMemo(() => openedTaskOf({ region, agents }), [region, agents]);
  const repositories = groups.flatMap((group) =>
    group.tasks.map((task) => ({ repository: task.repository })),
  );
  const workspaceName = tasks.workspace?.name ?? "";
  // The tab as it stands, which an Undo pressed or a refusal answered renders after its act reads.
  const latest = useRef(tasks);
  latest.current = tasks;
  const drops = listDrops(tasks, () => latest.current, groups, setStanding);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const scrollRef = useMemo(() => joinRefs(scroller, frame.scroll), [frame.scroll]);
  // Every open group's tasks, in the order drawn down the page, those its run leaves undrawn among them; a folded group's are not drawn.
  const order = groups.flatMap((group) =>
    folds.folded(group.head) ? [] : group.tasks.map(taskIdOf),
  );
  const runs = useVirtualRuns();
  // Note that the runs draw only the rows near the view, and every row while a find bar stands open over the page.
  const finding = useFindOpen();
  const runsPlace = useMemo(
    (): ListRunsPlace => ({ scroller, list, finding, holdRun: runs.hold }),
    [finding, runs.hold],
  );
  const pressIn = (row: Element | null | undefined) =>
    row?.querySelector<HTMLElement>(ROW_HANDLE) ?? undefined;
  // The rows of every group are one Tab stop that ↑↓ walk, a folded group's passed by, as they are not drawn; a key
  // reaching past the rows drawn goes on to the List's own first or last row, or the one after or before, brought in where it is not drawn.
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const inHand = from?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`);
      const id = reachedKey(
        order,
        inHand?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE) ?? undefined,
        to,
      );
      if (id === undefined) return false;
      const press = pressIn(
        list.current?.querySelector(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}="${CSS.escape(id)}"]`),
      );
      if (press !== undefined) {
        press.focus();
        return true;
      }
      return runs.bringIn(id, (row) => pressIn(row)?.focus());
    },
  });
  const listRef = useMemo(() => joinRefs(list, roving.ref, setListElement), [roving.ref]);
  // Note that only rows an open group lists stay chosen, so a task the filter or a fold took away is never acted on.
  const selection = useTasksSelection(tasks, new Set(order));
  const { regionId, selected } = selection;
  // Note that the motion is handed what lays the rows out, so a draw that moved none measures none; a fold tells it of its own (`useListMotionReplay`).
  const laidOut = useMemo(() => ({ groups, properties }), [groups, properties]);
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      width={PAGE_WIDTH.FULL}
      label={TASKS}
      toolbar={frame.toolbar}
      scrollRef={scrollRef}
      filters={frame.chips}
      state={listState(tasks, listed.length === 0)}
      loadingLabel={READING_LINE}
      empty={
        <EmptyState
          icon={<ListTodoIcon />}
          action={newTaskAction(tasks.signedIn ? tasks.onNewTask : undefined)}
        >
          {noneYetWords(TERM.TASK)}
        </EmptyState>
      }
      error={
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.TASKS_READ)}
          onRetry={tasks.onRetryList}
          placement={ERROR_STATE_PLACEMENT.CENTERED}
        >
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      {/* A refresh that failed after the tasks were read leaves them drawn, with a line over them. */}
      {tasks.listFailed && listed.length > 0 ? (
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.TASKS_REFRESH)}
          onRetry={tasks.onRetryList}
        >
          {REFRESH_FAILED_WORDS}
        </ErrorState>
      ) : null}
      <SelectionRegion
        id={regionId}
        selection={{ selected, onChange: selection.onChange }}
        order={[order]}
        bringIn={runs.bringIn}
      >
        <ListMotion root={list} change={laidOut}>
          <div
            {...roving}
            ref={listRef}
            className="tasks-list grid grid-cols-tasks-list gap-x-block-gap gap-y-section-gap pb-ui-24"
            data-row-drop-scope=""
            {...motionRows()}
            style={cssCustomProperties({
              "--tasks-list-columns": taskRowColumns(properties, more),
            })}
          >
            {/* Note that an empty section stands as a place to drag into, so the view matches nothing where no group holds a task. */}
            {groups.every((group) => group.tasks.length === 0) ? (
              <Text
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                className="tasks-list-none col-span-full"
              >
                {NONE_STANDING}
              </Text>
            ) : null}
            <LeavingTasksGroups
              key={display.grouping}
              groups={groups}
              group={(group) => {
                const named = groupHead(group.head, tasks, repositories, people);
                return (
                  <TasksListGroup
                    key={groupKey(group.head)}
                    group={group}
                    head={named}
                    folded={folds.folded(group.head)}
                    onToggle={() => folds.toggle(group.head)}
                    drops={drops}
                    draggable={!narrow}
                    onShowOlder={() =>
                      frame.onDisplay({ ...display, completed: COMPLETED_WINDOW.ALL })
                    }
                    tasks={tasks}
                    properties={properties}
                    place={runsPlace}
                    row={(task, at) => (
                      <TasksPageRow
                        key={task.id}
                        place={at}
                        tasks={rowTab}
                        task={task}
                        opened={opened?.task.id === task.id ? opened : undefined}
                        workspaceName={workspaceName}
                        repositoryName={
                          task.repository === null
                            ? NO_REPOSITORY
                            : repositoryLabel(task.repository, repositories)
                        }
                        waiting={waitingOn.get(task.id) ?? 0}
                        properties={properties}
                        assigneeHeld={
                          !narrow &&
                          group.head.kind === TASKS_GROUP.ASSIGNEE &&
                          group.head.assigneeId === (task.assignee?.userId ?? null)
                        }
                        subTasksFinished={subTaskCounts.get(task.id)?.finished ?? 0}
                        subTasksTotal={subTaskCounts.get(task.id)?.total ?? 0}
                        chosen={selection.chosenOf(task.id)}
                        more={more}
                        onSelect={tasks.onSelect}
                        onStanding={setStanding}
                      />
                    )}
                  />
                );
              }}
            />
          </div>
        </ListMotion>
      </SelectionRegion>
      {/* Note that the bar floats at the page's foot rather than over the rows, so choosing a row moves none under the pointer. */}
      <div className="tasks-list-selection pointer-events-none sticky bottom-ui-16 z-4 flex justify-center *:pointer-events-auto">
        <SelectionBar
          count={selected.size}
          acts={selection.acts}
          onClear={selection.onClear}
          controls={regionId}
        />
      </div>
      {selection.dialog}
    </CollectionPage>
  );
}
