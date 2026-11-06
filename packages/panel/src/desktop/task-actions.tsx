import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  DESCRIPTION_ACTOR,
  TASK_BOUNDS,
  TASK_PRIORITY_ORDER,
  type Task,
  type TaskSummary,
} from "@repo/features/task-wire";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import {
  ANNOUNCE,
  BLOCKED_WORDS,
  BlockedMark,
  BUTTON_SIZE,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  IconButton,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  type ListRowFold,
  type ListRowNest,
  type MenuRow,
  nextRowOrHead,
  OneLine,
  ProgressCount,
  RowHint,
  RowHintOptions,
  TIME_LOOK,
  Time,
  Tooltip,
  useConfirmDialog,
  useMinute,
  VisuallyHidden,
} from "@repo/ui";
import { type AssigneeFace, accountActor, assigneeFace, creatorActor } from "@repo/ui/actor-model";
import { confirmAsked } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { type ChildTaskCount, repositoryLabel } from "@repo/ui/task-list-model";
import {
  DOCUMENT_REGION,
  RENAME_FAILED_NOTE,
  SETTLED_STATUS,
  settleOffered,
  TASK_MARK,
  type TaskMark,
} from "@repo/ui/tasks-model";
import { useInlineRename } from "@repo/ui/use-inline-rename";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActorRef, AssigneeFaceHeard, AssigneeFaceMark } from "../actor-ref.js";
import { FOCUSED_OFFER, useAppCommand } from "../app-commands.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import {
  COMMAND_PLACE,
  commandAction,
  commandWords,
  PANEL_COMMAND,
  type PanelCommand,
} from "../command-items.js";
import { useDescriptionDrafted } from "../composer-drafts.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { useCopyToast } from "../copy-feedback.js";
import { useChordLinks } from "../copy-link-item.js";
import { leftMark } from "../draft-mark.js";
import { confirmFailure } from "../failure-report.js";
import { useMemberDirectory } from "../member-directory.js";
import { renameWrite } from "../rename-write.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import { lastEditOf } from "../tasks/description-body.js";
import { EditedBy, type EditPlace, useEditReader } from "../tasks/edit-ref.js";
import { useTaskSendFailed } from "../tasks/failed-lines.js";
import { CHOOSE_LABEL } from "../tasks/repository-chip.js";
import { PlanGlyph } from "../tasks/tab-look.js";
import {
  copyTaskLinkItem,
  markReadItem,
  type ReadMark,
  renameTaskItem,
  taskLinkPlace,
  versionHistoryItem,
} from "../tasks/task-menu-items.js";
import {
  type TaskRelationDoor,
  type TaskRelationSubject,
  taskRelationMenuPanel,
} from "../tasks/task-relation-menu.js";
import {
  NO_ASSIGNEE,
  PRIORITY_ROWS,
  TASK_STATUS_WORDS,
  useAssigneeRows,
} from "../tasks/task-standing.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useReadMark, useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import { TASK_RENAME_SHAPE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { appStateQuery, selectAccount, selectExperiment } from "../use-app-state.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuAction, type MenuEntry, type MenuSubmenu, rowMenu } from "./action-menu.js";
import { useMoveTaskDialog } from "./move-task-dialog.js";
import { useTasksWaiting } from "./places-waiting.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { moveToSectionEntry, useSectionDialogs } from "./sidebar-sections.js";
import { chipSubmenu, keyedStatusSubmenu, STANDING_WORDS } from "./standing-submenus.js";
import {
  SIDEBAR_ROW_REPOSITORY,
  SIDEBAR_ROW_TIME,
  TaskRowStatus,
  taskCardOf,
} from "./task-card.js";
import { taskSubject, useStandingDoor, WaitingCount } from "./task-row-parts.js";
import { ChosenTasksContext, chosenRowMenu } from "./tasks-selection.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

/**
 * task-actions.tsx -- one task's menu, built once (`taskActionGroups`) for the two surfaces that offer it: the Plan tab, which shows the task, from the ⋯ in the side panel's bar and the tab's right-click, and a row of the task, in the sidebar, the Tasks list, the Board, and the Recent list, from its ⋯, a right-click, and the menu key.
 *
 * Both surfaces draw the same items in the one order every menu of the
 * window keeps, Copy, then name and read, then organize, then open
 * elsewhere, and Delete last and alone, so a task in a list can be acted on
 * without being opened first. The Plan tab's is the task's document menu
 * (`TASK_MENU_SURFACE.DOCUMENT`): it leaves out the task's status, priority,
 * and assignee, because the plan draws chips for them under its title, yet
 * keeps Change repository, since the repository under the title is words
 * whose menu opens only on that ask, and its Pin is the task's own, since
 * the tab showing the task is what stands for the task in the sidebar. A
 * row's menu (`TASK_MENU_SURFACE.ROW`) keeps them where the row draws no chip
 * for them, as a sidebar row draws none: Status, Priority, and Assignee as
 * submenus listing what the chips list (`standing-submenus.tsx`), as Linear's
 * right-click has them, and Change repository. The menu is the window's own (`action-menu.tsx`), so every door
 * draws it the same way and Permanently delete can be drawn red.
 * Each item is worded, marked, and keyed as the window's one list has it
 * (`command-items.tsx`), as ⌘K offers the same command; the open task's menu
 * prints the chords of Copy description, Version history, and Permanently delete, which act on the open task, and another task's prints
 * none, as a tab's menu prints its chords for the chosen tab alone. U and P,
 * which act on the focused sidebar row and otherwise on the open task, print
 * on the open task's menu and on a sidebar row's, and S, which opens Status
 * on the focused row and otherwise the plan's status chip, prints on a sidebar
 * row's Status. Copy link prints ⇧⌘C where
 * the chord copies the same link (`copy-link-item.tsx`).
 *
 * Copy link copies the plan's address on vespin.dev, as the ⋯
 * beside the description's title does (`task-menu-items.tsx`). Mark as unread
 * draws the task's row in the unread weight until it next opens, and turns
 * to Mark as read on a task already unread. Rename edits the
 * name where the door draws it: the sidebar's row turns into a field, and
 * the Plan tab's ⋯ puts the caret in the description's own title. Version history
 * opens the description's versions over the whole window, opening the task first
 * where it is not the open one, the one item that moves it. New sub-task
 * opens New task's card for a child of the task, in its workspace and
 * repository (`new-task-composer.tsx`). Task relation hangs the add menu
 * beside the menu as its panel (`task-relation-menu.tsx`), as New task's +
 * does, so a task is related where its menu was opened, never opened
 * first, and Remove parent takes it out from under its
 * parent at once, with Undo. Pin moves the
 * task in the sidebar at once and is undone from the same menu. A pick in
 * Status sets the task there, said in a toast whose Undo puts back the
 * status it stood at, asking nothing, since no status stops an agent; a
 * pick in Priority or Assignee sets it as the row's chips do. A sidebar row
 * also offers Pin and Mark done as buttons at its end on hover, Mark done
 * running what Status's Done runs.
 * Move to workspace opens a dialog listing the account's other workspaces
 * and what the move does (`move-task-dialog.tsx`), offered on a task the
 * reader started. Move to section, beside Pin while the account
 * has sections on, puts the task in one of the reader's own sections, a new
 * one, or none (`sidebar-sections.tsx`).
 * Permanently delete cannot be undone, so choosing it asks first in a dialog
 * over the window that names the task and offers Mark done as the way to
 * keep it, whichever door it was chosen from. Under the items, pressed by nothing,
 * the menu says who created the task and who last edited it, and when.
 */

