import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { PLAN_ACTOR, TASK_BOUNDS, type TaskSummary } from "@luke/features/task-wire";
import { EXPERIMENT } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  ACTIONS_SHOWN,
  ArchiveIcon,
  ConfirmDialog,
  CopyIcon,
  type DialogQuestion,
  EllipsisIcon,
  ExternalIcon,
  IconButton,
  InlineEdit,
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  LIST_ROW_INK,
  ListRow,
  PinIcon,
  ProviderMark,
  TrashIcon,
  UnarchiveIcon,
  UnpinIcon,
  useConfirmDialog,
  useMenu,
} from "@luke/ui";
import { accountActor, creatorActor, teammateCreator } from "@luke/ui/actor-model";
import { confirmAsked } from "@luke/ui/confirm-state";
import {
  DOCUMENT_REGION,
  RENAME_FAILED_NOTE,
  TASK_MARK,
  type TaskMark,
} from "@luke/ui/tasks-model";
import { useInlineRename } from "@luke/ui/use-inline-rename";
import { FolderInputIcon } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, CreatorHeard } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { usePlanDrafted } from "../composer-drafts";
import { useCopyToast } from "../copy-feedback";
import { DraftMark } from "../draft-mark";
import { useMemberDirectory } from "../member-directory";
import { EditedBy, type EditPlace, useEditReader } from "../tasks/edit-ref";
import { lastEditOf } from "../tasks/plan-body";
import { RelativeTime } from "../tasks/relative-time";
import {
  copyTaskLinkItem,
  markReadItem,
  type ReadMark,
  renameTaskItem,
  taskLinkPlace,
  versionHistoryItem,
} from "../tasks/task-menu-items";
import { useMinute } from "../tasks/task-time";
import { useReadMarks } from "../tasks/use-task-looks";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip";
import { useAppState, useExperiment } from "../use-app-state";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu";
import { strandedHome, useMoveTaskDialog } from "./move-task-dialog";
import { moveToSectionEntry, useSectionDialogs } from "./sidebar-sections";
import { TaskStatusMark, taskCardOf } from "./task-card";

/**
 * task-actions.tsx -- one task's actions, offered alike from the toolbar's ⋯ button and from a right-click on the task in the sidebar.
 *
 * Both doors open the same menu over the same task, so a task in the list can
 * be acted on without being opened first. The menu is the window's own (`action-menu.tsx`),
 * so both doors draw it the same way and Permanently delete can be drawn red.
 *
 * Copy link copies the plan's address on tryluke.dev, as the ⋯
 * beside the plan's title does (`task-menu-items.tsx`). Mark as unread
 * draws the task's row in the unread weight until it next opens, and turns
 * to Mark as read on a task already unread. Rename edits the
 * name where the door draws it: the sidebar's row turns into a field, and
 * the toolbar's ⋯ opens its title as one. Version history
 * opens the plan's versions over the whole window, opening the task first
 * where it is not the open one, the one item that moves it. Pin and Archive
 * move the task in the sidebar at once, and each is undone from the same
 * menu; a sidebar row also offers both as buttons at its end on hover.
 * Move to workspace opens a dialog listing the account's other workspaces
 * and what the move does (`move-task-dialog.tsx`), offered on a task the
 * reader started. Move to section, beside Pin and Archive while the account
 * has sections on, puts the task in one of the reader's own sections, a new
 * one, or none (`sidebar-sections.tsx`).
 * Permanently delete cannot be undone, so choosing it asks first in a dialog
 * over the window that names the task and offers Archive as the way to keep
 * it, whichever door it was chosen from. Under the items, pressed by nothing,
 * the menu says who created the task and who last edited it, and when.
 */

/** A task as the list or the open document holds it, archived or not; nothing for a task neither holds. */
export function taskOf(tasks: TasksControl, planId: string): TaskSummary | undefined {
  const listed = [...tasks.tasks, ...tasks.archived].find((plan) => plan.id === planId);
  if (listed !== undefined) return listed;
  const { region } = tasks;
  return region.kind === DOCUMENT_REGION.READY && region.task.id === planId
    ? region.task
    : undefined;
}

/** One way a task can be moved in the sidebar, as the menu and the row's own buttons both offer it. */
interface PlaceMark {
  mark: TaskMark;
  label: string;
  icon: React.JSX.Element;
}

/**
 * Pin and Archive, each offered as whichever way the task is not yet. An
 * archived task offers no pin, because the sidebar draws it among the
 * archived whether or not it is pinned.
 */
