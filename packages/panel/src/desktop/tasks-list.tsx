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
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskStanding,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  countWords,
  noneYetWords,
  REFRESH_FAILED_WORDS,
  readFailedWords,
  readingWords,
  TERM,
} from "@luke/features/words";
import { taskKey } from "@luke/features/workspace-key";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ANNOUNCE,
  AVATAR_SIZE,
  BUTTON_SIZE,
  CARD_PRESS_SELECTOR,
  CardPress,
  CHIP_LOOK,
  COLLECTION_STATE,
  CollectionPage,
  type CollectionState,
  cssCustomProperties,
  EmptyState,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GAP,
  GLYPH_INK,
  GlyphSlot,
  GROUP_HEAD,
  GROUP_ROWS,
  GROUP_SURFACE,
  GroupHeader,
  InlineEdit,
  joinRefs,
  LAYOUT_ELEMENT,
  ListMotion,
  motionKey,
  motionRows,
  OneLine,
  PAGE_FRAME,
  PAGE_WIDTH,
  type SelectionAct,
  SelectionBar,
  SelectionRegion,
  Stack,
  selectionMenu,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  useLeaving,
  useMinute,
  useRovingKeys,
  useRowMenu,
  VisuallyHidden,
} from "@luke/ui";
import { actorName, creatorActor } from "@luke/ui/actor-model";
import { FolderXIcon, GLYPH, ICON_SIZE, ListTodoIcon, PinIcon, UserXIcon } from "@luke/ui/icons";
import { repositoryLabel, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import {
  isAgentEntry,
  placeAllWrites,
  placeWrites,
  restoreWrites,
  sectionEntries,
  sectionOrder,
  sectionTaskIds,
  unplaceAllWrites,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { RENAME_FAILED_NOTE, TASK_MARK } from "@luke/ui/tasks-model";
import {
  COMPLETED_WINDOW,
  LIST_FOLD_ORDER,
  listPropertiesFitting,
  TASK_PROPERTY,
  TASK_PROPERTY_ORDER,
  TASKS_GROUP,
  TASKS_GROUPING,
  type TaskProperty,
  type TasksGroup,
  type TasksGroupHead,
  type TasksSection,
  taskIdOf,
  tasksListGroups,
} from "@luke/ui/tasks-page-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { Schema } from "effect";
import { type ReactNode, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { FIND_SKIP_ATTRIBUTE } from "../find-matches.js";
import { useMemberDirectory } from "../member-directory.js";
import { RepositoryPicture } from "../repository-picture.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { newTaskAction } from "../tasks/inbox-list.js";
import { useSettledWaiting } from "../tasks/inbox-settling.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
  TaskKey,
} from "../tasks/task-standing.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { undoToast, useToast } from "../toast.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { keptKey, useKept } from "../use-kept.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { rowMenu } from "./action-menu.js";
import { GroupNewTaskButton } from "./new-task-button.js";
import { sectionGlyph } from "./section-icon-picker.js";
import { groupCount, sidebarFold } from "./sidebar-fold.js";
import { useTaskMenuItems } from "./task-actions.js";
import {
  AssigneeChip,
  CreatorFace,
  PriorityChip,
  StatusChip,
  statusOf,
  TaskWorkMarks,
  useStandingDoor,
  WaitingBadge,
} from "./task-row-parts.js";
import {
  assigneeFor,
  assigneeWords,
  creatorWords,
  NO_CREATOR,
  NO_REPOSITORY,
  OlderCompleted,
  type TasksViewFrame,
} from "./tasks-page-options.js";
import { useHeldTasks } from "./use-held-tasks.js";
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
 * draws one (`repository-picture.tsx`), its assignee's face, or the dashed
 * unassigned mark, its creator's face, what its agents are doing
 * and the pull request they opened, when it last moved, and its ⋯, each
 * where the view draws it, so each column lines up down the whole page
 * whatever any one row holds.
 *
 * A row is changed where it stands, as a Board card is
 * (`task-row-parts.tsx`): its priority, status, and assignee are chips
 * dropping the menu that changes them, and the task's own menu, whose Rename makes
 * its name its field, which its ⋯, shown while the row is in hand, a right-click, and
 * the menu key open alike (`useRowMenu`). A press anywhere else on the row opens the
 * task. The row hangs no card for the whole task, which would say what its columns
 * already do; its parts hang their own instead (`task-part-cards.tsx`): its assignee's
 * face and its creator's hang theirs, a pull request's mark the pull request, the
 * count after it those it counts, and the working mark the task's agents.
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
 * squeezed (`listPropertiesFitting`).
 *
 * Rows are chosen together as a Mac's list chooses them (`SelectionRegion`):
 * ⌘-click one in or out, ⇧-click a run, ⇧↑↓ grow it, ⌘A every row drawn,
 * and Esc none, across every group, while a plain press still opens the
 * task. While any is chosen, a bar floating at the foot of the page acts on
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

/** What the selection bar's acts say. */
const SELECTION_ACT = {
  MARK_DONE: "Mark done",
  SET_STATUS: "Set status",
  MOVE_TO_SECTION: "Move to section",
  NO_SECTION: "Remove from section",
} as const;

/** What a press must land on to carry a row: its press, which reaches every edge of the row but its chips and its ⋯. */
const ROW_HANDLE = CARD_PRESS_SELECTOR;

/** The drop zone Pinned is, the zone of the run of every task, and No assignee's; a section's is its id, a status's or a priority's its value, and an assignee's their account id. */
const DROP_ZONE = {
  PINNED: "pinned",
  ALL: "all",
  NO_ASSIGNEE: "no-assignee",
} as const;

/** How wide each column of the grid stands, by the property it draws: its content's own, the repository's held to a short name's. */
const COLUMN_WIDTH = {
  [TASK_PROPERTY.PRIORITY]: "auto",
  [TASK_PROPERTY.KEY]: "auto",
  [TASK_PROPERTY.STATUS]: "auto",
  [TASK_PROPERTY.WAITING]: "auto",
  [TASK_PROPERTY.REPOSITORY]: "fit-content(22ch)",
  [TASK_PROPERTY.ASSIGNEE]: "auto",
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
    assignee: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
    creator: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
  }),
);