/**
 * Each task list's tasks by id, built once for each list the control hands
 * down and let go with it, so every row of a redraw finds its task at once
 * rather than walking the whole list, which made a redraw of the sidebar
 * grow with the square of its rows. Note that a list is never changed in
 * place, since a change hands down a new one, so an index never goes stale.
 */
const tasksById = new WeakMap<readonly TaskSummary[], ReadonlyMap<string, TaskSummary>>();

/** `list`'s task of `taskId`, from its index, built the first time the list is asked. */
function listedTask(list: readonly TaskSummary[], taskId: string): TaskSummary | undefined {
  let index = tasksById.get(list);
  if (index === undefined) {
    const built = new Map<string, TaskSummary>();
    // Note that the first of an id wins, as a walk of the list finds it.
    for (const task of list) if (!built.has(task.id)) built.set(task.id, task);
    index = built;
    tasksById.set(list, index);
  }
  return index.get(taskId);
}

/**
 * What a task's row and its menu read of the tab (`TasksControl`), wherever
 * the row stands: the values that move seldom, and the tab's doors. Note
 * that the tab's tasks, which a delivery moves for any one of them, are read
 * through `tasksNow` where they are used rather than handed over, so a row
 * that holds while what it is handed does (`memo`) holds as another task
 * moves, and that the compiler refuses a read of anything else.
 */
export interface TaskRowTab
  extends Pick<
    TasksControl,
    | "shown"
    | "signedIn"
    | "me"
    | "workspaces"
    | "taskSections"
    | "renameTask"
    | "onDeleteTask"
    | "deleteTask"
    | "onSettleTasks"
    | "onMarkTask"
    | "onSetTaskStanding"
    | "onSetTaskBlock"
    | "onSetTaskParent"
    | "onNewRelatedTask"
    | "onRemoveTaskParent"
    | "onChangeRepository"
    | "onMoveTask"
    | "moveTask"
    | "onWriteSections"
  > {
  /** The tab's tasks as they stand when read. */
  readonly tasksNow: () => readonly TaskSummary[];
  /** Copies the open description, as Copy description does. */
  readonly onCopyDescription: () => void;
  readonly onOpenHistory: TasksControl["history"]["onOpen"];
  /** Opens a repository's page on GitHub. */
  readonly onOpenGitHub: TasksControl["repositories"]["openGitHub"];
  /** Whether a repository is drawn by its owner's picture. */
  readonly pictures: boolean;
}

/** What a task's row reads of `tasks`, its tasks read through `tasksNow`: as `tasks` holds them unless said. */
export function taskRowTab(
  tasks: TasksControl,
  tasksNow: () => readonly TaskSummary[] = () => tasks.tasks,
): TaskRowTab {
  return {
    shown: tasks.shown,
    signedIn: tasks.signedIn,
    me: tasks.me,
    workspaces: tasks.workspaces,
    taskSections: tasks.taskSections,
    renameTask: tasks.renameTask,
    onDeleteTask: tasks.onDeleteTask,
    deleteTask: tasks.deleteTask,
    onSettleTasks: tasks.onSettleTasks,
    onMarkTask: tasks.onMarkTask,
    onSetTaskStanding: tasks.onSetTaskStanding,
    onSetTaskBlock: tasks.onSetTaskBlock,
    onSetTaskParent: tasks.onSetTaskParent,
    onNewRelatedTask: tasks.onNewRelatedTask,
    onRemoveTaskParent: tasks.onRemoveTaskParent,
    onChangeRepository: tasks.onChangeRepository,
    onMoveTask: tasks.onMoveTask,
    moveTask: tasks.moveTask,
    onWriteSections: tasks.onWriteSections,
    tasksNow,
    onCopyDescription: tasks.copy.onPress,
    onOpenHistory: tasks.history.onOpen,
    onOpenGitHub: tasks.repositories.openGitHub,
    pictures: tasks.repositories.pictures,
  };
}

/**
 * What a page's rows read of `tasks` (`taskRowTab`), handed back as the one
 * handed back last while it says the same (`useSteadyDoors`), its tasks read
 * as they stand at the moment, so a row held while what it is handed does
 * (`memo`) draws again only as something it reads moves.
 */
export function useTaskRowTab(tasks: TasksControl): TaskRowTab {
  const tasksNow = useSteadyDoor(() => tasks.tasks);
  return useSteadyDoors(taskRowTab(tasks, tasksNow));
}

/**
 * The task the window has open, as a row of it reads it: its document, and
 * its agents, which name who last edited it. A page hands it only to the
 * open task's row, so a save of the open description draws that row alone.
 */
