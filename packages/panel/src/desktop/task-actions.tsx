import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR, TASK_BOUNDS, type TaskSummary } from "@luke/features/task-wire";
import { IRREVERSIBLE_WORDS } from "@luke/features/words";
import { APP_COMMAND, type KeyedCommand } from "@luke/settings/shortcuts";
import {
  ANNOUNCE,
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
  nextRowOrHead,
  OneLine,
  RowHint,
  RowHintOptions,
  TIME_LOOK,
  Time,
  Tooltip,
  useConfirmDialog,
  useMinute,
  VisuallyHidden,
} from "@luke/ui";
import { type AssigneeFace, accountActor, assigneeFace, creatorActor } from "@luke/ui/actor-model";
import { confirmAsked } from "@luke/ui/confirm-state";
import { repositoryLabel } from "@luke/ui/task-list-model";
import {
  DOCUMENT_REGION,
  RENAME_FAILED_NOTE,
  SETTLED_STATUS,
  settleOffered,
  TASK_MARK,
  type TaskMark,
} from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { useCallback, useContext, useMemo, useRef } from "react";
import { ActorRef, AssigneeFaceHeard, AssigneeFaceMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import {
  COMMAND_PLACE,
  commandAction,
  commandWords,
  PANEL_COMMAND,
  type PanelCommand,
} from "../command-items.js";
import { usePlanDrafted } from "../composer-drafts.js";
import { useCopyToast } from "../copy-feedback.js";
import { DraftMark } from "../draft-mark.js";
import { useMemberDirectory } from "../member-directory.js";
import { EditedBy, type EditPlace, useEditReader } from "../tasks/edit-ref.js";
import { lastEditOf } from "../tasks/plan-body.js";
import { PlanGlyph } from "../tasks/tab-look.js";
import {
  copyTaskLinkItem,
  markReadItem,
  type ReadMark,
  renameTaskItem,
  taskLinkPlace,
  versionHistoryItem,
} from "../tasks/task-menu-items.js";
import { TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import { useReadMarks } from "../tasks/use-task-looks.js";
import { useTaskOrigin } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { useRefocusAfterEdit } from "../use-refocus-after-edit.js";
import { type MenuAction, type MenuEntry, rowMenu } from "./action-menu.js";
import { useMoveTaskDialog } from "./move-task-dialog.js";
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { moveToSectionEntry, useSectionDialogs } from "./sidebar-sections.js";
import {
  SIDEBAR_ROW_REPOSITORY,
  SIDEBAR_ROW_TIME,
  TaskRowStatus,
  taskCardOf,
} from "./task-card.js";
import { taskSubject } from "./task-row-parts.js";
import { ChosenTasksContext, chosenRowMenu } from "./tasks-selection.js";

/**
 * task-actions.tsx -- one task's menu, built once (`taskActionGroups`) for the two surfaces that offer it: the Plan tab, which shows the task, from the ⋯ in the side panel's bar and the tab's right-click, and a row of the task, in the sidebar, the Tasks list, the Board, and the Recent list, from its ⋯, a right-click, and the menu key.
 *
 * Both surfaces draw the same items in the one order every menu of the
 * window keeps, Copy, then name and read, then organize, then open
 * elsewhere, and Delete last and alone, so a task in a list can be acted on
 * without being opened first. The Plan tab's is the task's document menu
 * (`TASK_MENU_SURFACE.DOCUMENT`): it leaves out Mark done, Cancel task, and
 * Change repository, because the plan draws chips for the task's status and
 * its repository under its title, and its Pin is the task's own, since the
 * tab showing the task is what stands for the task in the sidebar. A row's
 * menu (`TASK_MENU_SURFACE.ROW`) keeps all three, since a row draws no
 * chips. The menu is the window's own (`action-menu.tsx`), so every door
 * draws it the same way and Permanently delete can be drawn red.
 * Each item is worded, marked, and keyed as the window's one list has it
 * (`command-items.tsx`), as ⌘K offers the same command; the open task's menu
 * prints the chords of Copy plan, Mark done, and Permanently delete, which
 * act on the open task, and another task's prints none, as a tab's menu
 * prints its chords for the chosen tab alone.
 *
 * Copy link copies the plan's address on tryluke.dev, as the ⋯
 * beside the plan's title does (`task-menu-items.tsx`). Mark as unread
 * draws the task's row in the unread weight until it next opens, and turns
 * to Mark as read on a task already unread. Rename edits the
 * name where the door draws it: the sidebar's row turns into a field, and
 * the Plan tab's ⋯ puts the caret in the plan's own title. Version history
 * opens the plan's versions over the whole window, opening the task first
 * where it is not the open one, the one item that moves it. Pin moves the
 * task in the sidebar at once and is undone from the same menu; Mark done,
 * where Archive used to stand, with its chord, sets the task Done, and
 * Cancel task sets it Canceled, each said in a toast whose Undo puts back
 * the status it stood at, and neither asking anything, since neither stops
 * an agent. A sidebar row also offers Pin and Mark done as buttons at its
 * end on hover.
 * Move to workspace opens a dialog listing the account's other workspaces
 * and what the move does (`move-task-dialog.tsx`), offered on a task the
 * reader started. Move to section, beside Pin and Mark done while the account
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

/** A task as the list or the open document holds it; nothing for a task neither holds. */
export function taskOf(tasks: TasksControl, taskId: string): TaskSummary | undefined {
  const listed = listedTask(tasks.tasks, taskId);
  if (listed !== undefined) return listed;
  const { region } = tasks;
  return region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
    ? region.task
    : undefined;
}

/** One way a task can be moved in the sidebar or settled, as the menu and the row's own buttons both offer it: the list's command and what it does to this task. */
interface PlaceMark {
  key: string;
  item: PanelCommand;
  onSelect: () => void;
}

/** Pin, offered as whichever way the task is not yet: the reader's own pin of the task, which the Plan tab's menu offers as the tab's. */
function pinMark(tasks: TasksControl, task: TaskSummary): PlaceMark {
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
  tasks: TasksControl,
  task: TaskSummary | undefined,
  keyed: boolean,
): MenuAction[] {
  if (task === undefined) return [];
  const { item, onSelect } = pinMark(tasks, task);
  return [commandAction(item, onSelect, keyed)];
}

/** Pin, Mark done, and Cancel task as the menu's items, Cancel task on a task not already canceled, Mark done keyed where `keyed`; nothing for a task neither the list nor the document holds. */
function placeActions(
  tasks: TasksControl,
  task: TaskSummary | undefined,
  keyed: boolean,
): MenuAction[] {
  if (task === undefined) return [];
  const marks = placeMarks(tasks, task).map(({ item, onSelect }) =>
    commandAction(item, onSelect, keyed),
  );
  const cancel: MenuAction = {
    ...commandAction(
      PANEL_COMMAND.CANCEL_TASK,
      () => tasks.onSettleTasks([task.id], SETTLED_STATUS.CANCELED),
      keyed,
    ),
    danger: true,
  };
  const cancelable = settleOffered(task, SETTLED_STATUS.CANCELED);
  return cancelable ? [...marks, cancel] : marks;
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
 * one is pressed (`Tooltip`'s `cardRegion`).
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

/**
 * Pin and Mark done at a task's sidebar row's end (`RowMarks`), Mark done
 * as a check where Archive's box stood. Rested on, the row hangs the task's
 * card beside it (`task-card.tsx`): its name in full, its repository, and
 * its agents and pull requests, read from the list's row. Each runs what
 * its menu item runs, and only the open task's Mark done names ⇧⌘A,
 * because the chord marks the open task rather than the row under the
 * pointer.
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

/** Which surface offers a task's menu, which decides what the menu holds (`taskActionGroups`). */
export const TASK_MENU_SURFACE = {
  /** A row of the task, which draws no chips, so its menu keeps Mark done, Cancel task, and Change repository. */
  ROW: "row",
  /** The Plan tab, which shows the task under chips for its status and its repository, so its menu leaves those out. */
  DOCUMENT: "document",
} as const;

export type TaskMenuSurface = (typeof TASK_MENU_SURFACE)[keyof typeof TASK_MENU_SURFACE];

/**
 * One task's actions in the groups a rule divides, offering only those that
 * apply to it now, for the surface that offers them. Copy formats the
 * document drawn, so only the open task offers it, ahead of Copy link. A
 * row's menu then holds Mark as unread or read, Rename, and Version
 * history in that same group; Pin, Mark done, and Cancel task in the next,
 * beside Move to section; and the repository changed from any row, Move to
 * workspace where the task may be moved, and Open on GitHub where it has a
 * repository. The Plan tab's document menu holds Rename, Version history,
 * and the read mark in a group of their own, then Pin, Move to section, and
 * Move to workspace, then Open on GitHub alone, and neither Mark done,
 * Cancel task, nor Change repository, which the plan's chips stand for.
 * Permanently delete is last and alone on both. Only the open task's items
 * print their chords, since a chord acts on the open task alone.
 */
function taskActionGroups(
  tasks: TasksControl,
  taskId: string,
  doors: {
    rename: () => void;
    askDelete: () => void;
    askMove: (() => void) | undefined;
    copy: (words: string, label: string) => void;
    read: ReadMark;
    /** Move to section, where the account keeps sections and the task may stand in one. */
    section: MenuEntry | undefined;
  },
  surface: TaskMenuSurface,
): MenuEntry[][] {
  const { region } = tasks;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.task.id === taskId;
  const task = taskOf(tasks, taskId);
  const copy: MenuAction[] = drawn
    ? [commandAction(PANEL_COMMAND.COPY_PLAN, tasks.copy.onPress, drawn)]
    : [];
  const link: MenuAction[] =
    task === undefined
      ? []
      : [copyTaskLinkItem(doors.copy, taskId, taskLinkPlace(tasks.workspaces, task))];
  const read: MenuAction[] = task === undefined ? [] : [markReadItem(doors.read)];
  const rename = renameTaskItem(doors.rename);
  const versions = versionHistoryItem(() => tasks.history.onOpen(taskId));
  const section: MenuEntry[] = doors.section === undefined ? [] : [doors.section];
  const change = commandAction(
    PANEL_COMMAND.CHANGE_REPOSITORY,
    () => tasks.onChangeRepository(taskId),
    drawn,
  );
  const move: MenuAction[] =
    doors.askMove === undefined
      ? []
      : [commandAction(PANEL_COMMAND.MOVE_TO_WORKSPACE, doors.askMove, drawn)];
  const open: MenuAction[] =
    (task?.repository ?? null) === null
      ? []
      : [commandAction(PANEL_COMMAND.OPEN_ON_GITHUB, () => tasks.onOpenOnGitHub(taskId), drawn)];
  const remove: MenuAction = {
    ...commandAction(PANEL_COMMAND.DELETE_TASK, doors.askDelete, drawn),
    danger: true,
  };
  const groups: MenuEntry[][] =
    surface === TASK_MENU_SURFACE.DOCUMENT
      ? [
          [...copy, ...link],
          [rename, versions, ...read],
          [...pinAction(tasks, task, drawn), ...section, ...move],
          open,
          [remove],
        ]
      : [
          [...copy, ...link, ...read, rename, versions],
          [...placeActions(tasks, task, drawn), ...section],
          [change, ...move, ...open],
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
}: {
  tasks: TasksControl;
  task: TaskSummary;
}): React.JSX.Element {
  const now = useMinute();
  const reader = useEditReader({ readerId: tasks.me });
  const account = useAppSlice(APP_SLICE.ACCOUNT);
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  const origin = useTaskOrigin()(task);
  const { region } = tasks;
  const opened = region.kind === DOCUMENT_REGION.READY && region.task.id === task.id;
  const edit = opened ? lastEditOf(region.task) : undefined;
  const place: EditPlace = {
    reader,
    sections: (opened ? region.task.sectionEdits : undefined) ?? [],
    agents: { control: tasks.agents, onOpen: undefined },
  };
  const named = edit !== undefined && edit.actor !== PLAN_ACTOR.EARLIER;
  return (
    <>
      <p className="task-menu-note actor-line m-0 flex-wrap overflow-clip [overflow-clip-margin:var(--luke-focus-ring-room)]">
        {"Created by "}
        {origin === undefined ? null : (
          <>
            <ActorRef actor={origin} />
            {" for "}
          </>
        )}
        <ActorRef actor={creatorActor(task, reader, you)} sentence />
        {" · "}
        <Time at={task.createdAt} now={now} look={TIME_LOOK.AGO} />
      </p>
      {edit === undefined && task.updatedAt <= task.createdAt ? null : (
        <p className="task-menu-note actor-line m-0 flex-wrap overflow-clip [overflow-clip-margin:var(--luke-focus-ring-room)]">
          {named ? "Last edited by " : "Last edited"}
          {edit === undefined ? null : <EditedBy edit={edit} place={place} sentence />}
          {" · "}
          <Time at={edit?.at ?? task.updatedAt} now={now} look={TIME_LOOK.AGO} />
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
    verb: "Permanently delete",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
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
  tasks: TasksControl,
  taskId: string,
  name: string,
  doors: {
    rename: () => void;
    drawn: boolean;
    unread: boolean;
    /** Which surface offers the items, which decides what they hold. */
    surface: TaskMenuSurface;
  },
) {
  const task = taskOf(tasks, taskId);
  const reads = useReadMarks();
  const deletion = useConfirmDialog({ subject: task !== undefined, surfaceOpen: tasks.shown }, () =>
    tasks.onDeleteTask(taskId),
  );
  // Mark done as the chord runs it: on a task not already done, and nothing otherwise.
  const markDone =
    task !== undefined && settleOffered(task, SETTLED_STATUS.DONE)
      ? () => tasks.onSettleTasks([taskId], SETTLED_STATUS.DONE)
      : undefined;
  const moving = useMoveTaskDialog(tasks, task);
  const copy = useCopyToast();
  // The place the row stands in a list that reorders, which the menu moves it from under a finger; none for the toolbar's ⋯.
  const place = useRowPlace();
  const sections = useSectionDialogs(tasks, tasks.shown && doors.drawn);
  const section =
    task !== undefined
      ? moveToSectionEntry(tasks, { agent: false, id: task.id }, task.workspaceId, sections.askNew)
      : undefined;
  const groups = (): readonly (readonly MenuEntry[])[] => [
    ...withRowMoves(
      taskActionGroups(
        tasks,
        taskId,
        {
          rename: doors.rename,
          askDelete: deletion.ask,
          askMove: moving.ask,
          copy,
          section,
          read: {
            unread: doors.unread,
            onMark: (unread) => {
              if (task !== undefined) reads.mark(task, unread);
            },
          },
        },
        doors.surface,
      ),
      place,
    ),
  ];
  const footer = task === undefined ? undefined : <TaskMenuFooter tasks={tasks} task={task} />;
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
 * task's Mark done and Permanently delete shortcuts, so each runs exactly
 * as its menu item would: Permanently delete still asks first, and a task
 * already done has no Mark done to offer. The items are handed up through
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
  /** Puts the caret in the plan's own title, or opens a phone's head as the task's name field. */
  onRename: () => void;
  /** Where the items are handed up, for the menus that draw them. */
  hand: React.RefObject<TaskMenuItems | undefined>;
}): React.JSX.Element {
  // Note that the open plan is unread only by a mark by hand, since its saves are seen as they land.
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: onRename,
    drawn: true,
    unread: useReadMarks().markedUnread(task.id),
    surface: TASK_MENU_SURFACE.DOCUMENT,
  });
  hand.current = actions;
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE_TASK, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(APP_COMMAND.MARK_TASK_DONE, actions.markDone);
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
 * the first named in the row's card, before that a pencil while a draft
 * waits in one of its boxes and it is not the plan open, whose boxes show
 * their own words (`draft-mark.tsx`), and before that the face of who
 * is on it (`rowFaceOf`, drawn as `AssigneeFaceMark`): its assignee's,
 * where someone other than the reader is assigned, read against the members of the directory around the
 * list, or the dashed unassigned mark where no one is; a task assigned to
 * the reader wears none. Its repository's name, muted, where the list hands one (in one run),
 * and no face where its group is its creator's. Its time is the one the
 * list's order chooses. Pin
 * and Mark done stand in place of all of it while the row is hovered or
 * reached from the keyboard.
 * A press opens it, and its actions are one menu opened alike by the row's ⋯,
 * a right-click, and the menu key (`ListRow`'s `menu`). Where the sidebar
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
  waiting,
  now,
  at = task.updatedAt,
  repository,
  faces = EVERY_FACE,
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
  /** How many of the task's questions wait on the reader, as the Inbox counts them (`useTasksWaiting`). */
  waiting: number;
  /** The time the row's last update is counted back from. */
  now: number;
  /** The time the row shows, which the list's order chooses: its last update unless said. */
  at?: number;
  /** The repository's name the row says, muted before its time, where the list hands one. */
  repository?: string | undefined;
  /** Which faces the row may wear (`rowFaceOf`): a group by assignee, or a filter by assignee, says the one it names instead. */
  faces?: RowFaces;
  onOpen: () => void;
}): React.JSX.Element {
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  useAnnounceShown(ANNOUNCE.ALERT, rename.refused ? RENAME_FAILED_NOTE : "");
  const actions = useTaskMenuItems(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread,
    surface: TASK_MENU_SURFACE.ROW,
  });
  const worn = rowFaceOf(task, useMemberDirectory(), faces);
  const chosen = useContext(ChosenTasksContext)(task.id);
  const drafted = usePlanDrafted(task.id) && !open;
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control.
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const endedByKey = useRefocusAfterEdit(rename.editing, row);
  const card = useMemo(
    () => <SidebarTaskCard tasks={tasks} task={task} now={now} />,
    [tasks, task, now],
  );
  return (
    <>
      <RowHintOptions card={card} cardBeside cardRegion={item}>
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
                <OneLine words={task.name}>{task.name}</OneLine>
                {task.status === undefined ? null : (
                  <VisuallyHidden>, {TASK_STATUS_WORDS[task.status]}</VisuallyHidden>
                )}
                {unread ? <VisuallyHidden>(unread)</VisuallyHidden> : null}
                {worn === undefined ? null : <AssigneeFaceHeard face={worn} />}
              </>
            )
          }
          description={rename.refused ? <span>{RENAME_FAILED_NOTE}</span> : undefined}
          meta={
            rename.editing ? null : (
              <span className={SIDEBAR_ROW_TIME}>
                {repository === undefined ? null : (
                  <OneLine className={SIDEBAR_ROW_REPOSITORY} words={repository}>
                    {repository}
                  </OneLine>
                )}
                {worn === undefined ? null : <AssigneeFaceMark face={worn} heard={false} />}
                {drafted ? <DraftMark /> : null}
                <TaskRowStatus task={task} waiting={waiting} />
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
                ? { ...rowMenu("Task", actions.groups(), tasks.shown), footer: actions.footer }
                : chosenRowMenu("Task", chosen, tasks.shown)
          }
          actionsAt={LIST_ROW_ACTIONS.HOVER}
          actions={
            rename.editing ? null : (
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