function placeMarks(task: TaskSummary): PlaceMark[] {
  if (task.archivedAt !== undefined) {
    return [{ mark: TASK_MARK.UNARCHIVE, label: "Unarchive", icon: <UnarchiveIcon /> }];
  }
  return [
    task.pinnedAt === undefined
      ? { mark: TASK_MARK.PIN, label: "Pin", icon: <PinIcon /> }
      : { mark: TASK_MARK.UNPIN, label: "Unpin", icon: <UnpinIcon /> },
    { mark: TASK_MARK.ARCHIVE, label: "Archive", icon: <ArchiveIcon /> },
  ];
}

/** Pin and Archive as the menu's items; nothing for a task neither the list nor the document holds. */
function placeActions(tasks: TasksControl, task: TaskSummary | undefined): MenuAction[] {
  if (task === undefined) return [];
  return placeMarks(task).map(({ mark, label, icon }) => ({
    label,
    icon,
    onSelect: () => tasks.onMarkTask(task.id, mark),
  }));
}

/**
 * Pin and Archive at a sidebar row's end, standing in the time's place while
 * the row is hovered or reached from the keyboard. Rested on, the row hangs
 * the task's card beside it (`task-card.tsx`): its name in full, its
 * repository, and its agents and pull requests, read from the list's row. Each runs what its menu
 * item runs, and only the open task's Archive names ⇧⌘A, because the chord
 * archives the open task rather than the row under the pointer. They are the
 * row's siblings rather than inside it, so a press on one opens nothing, but
 * part of the row to its card, which stands while the pointer is on them and
 * goes as one is pressed (`Tooltip`'s `cardRegion`).
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
  return (
    <>
      {placeMarks(task).map(({ mark, label, icon }) => (
        <Tooltip
          key={mark}
          label={label}
          {...(current && mark === TASK_MARK.ARCHIVE ? { command: APP_COMMAND.ARCHIVE_TASK } : {})}
        >
          <button
            type="button"
            className="sidebar-task-mark"
            aria-label={label}
            disabled={disabled}
            onClick={() => tasks.onMarkTask(task.id, mark)}
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </>
  );
}

/**
 * One plan's actions in the groups a rule divides, offering only those that
 * apply to it now. Copy formats the document drawn, so only the open plan
 * offers it, ahead of Copy link, Mark as unread or read, Rename,
 * and Version history; Pin and Archive follow; the repository is changed from any plan and opened on
 * GitHub where there is one, beside Move to workspace where the plan may be
 * moved; Permanently delete is last and alone. An archived plan takes
 * nothing until it is brought back, so it offers neither Rename, Change
 * repository, nor a move, only what reads it, its link, its read mark, and
 * its version history (which restores nothing), Unarchive, and Permanently
 * delete.
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
): MenuEntry[][] {
  const { region } = tasks;
  const drawn = region.kind === DOCUMENT_REGION.READY && region.task.id === taskId;
  const task = taskOf(tasks, taskId);
  const archived = task?.archivedAt !== undefined;
  const copy: MenuAction = { label: "Copy plan", icon: <CopyIcon />, onSelect: tasks.copy.onPress };
  const link: MenuAction[] =
    task === undefined
      ? []
      : [
          copyTaskLinkItem(doors.copy, taskId, taskLinkPlace(tasks.workspaces, task)),
          markReadItem(doors.read),
        ];
  const rename = renameTaskItem(doors.rename);
  const versions = versionHistoryItem(() => tasks.history.onOpen(taskId));
  const change: MenuAction = {
    label: "Change repository",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => tasks.onChangeRepository(taskId),
  };
  const move: MenuAction[] =
    doors.askMove === undefined
      ? []
      : [{ label: "Move to workspace", icon: <FolderInputIcon />, onSelect: doors.askMove }];
  const open: MenuAction = {
    label: "Open on GitHub",
    icon: <ExternalIcon />,
    onSelect: () => tasks.onOpenOnGitHub(taskId),
  };
  const groups: MenuEntry[][] = [
    [...(drawn ? [copy] : []), ...link, ...(archived ? [] : [rename]), versions],
    [...placeActions(tasks, task), ...(doors.section === undefined ? [] : [doors.section])],
    [
      ...(archived ? [] : [change]),
      ...move,
      ...((task?.repository ?? null) === null ? [] : [open]),
    ],
    [
      {
        label: "Permanently delete",
        icon: <TrashIcon />,
        onSelect: doors.askDelete,
        danger: true,
      },
    ],
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
  const account = useAppState()?.account;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  const { region } = tasks;
  const opened = region.kind === DOCUMENT_REGION.READY && region.task.id === task.id;
  const edit = opened ? lastEditOf(region.task) : undefined;
  const place: EditPlace = {
    reader,
    sections: (opened ? region.task.sectionEdits : undefined) ?? [],
    agents: { control: tasks.agents, onOpen: undefined },
    now,
  };
  const named = edit !== undefined && edit.actor !== PLAN_ACTOR.EARLIER;
  return (
    <>
      <p className="task-menu-note actor-line">
        {"Created by "}
        <ActorRef actor={creatorActor(task, reader, you)} sentence />
        {" · "}
        <RelativeTime at={task.createdAt} now={now} ago />
      </p>
      {edit === undefined && task.updatedAt <= task.createdAt ? null : (
        <p className="task-menu-note actor-line">
          {named ? "Last edited by " : "Last edited"}
          {edit === undefined ? null : <EditedBy edit={edit} place={place} sentence />}
          {" · "}
          <RelativeTime at={edit?.at ?? task.updatedAt} now={now} ago />
        </p>
      )}
    </>
  );
}

/**
 * The question Permanently delete asks, naming the task. Deleting a task
 * removes its document and its board and clears the conversation its
 * transcript is read from, which nothing in the app brings back, so a task
 * not yet archived is pointed at Archive, which keeps all of it.
 */