export interface OpenedTask {
  readonly task: Task;
  readonly agents: AgentsControl;
}

/** The task `tasks` has open and its agents; none while no document is drawn. */
export function openedTaskOf(
  tasks: Pick<TasksControl, "region" | "agents">,
): OpenedTask | undefined {
  const { region } = tasks;
  return region.kind === DOCUMENT_REGION.READY
    ? { task: region.task, agents: tasks.agents }
    : undefined;
}

/** The open task where it is `taskId`; none for any other. */
function openedAs(opened: OpenedTask | undefined, taskId: string): OpenedTask | undefined {
  return opened?.task.id === taskId ? opened : undefined;
}

/** A task as the list or the open document holds it; nothing for a task neither holds. */
function rowTaskOf(
  list: readonly TaskSummary[],
  opened: OpenedTask | undefined,
  taskId: string,
): TaskSummary | undefined {
  return listedTask(list, taskId) ?? openedAs(opened, taskId)?.task;
}

/** A task as the list or the open document holds it; nothing for a task neither holds. */
export function taskOf(tasks: TasksControl, taskId: string): TaskSummary | undefined {
  return rowTaskOf(tasks.tasks, openedTaskOf(tasks), taskId);
}

/** One way a task can be moved in the sidebar or settled, as a sidebar row's buttons offer it: the list's command and what it does to this task. */
interface PlaceMark {
  key: string;
  item: PanelCommand;
  onSelect: () => void;
}

/** Pin, offered as whichever way the task is not yet: the reader's own pin of the task, which the Plan tab's menu offers as the tab's. */
function pinMark(tasks: Pick<TasksControl, "onMarkTask">, task: TaskSummary): PlaceMark {
  const marking = (mark: TaskMark) => () => tasks.onMarkTask(task.id, mark);
  return task.pinnedAt === undefined
    ? { key: TASK_MARK.PIN, item: PANEL_COMMAND.PIN_TASK, onSelect: marking(TASK_MARK.PIN) }
    : { key: TASK_MARK.UNPIN, item: PANEL_COMMAND.UNPIN_TASK, onSelect: marking(TASK_MARK.UNPIN) };
}

/** Pin, offered as whichever way the task is not yet, and Mark done, offered on a task not yet done. */
function placeMarks(tasks: TasksControl, task: TaskSummary): PlaceMark[] {
  const pin = pinMark(tasks, task);
  const done: PlaceMark = {
    key: SETTLED_STATUS.DONE,
    item: PANEL_COMMAND.MARK_TASK_DONE,
    onSelect: () => tasks.onSettleTasks([task.id], SETTLED_STATUS.DONE),
  };
  return settleOffered(task, SETTLED_STATUS.DONE) ? [pin, done] : [pin];
}

/** Pin or Unpin as the menu's item, keyed where `keyed`; nothing for a task neither the list nor the document holds. */
function pinAction(
  tasks: Pick<TasksControl, "onMarkTask">,
  task: TaskSummary | undefined,
  keyed: boolean,
): MenuAction[] {
  if (task === undefined) return [];
  const { item, onSelect } = pinMark(tasks, task);
  return [commandAction(item, onSelect, keyed)];
}

/** One of a sidebar row's buttons at its end: what it says and runs, and the chord its tooltip names, where it has one. */
export interface RowMark {
  readonly key: string;
  readonly label: string;
  readonly icon: React.JSX.Element;
  readonly onSelect: () => void;
  readonly command?: KeyedCommand | undefined;
}

/**
 * A sidebar row's buttons at its end, standing in the time's place while
 * the row is hovered or reached from the keyboard: a task's row draws its
 * Pin and Mark done here, and an agent's its Pin and Archive. They are the row's siblings
 * rather than inside it, so a press on one opens nothing, but part of the
 * row to its card, which stands while the pointer is on them and goes as
 * one is pressed (`RowHint`).
 */
export function RowMarks({
  marks,
  disabled = false,
}: {
  marks: readonly RowMark[];
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <>
      {marks.map(({ key, label, icon, onSelect, command }) => (
        <Tooltip key={key} label={label} {...(command === undefined ? undefined : { command })}>
          <IconButton
            icon={icon}
            label={label}
            size={BUTTON_SIZE.COMPACT}
            disabled={disabled}
            onClick={onSelect}
          />
        </Tooltip>
      ))}
    </>
  );
}

/** Whether the keyboard's focus is inside `element`'s box, followed as it comes and goes. */
function useFocusWithin(element: RefObject<HTMLElement | null>): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const box = element.current;
    if (box === null) return;
    const follow = () => setFocused(box.contains(document.activeElement));
    box.addEventListener("focusin", follow);
    box.addEventListener("focusout", follow);
    return () => {
      box.removeEventListener("focusin", follow);
      box.removeEventListener("focusout", follow);
    };
  }, [element]);
  return focused;
}

/**
 * U, P, and S on a sidebar row: offered while the keyboard is on the row,
 * each answering over what the open thing offers (`useAppCommand`'s `over`),
 * so the letter marks, pins, or opens the Status of the row focused rather
 * than the task or agent open; Pin none where the row offers none, as an
 * archived agent's, and S none where it has no Status, as an agent's.
 */
export function useFocusedRowKeys(
  item: RefObject<HTMLElement | null>,
  onToggleRead: () => void,
  onTogglePin: (() => void) | undefined,
  onOpenStatus?: (() => void) | undefined,
): void {
  const focused = useFocusWithin(item);
  useAppCommand(APP_COMMAND.TOGGLE_READ, focused ? onToggleRead : undefined, FOCUSED_OFFER);
  useAppCommand(APP_COMMAND.PIN, focused ? onTogglePin : undefined, FOCUSED_OFFER);
  useAppCommand(APP_COMMAND.SET_STATUS, focused ? onOpenStatus : undefined, FOCUSED_OFFER);
}

/**
 * Pin and Mark done at a task's sidebar row's end (`RowMarks`), Mark done
 * as a check where Archive's box stood. Rested on, the row hangs the task's
 * card beside it (`task-card.tsx`): its name in full, its repository, and
 * its agents and pull requests, read from the list's row. Pin runs what its
 * menu item runs and Mark done what Status's Done runs, and only the open
 * task's Pin names P, because the key pins the open task rather than the row
 * under the pointer.
 */