type ListFolds = typeof storedFolds.Type;

/** The List's folded groups, kept on this Mac. */
const KEPT = {
  FOLDS: keptKey("luke.tasksListFolds", storedFolds),
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

/** What heads a group of the List: its glyph and its name. */
interface GroupHead {
  readonly icon: ReactNode;
  readonly name: string;
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
        ? { icon: <FolderXIcon />, name: NO_REPOSITORY }
        : {
            icon: (
              <RepositoryPicture
                repository={head.repository}
                pictures={tasks.repositories.pictures}
                size={AVATAR_SIZE.GLYPH}
              />
            ),
            name: repositoryLabel(head.repository, repositories),
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

/** What the toast says once tasks were moved into the section titled, or out of every section where there is none. */
function movedNote(count: number, title: string | null): string {
  if (title === null) {
    return count === 1
      ? "Removed from its section"
      : `${countWords(count, TERM.TASK)} removed from their sections`;
  }
  return count === 1 ? `Moved to ${title}` : `${countWords(count, TERM.TASK)} moved to ${title}`;
}

/**
 * Moves tasks into a section, on top of it in their order, or out of every
 * section where `sectionId` is null, and answers with one toast whose Undo
 * puts each back in the section it stood in, under the rows it stood under,
 * or in none. A task already where it is sent is left as it stands, and the
 * Undo leaves one moved again since where it was moved, reading the tab as
 * it stands when Undo is pressed (`latest`).
 */
function moveToSection(
  tasks: TasksControl,
  latest: () => TasksControl,
  taskIds: readonly string[],
  sectionId: string | null,
  toast: (notice: ReturnType<typeof undoToast>) => void,
): void {
  const before = tasks.taskSections;
  const entries = sectionEntries(before);
  const moving = taskIds.filter((taskId) => (entries.get(taskId)?.sectionId ?? null) !== sectionId);
  if (moving.length === 0) return;
  const members = moving.map((id) => ({ agent: false, id }));
  tasks.onWriteSections(
    sectionId === null
      ? unplaceAllWrites(members)
      : placeAllWrites(before, members, sectionId, Date.now()),
  );
  const title =
    sectionId === null
      ? null
      : (before.sections.find((section) => section.id === sectionId)?.title ?? "");
  const undo = () => {
    const now = latest();
    const writes = restoreWrites(before, now.taskSections, members, sectionId, Date.now());
    if (writes.length > 0) now.onWriteSections(writes);
  };
  toast(undoToast(movedNote(moving.length, title), undo));
}

/** A section's entries for the tasks its group draws, in its own order; its agents, which the List draws not, left out. */
function drawnEntries(tasks: TasksControl, group: TasksGroup, sectionId: string) {
  const drawn = new Set(group.tasks.map((task) => task.id));
  return sectionOrder(tasks.taskSections, sectionId).flatMap((entry) =>
    !isAgentEntry(entry) && drawn.has(entry.taskId) ? [entry] : [],
  );
}

/** What a group's drag does: its rows moved within it, where it keeps an order, and a row let go over another group's zone. */
interface ListDrops {
  readonly move: (group: TasksGroup) => ((from: number, to: number) => void) | undefined;
  readonly dropOut: (group: TasksGroup, from: number, zone: string, at: number) => void;
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
      return (from: number, to: number) =>
        tasks.onMovePins(pinMoves(pinPositionsForMove(group.tasks, from, to, pinPlaceOf)));
    }
    if (head.kind === TASKS_GROUP.SECTION) {
      return (from: number, to: number) => {
        const entries = drawnEntries(tasks, group, head.sectionId);
        const entry = entries[from];
        if (entry === undefined) return;
        const member = { agent: false, id: entry.taskId };
        tasks.onWriteSections(placeWrites(entries, member, head.sectionId, to, Date.now()));
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
    // Note that a row put back is pinned anew, so it is placed as a new pin dropped at its place among every pin of the workspace, the filter's hidden ones too, any neighbour its new pin instant would cross given a position, as a row dragged into Pinned is; and kept in its section under the rows it stood under.
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
 * One task's row: its press, which reaches every edge of the row under its
 * controls, opens the task; then, each in its own column where the view draws it, the chips that
 * change its priority and its status, its key, what waits on the reader,
 * its repository, the chip that changes its assignee, empty where its group
 * already says who, its creator's face, its agents' work, when it last
 * moved, and its ⋯. Renamed from its menu, its name is its field until the edit
 * ends. Chosen among several, its ⋯, right-click, and menu key offer the
 * selection bar's acts on every task chosen, as a Mac's list does; one not
 * chosen keeps its own menu.
 */
function TaskListRow({
  tasks,
  task,
  workspaceName,
  repositoryName,
  waiting,
  now,
  properties,
  assigneeHeld,
  chosen,
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
  /** Whether its group's head says who it is assigned to, so its own assignee's cell stands empty. */
  assigneeHeld: boolean;
  /** The selection it stands in, where it is one of several chosen: how many, and what the bar does to them all. */
  chosen: ChosenTasks | undefined;
  onOpen: () => void;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const maker = useTaskMaker(task);
  const reads = useReadMarks();
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread: reads.markedUnread(task.id),
  });
  const press = useRef<HTMLButtonElement | null>(null);
  const nameId = useId();
  const own = { ...rowMenu("Task", actions.groups(), tasks.shown), footer: actions.footer };
  const menu = useRowMenu(
    rename.editing
      ? undefined
      : chosen === undefined
        ? own
        : {
            thing: own.thing,
            groups: selectionMenu(chosen.acts),
            heading: countWords(chosen.count, TERM.TASK),
            shown: tasks.shown,
          },
    { disabled: actions.deletion.busy, opener: press },
  );
  const endedByKey = useRefocusAfterEdit(rename.editing, press);
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
      className="tasks-list-row"
      data-task-id={task.id}
      {...motionKey(task.id)}
      {...menu.props}
      data-editing={rename.editing ? "true" : undefined}
    >
      <span className="tasks-list-cell" data-cell="name">
        {rename.editing ? (
          <span className="tasks-list-press">
            <InlineEdit
              value={rename.asked ?? task.name}
              label="Task name"
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              editing
              onEnd={(edit) => {
                endedByKey(edit.byKey);
                void rename.end(edit.value);
              }}
            />
          </span>
        ) : (
          <CardPress
            ref={press}
            disabled={actions.deletion.busy}
            selectKey={task.id}
            roving
            onPress={() => {
              menu.close(false);
              onOpen();
            }}
          >
            <span id={nameId} className="tasks-list-press">
              <OneLine>{task.name}</OneLine>
              {spoken === "" ? null : (
                <VisuallyHidden {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>{spoken}</VisuallyHidden>
              )}
            </span>
          </CardPress>
        )}
        {rename.refused ? <span className="tasks-list-note">{RENAME_FAILED_NOTE}</span> : null}
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
            <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.MEDIUM}>
              <FolderXIcon />
            </GlyphSlot>
          ) : (
            <RepositoryPicture
              repository={task.repository}
              pictures={tasks.repositories.pictures}
              fallback={
                <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.MEDIUM}>
                  <GLYPH.REPOSITORY />
                </GlyphSlot>
              }
            />
          )}
          <OneLine>{repositoryName}</OneLine>
        </>,
      )}
      {cell(
        TASK_PROPERTY.ASSIGNEE,
        assigneeHeld ? null : (
          <AssigneeChip task={task} look={CHIP_LOOK.TOOLBAR} onStanding={onStanding} />
        ),
      )}
      {/* Note that a task Luke or an agent made names its maker before their square, the member it was made for worn on it, as every task surface does. */}
      {cell(
        TASK_PROPERTY.CREATOR,
        <>
          {maker === undefined ? null : (
            <Text
              as={TEXT_ELEMENT.SPAN}
              variant={TEXT_VARIANT.INHERIT}
              truncate
              className="tasks-list-maker"
            >
              {actorName(maker.actor)}
            </Text>
          )}
          <CreatorFace task={task} onOpen={onOpen} />
        </>,
      )}
      {cell(
        TASK_PROPERTY.AGENTS,
        <TaskWorkMarks task={task} tasks={tasks} most={1} steady onOpen={onOpen} />,
      )}
      {cell(
        TASK_PROPERTY.UPDATED,
        <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />,
      )}
      <span className="tasks-list-cell" data-cell="more">
        {menu.more({ size: BUTTON_SIZE.COMPACT, describedBy: nameId })}
      </span>
      {menu.popup}
      {actions.dialog}
    </li>
  );
}