function deleteQuestion(name: string, archived: boolean): DialogQuestion {
  const lost = `“${name}” and its board and transcript will be deleted. This can’t be undone.`;
  return {
    title: "Permanently delete task?",
    body: archived ? lost : `${lost} To keep it out of the way instead, archive it.`,
    verb: "Permanently delete",
    running: "Deleting",
  };
}

/**
 * One task's menu and its delete question, held for whichever door offers
 * them. Neither outlives the tab going off screen, the menu does not
 * outlive its door, and the question does not outlive the task: each is
 * taken down in the render that finds it gone, so neither is left standing
 * over another surface, over a task deleted elsewhere, or waiting for the
 * next time the panel opens.
 */
function useTaskMenu(
  tasks: TasksControl,
  taskId: string,
  name: string,
  doors: { rename: () => void; drawn: boolean; unread: boolean },
) {
  const plan = taskOf(tasks, taskId);
  const reads = useReadMarks();
  const deletion = useConfirmDialog({ subject: plan !== undefined, surfaceOpen: tasks.shown }, () =>
    tasks.onDeleteTask(taskId),
  );
  const moving = useMoveTaskDialog(tasks, plan);
  const copy = useCopyToast();
  const { open, drawn, close, trigger, contextMenu } = useMenu(tasks.shown && doors.drawn);
  // Note that an archived task stands in no section, so it is offered none until it is brought back.
  const sectionsOn = useExperiment(EXPERIMENT.SECTIONS);
  const sections = useSectionDialogs(tasks, tasks.shown && doors.drawn);
  const section =
    sectionsOn && plan !== undefined && plan.archivedAt === undefined
      ? moveToSectionEntry(tasks, plan, sections.askNew)
      : undefined;
  const menu =
    drawn === undefined ? null : (
      <ActionMenu
        label="Task actions"
        menu={drawn}
        footer={plan === undefined ? undefined : <TaskMenuFooter tasks={tasks} task={plan} />}
        groups={taskActionGroups(tasks, taskId, {
          rename: doors.rename,
          askDelete: deletion.ask,
          askMove: moving.ask,
          copy,
          section,
          read: {
            unread: doors.unread,
            onMark: (unread) => {
              if (plan !== undefined) reads.mark(plan, unread);
            },
          },
        })}
        onClose={close}
      />
    );
  const dialog = (
    <>
      <ConfirmDialog
        confirm={deletion}
        question={deleteQuestion(name, plan?.archivedAt !== undefined)}
      />
      {moving.dialog}
      {sections.dialog}
    </>
  );
  return { deletion, open: open !== undefined, close, trigger, contextMenu, menu, dialog };
}

/**
 * The open task's ⋯ button in the toolbar, and the menu it drops, drawn
 * while the task's own tab is chosen, because the menu is the task's and not
 * an agent's. It is also what offers the open task's Archive and Permanently
 * delete shortcuts, on every tab of the task, so each runs exactly as its
 * menu item would: Permanently delete still asks first, and an archived task
 * has no Archive to offer.
 */