function SidebarTaskMarks({
  tasks,
  task,
  current,
  disabled,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  current: boolean;
  disabled: boolean;
}): React.JSX.Element {
  const marks = placeMarks(tasks, task).map(
    ({ key, item, onSelect }): RowMark => ({
      key,
      label: commandWords(item, COMMAND_PLACE.MENU),
      icon: item.icon,
      onSelect,
      command: current ? item.command : undefined,
    }),
  );
  return <RowMarks marks={marks} disabled={disabled} />;
}

/** Which standing chips a row draws beside its name: a Tasks list row's and a Board card's, as their properties show them. */
export interface StandingChips {
  status: boolean;
  priority: boolean;
  assignee: boolean;
}

/**
 * A row's Status, Priority, and Assignee submenus, each listing what the
 * plan's chip lists, the value standing checked: Status set as Mark done
 * sets it, with Undo, and Priority and Assignee as the row's chips set them.
 * None for a task from a service before statuses, which draws no chips.
 * Note that a submenu whose chip the row already draws is left out, because
 * the chip beside the name sets the same value one press away.
 */
function standingSubmenus(
  tasks: Pick<TasksControl, "onSettleTasks">,
  task: TaskSummary,
  assignees: readonly MenuRow[],
  setStanding: ReturnType<typeof useStandingDoor>,
  keyed: boolean,
  chips: StandingChips | undefined,
): MenuSubmenu[] {
  const { status, priority } = task;
  if (status === undefined || priority === undefined) return [];
  const pickPriority = (id: string) => {
    const picked = TASK_PRIORITY_ORDER.find((each) => each === id);
    if (picked !== undefined) setStanding(task, { priority: picked });
  };
  const pickAssignee = (id: string) =>
    setStanding(task, { assigneeId: id === NO_ASSIGNEE ? null : id });
  const assigned = chipSubmenu(
    STANDING_WORDS.ASSIGNEE,
    assignees,
    task.assignee?.userId ?? NO_ASSIGNEE,
    pickAssignee,
  );
  return [
    ...(chips?.status === true ? [] : [keyedStatusSubmenu(tasks, task.id, status, keyed)]),
    ...(chips?.priority === true
      ? []
      : [chipSubmenu(STANDING_WORDS.PRIORITY, PRIORITY_ROWS, priority, pickPriority)]),
    // Note that the members a task may be assigned are named by their own names, kept masked in a screen recording.
    ...(chips?.assignee === true
      ? []
      : [
          {
            ...assigned,
            // Note that a member's face draws their initial as words, so the glyph is masked with the name.
            ...(assigned.icon === undefined
              ? {}
              : { icon: <ReplayMask>{assigned.icon}</ReplayMask> }),
            items: assigned.items.map((item, at) =>
              assignees[at]?.id === NO_ASSIGNEE
                ? item
                : { ...item, replayMasked: true, icon: <ReplayMask>{item.icon}</ReplayMask> },
            ),
          },
        ]),
  ];
}

/**
 * What Task relation reads and sends through for `task`, from any row of it:
 * its own workspace's name and tasks, and the task list's doors, which act
 * on the task by its id whether or not it is the one open.
 */
function relationDoor(tasks: TaskRowTab, task: TaskSummary): TaskRelationDoor {
  return {
    workspaceName: tasks.workspaces.find((each) => each.id === task.workspaceId)?.name ?? "",
    tasks: tasks.tasksNow().filter((each) => each.workspaceId === task.workspaceId),
    onChange: (change) => tasks.onSetTaskBlock(task.id, change),
    onSetParent: tasks.onSetTaskParent,
    onNewTask: (kind) => tasks.onNewRelatedTask(task.id, kind),
  };
}

/** What a task's one Move to is called, and what it names the move out of its workspace, at the foot of its sections. */
const MOVE_TO = "Move to";
const ANOTHER_WORKSPACE = "Another workspace";

/**
 * A task's one Move to: its sections, New section, and Remove from section,
 * then Another workspace where the task may leave its workspace, so the
 * menu holds one way to move it rather than two. Where the task stands in no
 * section's menu, Move to workspace stands alone.
 */
function moveToEntries(
  section: MenuEntry | undefined,
  askMove: (() => void) | undefined,
  keyed: boolean,
): MenuEntry[] {
  if (section === undefined || !("items" in section)) {
    const lone =
      askMove === undefined ? [] : [commandAction(PANEL_COMMAND.MOVE_TO_WORKSPACE, askMove, keyed)];
    return [...(section === undefined ? [] : [section]), ...lone];
  }
  const another: MenuAction[] =
    askMove === undefined
      ? []
      : [{ label: ANOTHER_WORKSPACE, icon: <GLYPH.MOVE />, onSelect: askMove }];
  return [{ ...section, label: MOVE_TO, items: [...section.items, ...another] }];
}

/** Which surface offers a task's menu, which decides what the menu holds (`taskActionGroups`). */
export const TASK_MENU_SURFACE = {
  /** A row of the task, whose menu keeps Change repository, and Status, Priority, and Assignee but for the chips the row draws (`StandingChips`). */
  ROW: "row",
  /** The Plan tab, which shows the task under chips for its status, priority, and assignee, so its menu leaves those out, and its repository as words, so its menu keeps Change repository. */
  DOCUMENT: "document",
} as const;

export type TaskMenuSurface = (typeof TASK_MENU_SURFACE)[keyof typeof TASK_MENU_SURFACE];

/**
 * One task's actions in the groups a rule divides, offering only those that
 * apply to it now, for the surface that offers them. A row's menu holds
 * Copy link; then Rename, Version history, and Mark as unread or read; then
 * Status, Priority, and Assignee; then Task relation, the add menu as the
 * menu's panel, and Remove parent where the task has one, New sub-task being the
 * add menu's and ⌘K's; then Pin, Move to section, and Move to
 * workspace where the task may be moved; then the repository changed from
 * any row. The Plan tab's document menu leads with Copy description, since Copy
 * formats the document drawn, and holds the same but for Status, Priority,
 * and Assignee, which the plan's chips stand for. Change repository says
 * Choose a repository on a task with none, on either.
 * Permanently delete is last and alone on both. Only the open task's items
 * print their chords, since a chord acts on the open task alone.
 */