/**
 * One group: its head, a press that folds and opens it, its glyph, name,
 * and count, and the + that starts a task in it; and its rows, or a line saying it holds none. The group is a
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
  newTask,
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
  /** The + at the head's end that starts a task in the group, where it stands for something a task can start in. */
  newTask: ReactNode;
  /** Draws a task's row. */
  row: (task: TaskSummary) => ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(group.tasks, taskIdOf);
  const move = folded ? undefined : drops.move(group);
  const drag = useRowDrag(move, {
    handle: ROW_HANDLE,
    onDropOut: (from, zone, at) => drops.dropOut(group, from, zone, at),
  });
  const zone = zoneOf(group.head);
  const titled = group.head.kind !== TASKS_GROUP.ALL;
  const rows =
    drawn.length === 0 ? (
      group.older === undefined ? (
        <Text
          variant={TEXT_VARIANT.CAPTION}
          tone={TEXT_TONE.MUTED}
          className="tasks-list-group-empty"
        >
          {draggable && ordered(group.head) ? DRAG_HERE : NO_TASKS}
        </Text>
      ) : null
    ) : (
      <Stack
        as={LAYOUT_ELEMENT.UL}
        gap={GAP.NONE}
        moves
        className="tasks-list-rows"
        aria-label={head.name}
        data-row-drop-rows={ordered(group.head) ? "" : undefined}
        onPointerDown={draggable ? drag : undefined}
      >
        {drawn.map(({ value }) => row(value))}
      </Stack>
    );
  const body = (
    <>
      {rows}
      <OlderCompleted older={group.older} onShow={onShowOlder} />
    </>
  );
  return (
    <section
      className="tasks-list-group"
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
          fold={sidebarFold(folded, onToggle)}
          count={groupCount(group.tasks.length)}
          surface={GROUP_SURFACE.WIDE}
          head={GROUP_HEAD.STICKS}
          rows={GROUP_ROWS.SUBGRID}
          actions={newTask}
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

/** A selection of several tasks as a chosen row's menu reads it: how many, and the bar's acts on them all. */
interface ChosenTasks {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

/**
 * What the selection bar offers the tasks chosen: Mark done; Set status,
 * each status by its mark; and, while the account keeps sections in the
 * workspace, Move to section, each by its glyph, and out of every section.
 * Each acts on them all at once, then lets the selection go.
 */
function selectionActs(
  tasks: TasksControl,
  latest: () => TasksControl,
  taskIds: readonly string[],
  toast: (notice: ReturnType<typeof undoToast>) => void,
  onActed: () => void,
): SelectionAct[] {
  const acted = (act: () => void) => () => {
    act();
    onActed();
  };
  const setStatus = SELECTION_ACT.SET_STATUS;
  const statuses = TASK_STATUS_ORDER.map((status) => ({
    label: TASK_STATUS_WORDS[status],
    icon: <TaskStatusMark status={status} />,
    onSelect: acted(() => tasks.onSettleTasks(taskIds, status)),
  }));
  const workspaceId = tasks.workspace?.id;
  const sections =
    workspaceId === undefined ? [] : workspaceSections(tasks.taskSections, workspaceId);
  const move = (sectionId: string | null) =>
    acted(() => moveToSection(tasks, latest, taskIds, sectionId, toast));
  const sectionMenu = [
    sections.map((section) => ({
      label: section.title,
      icon: sectionGlyph(section.icon) ?? <GLYPH.SECTION />,
      onSelect: move(section.id),
    })),
    [{ label: SELECTION_ACT.NO_SECTION, onSelect: move(null) }],
  ];
  return [
    {
      label: SELECTION_ACT.MARK_DONE,
      icon: <GLYPH.DONE />,
      onAct: acted(() => tasks.onSettleTasks(taskIds, TASK_STATUS.DONE)),
    },
    { label: setStatus, icon: <TaskStatusMark status={TASK_STATUS.TODO} />, menu: [statuses] },
    ...(sections.length === 0
      ? []
      : [{ label: SELECTION_ACT.MOVE_TO_SECTION, icon: <GLYPH.MOVE />, menu: sectionMenu }]),
  ];
}

/** The grid's columns for the properties drawn, in the order a row draws them: those before the name, the name, those after it, and the ⋯. */
function gridColumns(properties: readonly TaskProperty[]): string {
  const drawn = TASK_PROPERTY_ORDER.filter((property) => properties.includes(property));
  const width = (property: TaskProperty) => COLUMN_WIDTH[property];
  const before = drawn.filter((property) => LEADING.includes(property)).map(width);
  const after = drawn.filter((property) => !LEADING.includes(property)).map(width);
  return [...before, "minmax(0, 1fr)", ...after, "auto"].join(" ");
}

/** Whether two runs of properties are the same, in the same order. */
function sameProperties(one: readonly TaskProperty[], other: readonly TaskProperty[]): boolean {
  return one.length === other.length && one.every((property, at) => property === other[at]);
}

/**
 * The properties the List draws of those its display chose, at its own
 * width rather than the window's: those `listPropertiesFitting` folds away
 * for the room the list stands in, measured as it resizes, and on a phone
 * every property that folds. Only what is folded is state, never the width,
 * so a window being dragged draws the rows again only where a column comes
 * or goes. Note that the first measure lands before the list paints, so no
 * row is ever drawn with its name squeezed first, and that a list not laid
 * out yet, which measures nothing, folds nothing.
 */
function useFittedProperties(
  list: HTMLElement | null,
  properties: readonly TaskProperty[],
  narrow: boolean,
): readonly TaskProperty[] {
  const [folded, setFolded] = useState<readonly TaskProperty[]>([]);
  useLayoutEffect(() => {
    if (list === null || narrow) return undefined;
    const measure = () => {
      const { width } = list.getBoundingClientRect();
      if (width <= 0) return;
      const fitting = listPropertiesFitting(properties, width);
      const next = properties.filter((property) => !fitting.includes(property));
      setFolded((was) => (sameProperties(was, next) ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [list, properties, narrow]);
  const left = narrow ? LIST_FOLD_ORDER : folded;
  return properties.filter((property) => !left.includes(property));
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
  const { waiting } = useSettledWaiting(tasks.listed.inbox, tasks.inboxTaskless);
  const waitingOn = new Map(waiting.map((each) => [each.taskId, each.items.length]));
  const narrow = room === SHELL_ROOM.NARROW;
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const properties = useFittedProperties(listElement, display.properties, narrow);
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
  const setStanding = useStandingDoor(tasks);
  const repositories = groups.flatMap((group) =>
    group.tasks.map((task) => ({ repository: task.repository })),
  );
  const workspaceName = tasks.workspace?.name ?? "";
  // The tab as it stands, which an Undo pressed or a refusal answered renders after its act reads.
  const latest = useRef(tasks);
  latest.current = tasks;
  const drops = listDrops(tasks, () => latest.current, groups, setStanding);
  const list = useRef<HTMLDivElement>(null);
  // The rows of every group are one Tab stop that ↑↓ walk, a folded group's passed by, as they are not drawn.
  const roving = useRovingKeys<HTMLDivElement>();
  const listRef = useMemo(() => joinRefs(list, roving.ref, setListElement), [roving.ref]);
  const toast = useToast();
  const regionId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  // Note that only rows drawn stay chosen, so a task the filter or a fold took away is never acted on.
  const drawnIds = new Set(
    groups.flatMap((group) => (folds.folded(group.head) ? [] : group.tasks.map(taskIdOf))),
  );
  const selected: ReadonlySet<string> = new Set([...chosen].filter((id) => drawnIds.has(id)));
  // Note that a row no longer drawn leaves the selection for good, so reopening its group chooses nothing anew.
  if (selected.size !== chosen.size) setChosen(selected);
  const clear = () => setChosen(new Set());
  const acts = selectionActs(tasks, () => latest.current, [...selected], toast, clear);
  // Note that a row is offered the selection's acts only among several chosen, as one chosen alone is the row's own menu already.
  const several: ChosenTasks | undefined =
    selected.size > 1 ? { count: selected.size, acts } : undefined;
  return (
    <CollectionPage
      frame={PAGE_FRAME.TOOLBAR}
      width={PAGE_WIDTH.FULL}
      label={TASKS}
      toolbar={frame.toolbar}
      scrollRef={frame.scroll}
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
        <ErrorState onRetry={tasks.onRetryList} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {UNREAD_LINE}
        </ErrorState>
      }
    >
      {/* A refresh that failed after the tasks were read leaves them drawn, with a line over them. */}
      {tasks.listFailed && listed.length > 0 ? (
        <ErrorState onRetry={tasks.onRetryList}>{REFRESH_FAILED_WORDS}</ErrorState>
      ) : null}
      <SelectionRegion id={regionId} selection={{ selected, onChange: setChosen }}>
        <ListMotion root={list}>
          <div
            {...roving}
            ref={listRef}
            className="tasks-list"
            data-row-drop-scope=""
            {...motionRows()}
            style={cssCustomProperties({ "--tasks-list-columns": gridColumns(properties) })}
          >
            {/* Note that an empty section stands as a place to drag into, so the view matches nothing where no group holds a task. */}
            {groups.every((group) => group.tasks.length === 0) ? (
              <Text
                variant={TEXT_VARIANT.CAPTION}
                tone={TEXT_TONE.MUTED}
                className="tasks-list-none"
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
                    newTask={
                      <GroupNewTaskButton tasks={tasks} head={group.head} words={named.name} />
                    }
                    row={(task) => (
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
                        assigneeHeld={
                          !narrow &&
                          group.head.kind === TASKS_GROUP.ASSIGNEE &&
                          group.head.assigneeId === (task.assignee?.userId ?? null)
                        }
                        chosen={
                          several !== undefined && selected.has(task.id) ? several : undefined
                        }
                        onOpen={() => tasks.onSelect(task.id)}
                        onStanding={(standing) => setStanding(task, standing)}
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
      <div className="tasks-list-selection">
        <SelectionBar count={selected.size} acts={acts} onClear={clear} controls={regionId} />
      </div>
    </CollectionPage>
  );
}