export function TaskActions({
  tasks,
  task,
  button,
  onRename,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  /** Whether the ⋯ button is drawn: the shortcuts and the delete question stand either way. */
  button: boolean;
  /** Opens the toolbar's title as the task's name field. */
  onRename: () => void;
}): React.JSX.Element {
  // Note that the open plan is unread only by a mark by hand, since its saves are seen as they land.
  const actions = useTaskMenu(tasks, task.id, task.name, {
    rename: onRename,
    drawn: button,
    unread: useReadMarks().markedUnread(task.id),
  });
  const { deletion } = actions;
  const asking = confirmAsked(deletion.stage);
  useAppCommand(APP_COMMAND.DELETE_TASK, asking || deletion.busy ? undefined : deletion.ask);
  useAppCommand(
    APP_COMMAND.ARCHIVE_TASK,
    task.archivedAt === undefined ? () => tasks.onMarkTask(task.id, TASK_MARK.ARCHIVE) : undefined,
  );
  return (
    <>
      {button ? (
        <Tooltip label="Task actions">
          <IconButton
            icon={<EllipsisIcon />}
            label="Task actions"
            disabled={deletion.busy}
            {...actions.trigger()}
          />
        </Tooltip>
      ) : null}
      {actions.menu}
      {actions.dialog}
    </>
  );
}

/**
 * A task in the sidebar, pinned, listed, or archived alike: its name, in the
 * body's weight unless the task is unread, and at the row's end how long ago
 * it was last updated, led by one mark for a repository that belongs to
 * another workspace, an agent at work, or a pull request (`task-card.tsx`),
 * the first named in the row's card, before that a pencil while a draft
 * waits in one of its boxes and it is not the plan open, whose boxes show
 * their own words (`draft-mark.tsx`), and before that, on a task
 * someone else created, its creator's face (`teammateCreator`), read against
 * the members of the directory around the list; the reader's own tasks wear
 * none. Its repository's name, muted, where the list hands one (in one run),
 * and no face where its group is its creator's. Its time is the one the
 * list's order chooses. Pin
 * and Archive stand in place of all of it while the row is hovered or
 * reached from the keyboard.
 * A press opens it, and a right-click offers its actions where the pointer is. Renamed,
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
  face = true,
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
  /** The repository's name the row says, muted before its time, where the list hands one. */
  repository?: string | undefined;
  /** Whether a teammate's task wears its creator's face, which a group by creator says instead. */
  face?: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const rename = useInlineRename(task.id, tasks.onRenameTask);
  const actions = useTaskMenu(tasks, task.id, task.name, {
    rename: rename.begin,
    drawn: true,
    unread,
  });
  const teammate = teammateCreator(task, useMemberDirectory());
  const creator = face ? teammate : undefined;
  const drafted = usePlanDrafted(task.id) && !open;
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  // Note that the row's item is its press's parent, which its card counts as its control.
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const refocus = useRef(false);
  useEffect(() => {
    if (rename.editing || !refocus.current) return;
    refocus.current = false;
    row.current?.focus();
  }, [rename.editing]);
  // Note that the row is what the menu rings and hands focus back to, even
  // when the right-click lands on Pin or Archive over its end.
  const showMenu = actions.contextMenu(row);
  return (
    <>
      <RowHintOptions card={taskCardOf(tasks, task, now)} cardBeside cardRegion={item}>
        <ListRow
          ref={hold}
          density={LIST_DENSITY.DENSE}
          ink={LIST_ROW_INK.SIDEBAR}
          title={
            rename.editing ? (
              <InlineEdit
                value={task.name}
                label="Task name"
                maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
                editing
                onEnd={(edit) => {
                  refocus.current = edit.byKey;
                  rename.end(edit.value);
                }}
              />
            ) : (
              <>
                {task.name}
                {unread ? <span className="visually-hidden">(unread)</span> : null}
                {creator === undefined ? null : <CreatorHeard actor={creator} />}
              </>
            )
          }
          description={rename.refused ? <span role="alert">{RENAME_FAILED_NOTE}</span> : undefined}
          meta={
            rename.editing ? null : (
              <span className="sidebar-task-time">
                {repository === undefined ? null : (
                  <span className="sidebar-task-repository">{repository}</span>
                )}
                {creator === undefined ? null : (
                  <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
                )}
                {drafted ? <DraftMark /> : null}
                <TaskStatusMark task={task} stranded={strandedHome(tasks, task)} />
                <RelativeTime at={at} now={now} hint={false} />
              </span>
            )
          }
          current={current ? LIST_ROW_CURRENT.PAGE : undefined}
          unread={unread}
          menuOpen={actions.open}
          disabled={actions.deletion.busy}
          hint={rename.editing ? undefined : { Hint: RowHint, label: task.name }}
          onPress={
            rename.editing
              ? undefined
              : () => {
                  actions.close(false);
                  onOpen();
                }
          }
          onContextMenu={rename.editing ? undefined : showMenu}
          actionsShown={ACTIONS_SHOWN.ON_HOVER}
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
      {actions.menu}
      {actions.dialog}
    </>
  );
}