function taskActionGroups(
  tasks: TaskRowTab,
  task: TaskSummary | undefined,
  taskId: string,
  doors: {
    rename: () => void;
    askDelete: () => void;
    askMove: (() => void) | undefined;
    copy: (words: string, label: string) => void;
    /** The links ⇧⌘C copies now (`useChordLinks`). */
    chord: readonly string[];
    read: ReadMark;
    /** Whether U and P act on this task from its row: a sidebar row's, which the keys mark while it is focused. */
    rowKeys: boolean;
    /** Move to section, where the account keeps sections and the task may stand in one. */
    section: MenuEntry | undefined;
    /** Status, Priority, and Assignee as a row's submenus, where the task has them; none for a task from a service before statuses. */
    standing: readonly MenuSubmenu[];
    /** The id Task relation's search stands under while its panel is drawn. */
    relationId: string;
    /** The open task, where it is this one. */
    opened: OpenedTask | undefined;
    /** Whether the account has Descriptions on, without which there is no description to copy and no version history. */
    descriptions: boolean;
  },
  surface: TaskMenuSurface,
): MenuEntry[][] {
  const { opened, descriptions } = doors;
  const drawn = opened !== undefined;
  const copy: MenuAction[] =
    drawn && descriptions
      ? [commandAction(PANEL_COMMAND.COPY_DESCRIPTION, tasks.onCopyDescription, drawn)]
      : [];
  const link: MenuAction[] =
    task === undefined
      ? []
      : [copyTaskLinkItem(doors.copy, task, taskLinkPlace(tasks.workspaces, task), doors.chord)];
  // U and P act on the open task, and on a sidebar row's while it is focused, so both print them.
  const lettered = drawn || doors.rowKeys;
  const read: MenuAction[] = task === undefined ? [] : [markReadItem(doors.read, lettered)];
  const rename = renameTaskItem(doors.rename);
  // Note that the open task relates as the document holds it, whose blocks the list's row does not carry.
  const subject: TaskRelationSubject | undefined = opened?.task ?? task;
  const relate: MenuEntry[] =
    subject === undefined
      ? []
      : [taskRelationMenuPanel(doors.relationId, subject, () => relationDoor(tasks, subject))];
  const unparent: MenuAction[] =
    task?.parentTaskId === undefined
      ? []
      : [commandAction(PANEL_COMMAND.REMOVE_PARENT, () => tasks.onRemoveTaskParent(taskId), drawn)];
  const versions: MenuAction[] = descriptions
    ? [versionHistoryItem(() => tasks.onOpenHistory(taskId), drawn)]
    : [];
  const change = commandAction(
    PANEL_COMMAND.CHANGE_REPOSITORY,
    () => tasks.onChangeRepository(taskId),
    drawn,
  );
  // Note that both menus name the pick a task with no repository still needs, as the plan's path does.
  const repository: MenuAction =
    task !== undefined && task.repository === null ? { ...change, label: CHOOSE_LABEL } : change;
  const move = moveToEntries(doors.section, doors.askMove, drawn);
  const remove: MenuAction = {
    ...commandAction(PANEL_COMMAND.DELETE_TASK, doors.askDelete, drawn),
    danger: true,
  };
  const groups: MenuEntry[][] =
    surface === TASK_MENU_SURFACE.DOCUMENT
      ? [
          [...copy, ...link],
          [rename, ...versions, ...read],
          [...relate, ...unparent],
          [...pinAction(tasks, task, lettered), ...move],
          [repository],
          [remove],
        ]
      : [
          link,
          [rename, ...read],
          [...doors.standing],
          [...relate, ...unparent],
          [...pinAction(tasks, task, lettered), ...move],
          [remove],
        ];
  return groups.filter((group) => group.length > 0);
}

/**
 * The menu's quiet foot, as Notion, Linear, and Google Docs end a document's
 * menu: "Created by [Charles] Charles Pan · 3d ago" and "Last edited by
 * [you] you · 2h ago", each person on their face hanging their card. The
 * last editor is named only for the task the window has open, whose newest
 * revision it holds, as its "Edited by" line names them; another task is
 * said only by when it was last saved, and one nobody has saved since it
 * started says only who created it. Nothing here is a press: the menu's
 * items are.
 */
function TaskMenuFooter({
  tasks,
  task,
  opened,
}: {
  tasks: Pick<TaskRowTab, "me">;
  task: TaskSummary;
  /** The open task, where it is this one, whose newest revision names its last editor. */
  opened: OpenedTask | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const reader = useEditReader({ readerId: tasks.me });
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  const origin = useTaskMaker(task)?.actor;
  // Note that the open task's last editor is its description's, so while Descriptions is off it is said only by when the task last changed, as another task is.
  const descriptions =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true;
  const edit = opened === undefined || !descriptions ? undefined : lastEditOf(opened.task);
  const place: EditPlace = {
    reader,
    sections: opened?.task.sectionEdits ?? [],
    agents: opened === undefined ? undefined : { control: opened.agents, onOpen: undefined },
  };
  const named = edit !== undefined && edit.actor !== DESCRIPTION_ACTOR.EARLIER;
  return (
    <>
      <p className="task-menu-note actor-line m-0 flex-wrap overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)]">
        <ReplayUnmask>
          {"Created by "}
          {origin === undefined ? null : (
            <>
              <ReplayMask>
                <ActorRef actor={origin} />
              </ReplayMask>
              {" for "}
            </>
          )}
          <ReplayMask>
            <ActorRef actor={creatorActor(task, reader, you)} sentence />
          </ReplayMask>
          {" · "}
          <Time at={task.createdAt} now={now} look={TIME_LOOK.AGO} />
        </ReplayUnmask>
      </p>
      {edit === undefined && task.updatedAt <= task.createdAt ? null : (
        <p className="task-menu-note actor-line m-0 flex-wrap overflow-clip [overflow-clip-margin:var(--ui-focus-ring-room)]">
          <ReplayUnmask>
            {named ? "Last edited by " : "Last edited"}
            {edit === undefined ? null : (
              <ReplayMask>
                <EditedBy edit={edit} place={place} sentence />
              </ReplayMask>
            )}
            {" · "}
            <Time at={edit?.at ?? task.updatedAt} now={now} look={TIME_LOOK.AGO} />
          </ReplayUnmask>
        </p>
      )}
    </>
  );
}

/**
 * The question Permanently delete asks, naming the task. Deleting a task
 * removes its document and its board and clears the conversation its
 * transcript is read from, which nothing in the app brings back, so a task
 * not yet done or canceled is pointed at Mark done, which keeps
 * all of it.
 */
function deleteQuestion(name: string, settled: boolean): DialogQuestion {
  const lost = `“${name}” and its board and transcript will be deleted. ${IRREVERSIBLE_WORDS}`;
  return {
    title: "Permanently delete task?",
    body: settled ? lost : `${lost} To keep it out of the way instead, mark it done.`,
    verb: "Permanently delete task",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    bodyReplayMasked: true,
  };
}

/** Whether a task is already out of the way: done or canceled. */
function settledTask(task: TaskSummary | undefined): boolean {
  if (task === undefined) return false;
  return !settleOffered(task, SETTLED_STATUS.DONE) || !settleOffered(task, SETTLED_STATUS.CANCELED);
}

/**
 * One task's menu items and its delete question, held for whichever door
 * offers them: the sidebar's row, whose `ListRow` draws the menu itself, a
 * Tasks list row and a Board card, which draw it through `useRowMenu`, and
 * the open task's page, whose Plan tab draws the document menu from its ⋯
 * and its right-click through the tab's doors (`strip-tabs.tsx`'s
 * `DocumentMenu`) and whose phone's header draws it on its Plan view
 * (`task-pane-switcher.tsx`). Neither the items nor the
 * question outlive the tab going off screen, and the question does not
 * outlive the task: each is taken down in the render that finds it gone, so
 * neither is left standing over another surface, over a task deleted
 * elsewhere, or waiting for the next time the panel opens.
 */
export function useTaskMenuItems(
  tasks: TaskRowTab,
  taskId: string,
  name: string,
  doors: {
    rename: () => void;
    drawn: boolean;
    unread: boolean;
    /** Whether U and P act on this task from its row, a sidebar row's, so its menu prints them; none elsewhere. */
    rowKeys?: boolean;
    /** Which surface offers the items, which decides what they hold. */
    surface: TaskMenuSurface;
    /** The standing chips a row draws, whose submenus its menu leaves out; none on a sidebar row, which draws none. */
    chips?: StandingChips | undefined;
    /** The task the window has open (`openedTaskOf`), which the items read only where it is this one. */
    opened: OpenedTask | undefined;
  },
) {
  const opened = openedAs(doors.opened, taskId);
  const task = rowTaskOf(tasks.tasksNow(), opened, taskId);
  const markRead = useReadMark();
  // Note that a delete asked is drawn at once, which may take the row the question stands on with it.
  const heard = useRefusalHeard(task !== undefined && tasks.shown, {
    surface: FAILURE_SURFACE.TASK_DELETE,
    about: { taskId },
  });
  const deleting = useMutation(tasks.deleteTask);
  const deletionAct = useConfirmAct(deleting, {
    send: () => deleting.mutateAsync(taskId).then(heard),
    answered: sameAnswer,
  });
  const deletion = useConfirmDialog(
    { subject: task !== undefined, surfaceOpen: tasks.shown },
    deletionAct,
    confirmFailure(FAILURE_SURFACE.TASK_DELETE, { taskId }),
  );
  // Mark done as the chord runs it: on a task not already done, and nothing otherwise.
  const markDone =
    task !== undefined && settleOffered(task, SETTLED_STATUS.DONE)
      ? () => tasks.onSettleTasks([taskId], SETTLED_STATUS.DONE)
      : undefined;
  const moving = useMoveTaskDialog(tasks, task);
  const copy = useCopyToast();
  const chord = useChordLinks();
  // The place the row stands in a list that reorders, which the menu moves it from under a finger; none for the toolbar's ⋯.
  const place = useRowPlace();
  const sections = useSectionDialogs(tasks, tasks.shown && doors.drawn);
  const section =
    task !== undefined
      ? moveToSectionEntry(tasks, { agent: false, id: task.id }, task.workspaceId, sections, name)
      : undefined;
  const setStanding = useStandingDoor(tasks);
  const relationId = useId();
  const descriptions =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true;
  const assignees = useAssigneeRows(task?.assignee);
  const standing =
    doors.surface === TASK_MENU_SURFACE.ROW && task !== undefined
      ? standingSubmenus(tasks, task, assignees, setStanding, doors.rowKeys === true, doors.chips)
      : [];
  const groups = (): readonly (readonly MenuEntry[])[] => [
    ...withRowMoves(
      taskActionGroups(
        tasks,
        task,
        taskId,
        {
          rename: doors.rename,
          askDelete: deletion.ask,
          askMove: moving.ask,
          copy,
          chord,
          rowKeys: doors.rowKeys === true,
          section,
          standing,
          relationId,
          opened,
          descriptions,
          read: {
            unread: doors.unread,
            onMark: (unread) => {
              if (task !== undefined) markRead(task, unread);
            },
          },
        },
        doors.surface,
      ),
      place,
    ),
  ];
  const footer =
    task === undefined ? undefined : <TaskMenuFooter tasks={tasks} task={task} opened={opened} />;
  const subject =
    task === undefined
      ? undefined
      : taskSubject(
          task,
          task.repository === null ? undefined : repositoryLabel(task.repository, []),
          undefined,
        );
  const dialog = (
    <>
      <ConfirmDialog
        open
        confirm={deletion}
        question={deleteQuestion(name, settledTask(task))}
        restoreTo={nextRowOrHead}
      />
      {moving.dialog}
      {sections.dialog}
    </>
  );
  return { deletion, markDone, groups, footer, subject, dialog };
}

/** One task's menu items, its delete question, and the dialogs its items open, as `useTaskMenuItems` answers them. */
export type TaskMenuItems = ReturnType<typeof useTaskMenuItems>;

/**
 * The open task's document menu and the questions its items ask, held on
 * the task's page on every tab of the task, whichever tab is chosen and
 * whether or not the panel shows the plan, and keyed by the task, so a
 * question asked of one task never stands over the next. It offers the open
 * task's Mark done, Version history, and Permanently delete commands, so
 * each runs exactly as its menu item would: Permanently delete still asks
 * first, and a task already done has no Mark done to offer. A focused
 * agent's pane offers its own Permanently delete over the task's
 * (`main-tabs.tsx`). The items are handed up through
 * `hand`, read as the Plan tab's ⋯ and right-click and a phone's header
 * draw them (`useTaskMenuItems`), and the newest stand there from the draw
 * that made them.
 */
export function TaskActions({
  tasks,
  task,
  onRename,
  hand,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  /** Puts the caret in the description's own title, or opens a phone's head as the task's name field. */
  onRename: () => void;
  /** Where the items are handed up, for the menus that draw them. */
  hand: React.RefObject<TaskMenuItems | undefined>;
}): React.JSX.Element {
  // Note that the open plan is unread only by a mark by hand, since its saves are seen as they land.
  const actions = useTaskMenuItems(taskRowTab(tasks), task.id, task.name, {
    rename: onRename,
    drawn: true,
    unread: useReadMarks().markedUnread(task.id),
    surface: TASK_MENU_SURFACE.DOCUMENT,
    opened: openedTaskOf(tasks),
  });
  hand.current = actions;
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(APP_COMMAND.MARK_TASK_DONE, actions.markDone);
  useAppCommand(
    APP_COMMAND.VERSION_HISTORY,
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true
      ? () => tasks.history.onOpen(task.id)
      : undefined,
  );
  return actions.dialog;
}

/**
 * Which faces a row may wear: its creator's, which a list holding one
 * creator's tasks or grouped by creator already says, and only an agent's
 * row with no task wears; and its assignee's, which a list holding the
 * tasks assigned to one member or grouped by assignee already says.
 */
export interface RowFaces {
  readonly creator: boolean;
  readonly assignee: boolean;
}

/** Every face a row may wear, as a list naming nobody draws it. */
const EVERY_FACE: RowFaces = { creator: true, assignee: true };

/** The face a task's row wears (`assigneeFace`), nothing where `faces` keeps the assignee off the row, the list saying it already. */
function rowFaceOf(
  task: TaskSummary,
  reader: ReturnType<typeof useMemberDirectory>,
  faces: RowFaces,
): AssigneeFace | undefined {
  return faces.assignee ? assigneeFace(task, reader) : undefined;
}

/**
 * A task's card as its sidebar row hangs it (`taskCardOf`). Note that it is
 * a component of its own, so what the card reads is worked out only once
 * the card is drawn, never on a render of the row.
 */
function SidebarTaskCard({
  tasks,
  task,
  now,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  now: number;
}): React.JSX.Element {
  return taskCardOf(tasks, task, now);
}

/**
 * A task in the sidebar, pinned or listed alike: led by its glyph
 * (`PlanGlyph`), its status's mark or the document where its service gives
 * it none, whose status the press says after the name, as a List row's does,
 * since the mark is decoration to a screen reader; its name, in the
 * body's weight unless the task is unread, and at the row's end how long ago
 * it was last updated, led by one mark for a repository that belongs to
 * another workspace, an agent at work, or a pull request (`task-card.tsx`),
 * the first named in the row's card, before that how many of its threads
 * wait on the reader, the Tasks page's count (`useTasksWaiting`) in the
 * attention ink, heard with the row as "2 need you", left out at none, and
 * part of the row's press rather than one of its own, before that a stop
 * sign while a task it waits on is still open (`BlockedMark`), which the press says after
 * the status, before that a pencil while a draft
 * waits in one of its boxes and it is not the plan open, whose boxes show
 * their own words, or the failed mark in its place while a message sent to
 * one of its agents was not delivered (`draft-mark.tsx`), and before that the face of who
 * is on it (`rowFaceOf`, drawn as `AssigneeFaceMark`): its assignee's,
 * where someone other than the reader is assigned, read against the members of the directory around the
 * list, or the dashed unassigned mark where no one is; a task assigned to
 * the reader wears none. Its repository, its owner's picture and its name, muted, where the list hands one (in one run),
 * and no face where its group is its creator's. Its time is the one the
 * list's order chooses. Pin
 * and Mark done stand in place of all of it while the row is hovered or
 * reached from the keyboard.
 * A press opens it, and its actions are one menu opened alike by the row's ⋯,
 * a right-click, a long press, and the menu key (`ListRow`'s `menu`). A
 * finger's row draws neither its ⋯ nor Pin and Mark done, as a phone's
 * Inbox row draws no ⋯, so its name keeps the room and its time runs to the
 * row's edge: a long press opens its menu, which offers Pin and Status's
 * Done, and the menu key on the row still does. Where the sidebar
 * chooses rows, it is chosen as a Mac's sidebar list chooses one, by ⌘-click,
 * ⇧-click, X, and ⌘A, filled and with no box, and chosen among several its
 * menu acts on every task chosen (`ChosenTasksContext`). Renamed,
 * the row is its name's field until the edit ends, and a key that ends it
 * hands focus back to the row.
 *
 */
export function SidebarTask({
  tasks,
  task,
  current,
  open = current,
  unread,
  now,
  at = task.updatedAt,
  repository,
  faces = EVERY_FACE,
  depth,
  nest,
  place,
  fold,
  childCount,
  onOpen,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  /** Whether this is the task the work column is showing. */
  current: boolean;
  /** Whether the plan is open in the window, so its drafts are in reach and unmarked; a row the sidebar does not mark may be, as one opened from a pin, and is its own mark unless said. */
  open?: boolean;
  /** Whether the task was saved since the developer last looked at it on this Mac. */
  unread: boolean;
  /** The time the row's last update is counted back from. */
  now: number;
  /** The time the row shows, which the list's order chooses: its last update unless said. */
  at?: number;
  /** The repository the row names, its owner's picture and its name, muted before its time, where the list hands one. */
  repository?: React.ReactNode;
  /** Which faces the row may wear (`rowFaceOf`): a group by assignee, or a filter by assignee, says the one it names instead. */
  faces?: RowFaces;
  /** How deep the row stands nested under its parent tasks: at the top unless said. */
  depth?: number | undefined;
  /** Where the row stands among its siblings, in a list that nests rows, which a reader hears with its level; none in a list that nests none. */
  nest?: ListRowNest | undefined;
  /** Where it stands in a run drawing only the rows near the view (`VirtualRows`); none where its list draws every row. */
  place?: VirtualRowPlace | undefined;
  /** The child tasks nested under the row, which it folds; none where the list holds none. */
  fold?: ListRowFold | undefined;
  /** How many of the task's child tasks are finished, of all of them, said before its time; none where it has none. */
  childCount?: ChildTaskCount | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  const renaming = useMutation(tasks.renameTask);
  const rename = useInlineRename(task.id, renameWrite(renaming, TASK_RENAME_SHAPE));
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const actions = useTaskMenuItems(taskRowTab(tasks), task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread,
    rowKeys: true,
    surface: TASK_MENU_SURFACE.ROW,
    opened: openedTaskOf(tasks),
  });
  const reads = useReadMarks();
  const coarse = useCoarsePointer();
  const worn = rowFaceOf(task, useMemberDirectory(), faces);
  const chosen = useContext(ChosenTasksContext)(task.id);
  const drafted = useDescriptionDrafted(task.id) && !open;
  const sendFailed = useTaskSendFailed(task.id) && !open;
  const waiting = useTasksWaiting(tasks).get(task.id) ?? 0;
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, whose keys it hears while focused.
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const endedByKey = useRefocusAfterEdit(rename.editing, row);
  // S opens the row's menu on its Status, each press counted so it opens it again.
  const [statusAsks, setStatusAsks] = useState(0);
  // Note that a row chosen among several opens the selection's Status, which every chosen task has.
  const statusDrawn =
    chosen !== undefined || (task.status !== undefined && task.priority !== undefined);
  const statusAsked = { count: statusAsks, submenu: STANDING_WORDS.STATUS };
  useFocusedRowKeys(
    item,
    () => reads.mark(task, !unread),
    () => tasks.onMarkTask(task.id, task.pinnedAt === undefined ? TASK_MARK.PIN : TASK_MARK.UNPIN),
    statusDrawn ? () => setStatusAsks((asks) => asks + 1) : undefined,
  );
  const card = useMemo(
    () => <SidebarTaskCard tasks={tasks} task={task} now={now} />,
    [tasks, task, now],
  );
  return (
    <>
      <RowHintOptions card={card}>
        <ListRow
          ref={hold}
          motionKey={task.id}
          density={LIST_DENSITY.DENSE}
          ink={LIST_ROW_INK.SIDEBAR}
          leading={<PlanGlyph status={task.status} />}
          title={
            rename.editing ? (
              <InlineEdit
                value={rename.asked ?? task.name}
                label="Task name"
                maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
                editing
                onEnd={(edit) => {
                  endedByKey(edit.byKey);
                  rename.end(edit.value);
                }}
              />
            ) : (
              <>
                <OneLine words={task.name}>
                  <ReplayMask>{task.name}</ReplayMask>
                </OneLine>
                {task.status === undefined ? null : (
                  <VisuallyHidden>, {TASK_STATUS_WORDS[task.status]}</VisuallyHidden>
                )}
                {task.blocked === true ? <VisuallyHidden>, {BLOCKED_WORDS}</VisuallyHidden> : null}
                {unread ? <VisuallyHidden>(unread)</VisuallyHidden> : null}
                {worn === undefined ? null : (
                  <ReplayMask>
                    <AssigneeFaceHeard face={worn} />
                  </ReplayMask>
                )}
              </>
            )
          }
          description={rename.refused ? <span>{RENAME_FAILED_NOTE}</span> : undefined}
          meta={
            rename.editing ? null : (
              <span className={SIDEBAR_ROW_TIME}>
                {repository === undefined ? null : (
                  <span className={SIDEBAR_ROW_REPOSITORY}>
                    <ReplayMask>{repository}</ReplayMask>
                  </span>
                )}
                {worn === undefined ? null : <AssigneeFaceMark face={worn} heard={false} />}
                {leftMark(sendFailed, drafted)}
                {task.blocked === true ? <BlockedMark aria-hidden="true" /> : null}
                {childCount === undefined ? null : (
                  <ProgressCount
                    done={childCount.finished}
                    total={childCount.total}
                    label={`${childCount.finished} of ${childCount.total} sub-tasks finished`}
                  />
                )}
                <WaitingCount count={waiting} />
                <TaskRowStatus task={task} />
                <Time at={at} now={now} hint={false} />
              </span>
            )
          }
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={unread}
          disabled={actions.deletion.busy}
          hint={rename.editing ? undefined : { Hint: RowHint, label: task.name }}
          onPress={rename.editing ? undefined : onOpen}
          selectKey={task.id}
          menu={
            rename.editing
              ? undefined
              : chosen === undefined
                ? {
                    ...rowMenu("Task", actions.groups(), tasks.shown, true),
                    footer: actions.footer,
                    openRequest: statusAsked,
                  }
                : { ...chosenRowMenu("Task", chosen, tasks.shown), openRequest: statusAsked }
          }
          more={!coarse}
          depth={depth}
          nest={nest}
          place={place}
          fold={fold}
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          actions={
            rename.editing || coarse ? null : (
              <SidebarTaskMarks
                tasks={tasks}
                task={task}
                current={current}
                disabled={actions.deletion.busy}
              />
            )
          }
        />
      </RowHintOptions>
      {actions.dialog}
    </>
  );
}
