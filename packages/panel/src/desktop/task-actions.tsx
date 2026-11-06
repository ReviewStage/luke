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
import { useRowPlace, withRowMoves } from "./row-moves.js";
import { moveToSectionEntry, useSectionDialogs } from "./sidebar-sections.js";
import { chipSubmenu, keyedStatusSubmenu, STANDING_WORDS } from "./standing-submenus.js";
import {
  SIDEBAR_ROW_REPOSITORY,
  SIDEBAR_ROW_TIME,
  TaskRowStatus,
  taskCardOf,
} from "./task-card.js";
import { taskSubject, useStandingDoor } from "./task-row-parts.js";
import { ChosenTasksContext, chosenRowMenu } from "./tasks-selection.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

const tasksById = new WeakMap<readonly TaskSummary[], ReadonlyMap<string, TaskSummary>>();

function listedTask(list: readonly TaskSummary[], taskId: string): TaskSummary | undefined {
  let index = tasksById.get(list);
  if (index === undefined) {
    const built = new Map<string, TaskSummary>();
    for (const task of list) if (!built.has(task.id)) built.set(task.id, task);
    index = built;
    tasksById.set(list, index);
  }
  return index.get(taskId);
}

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
  readonly tasksNow: () => readonly TaskSummary[];
  readonly onCopyDescription: () => void;
  readonly onOpenHistory: TasksControl["history"]["onOpen"];
  readonly onOpenGitHub: TasksControl["repositories"]["openGitHub"];
  readonly pictures: boolean;
}

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

export function useTaskRowTab(tasks: TasksControl): TaskRowTab {
  const tasksNow = useSteadyDoor(() => tasks.tasks);
  return useSteadyDoors(taskRowTab(tasks, tasksNow));
}

export interface OpenedTask {
  readonly task: Task;
  readonly agents: AgentsControl;
}

export function openedTaskOf(
  tasks: Pick<TasksControl, "region" | "agents">,
): OpenedTask | undefined {
  const { region } = tasks;
  return region.kind === DOCUMENT_REGION.READY
    ? { task: region.task, agents: tasks.agents }
    : undefined;
}

function openedAs(opened: OpenedTask | undefined, taskId: string): OpenedTask | undefined {
  return opened?.task.id === taskId ? opened : undefined;
}

function rowTaskOf(
  list: readonly TaskSummary[],
  opened: OpenedTask | undefined,
  taskId: string,
): TaskSummary | undefined {
  return listedTask(list, taskId) ?? openedAs(opened, taskId)?.task;
}

export function taskOf(tasks: TasksControl, taskId: string): TaskSummary | undefined {
  return rowTaskOf(tasks.tasks, openedTaskOf(tasks), taskId);
}

interface PlaceMark {
  key: string;
  item: PanelCommand;
  onSelect: () => void;
}

function pinMark(tasks: Pick<TasksControl, "onMarkTask">, task: TaskSummary): PlaceMark {
  const marking = (mark: TaskMark) => () => tasks.onMarkTask(task.id, mark);
  return task.pinnedAt === undefined
    ? { key: TASK_MARK.PIN, item: PANEL_COMMAND.PIN_TASK, onSelect: marking(TASK_MARK.PIN) }
    : { key: TASK_MARK.UNPIN, item: PANEL_COMMAND.UNPIN_TASK, onSelect: marking(TASK_MARK.UNPIN) };
}

function placeMarks(tasks: TasksControl, task: TaskSummary): PlaceMark[] {
  const pin = pinMark(tasks, task);
  const done: PlaceMark = {
    key: SETTLED_STATUS.DONE,
    item: PANEL_COMMAND.MARK_TASK_DONE,
    onSelect: () => tasks.onSettleTasks([task.id], SETTLED_STATUS.DONE),
  };
  return settleOffered(task, SETTLED_STATUS.DONE) ? [pin, done] : [pin];
}

function pinAction(
  tasks: Pick<TasksControl, "onMarkTask">,
  task: TaskSummary | undefined,
  keyed: boolean,
): MenuAction[] {
  if (task === undefined) return [];
  const { item, onSelect } = pinMark(tasks, task);
  return [commandAction(item, onSelect, keyed)];
}

export interface RowMark {
  readonly key: string;
  readonly label: string;
  readonly icon: React.JSX.Element;
  readonly onSelect: () => void;
  readonly command?: KeyedCommand | undefined;
}

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

export interface StandingChips {
  status: boolean;
  priority: boolean;
  assignee: boolean;
}

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
    ...(chips?.assignee === true
      ? []
      : [
          {
            ...assigned,
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

function relationDoor(tasks: TaskRowTab, task: TaskSummary): TaskRelationDoor {
  return {
    workspaceName: tasks.workspaces.find((each) => each.id === task.workspaceId)?.name ?? "",
    tasks: tasks.tasksNow().filter((each) => each.workspaceId === task.workspaceId),
    onChange: (change) => tasks.onSetTaskBlock(task.id, change),
    onSetParent: tasks.onSetTaskParent,
    onNewTask: (kind) => tasks.onNewRelatedTask(task.id, kind),
  };
}

const MOVE_TO = "Move to";
const ANOTHER_WORKSPACE = "Another workspace";

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

export const TASK_MENU_SURFACE = {
  ROW: "row",
  DOCUMENT: "document",
} as const;

export type TaskMenuSurface = (typeof TASK_MENU_SURFACE)[keyof typeof TASK_MENU_SURFACE];

function taskActionGroups(
  tasks: TaskRowTab,
  task: TaskSummary | undefined,
  taskId: string,
  doors: {
    rename: () => void;
    askDelete: () => void;
    askMove: (() => void) | undefined;
    copy: (words: string, label: string) => void;
    chord: readonly string[];
    read: ReadMark;
    rowKeys: boolean;
    section: MenuEntry | undefined;
    standing: readonly MenuSubmenu[];
    relationId: string;
    opened: OpenedTask | undefined;
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
  const lettered = drawn || doors.rowKeys;
  const read: MenuAction[] = task === undefined ? [] : [markReadItem(doors.read, lettered)];
  const rename = renameTaskItem(doors.rename);
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

function TaskMenuFooter({
  tasks,
  task,
  opened,
}: {
  tasks: Pick<TaskRowTab, "me">;
  task: TaskSummary;
  opened: OpenedTask | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const reader = useEditReader({ readerId: tasks.me });
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;
  const you = account?.status === ACCOUNT_STATUS.SIGNED_IN ? accountActor(account) : undefined;
  const origin = useTaskMaker(task)?.actor;
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

function settledTask(task: TaskSummary | undefined): boolean {
  if (task === undefined) return false;
  return !settleOffered(task, SETTLED_STATUS.DONE) || !settleOffered(task, SETTLED_STATUS.CANCELED);
}

export function useTaskMenuItems(
  tasks: TaskRowTab,
  taskId: string,
  name: string,
  doors: {
    rename: () => void;
    drawn: boolean;
    unread: boolean;
    rowKeys?: boolean;
    surface: TaskMenuSurface;
    chips?: StandingChips | undefined;
    opened: OpenedTask | undefined;
  },
) {
  const opened = openedAs(doors.opened, taskId);
  const task = rowTaskOf(tasks.tasksNow(), opened, taskId);
  const markRead = useReadMark();
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
  const markDone =
    task !== undefined && settleOffered(task, SETTLED_STATUS.DONE)
      ? () => tasks.onSettleTasks([taskId], SETTLED_STATUS.DONE)
      : undefined;
  const moving = useMoveTaskDialog(tasks, task);
  const copy = useCopyToast();
  const chord = useChordLinks();
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

export type TaskMenuItems = ReturnType<typeof useTaskMenuItems>;

export function TaskActions({
  tasks,
  task,
  onRename,
  hand,
}: {
  tasks: TasksControl;
  task: TaskSummary;
  onRename: () => void;
  hand: React.RefObject<TaskMenuItems | undefined>;
}): React.JSX.Element {
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

export interface RowFaces {
  readonly creator: boolean;
  readonly assignee: boolean;
}

const EVERY_FACE: RowFaces = { creator: true, assignee: true };

function rowFaceOf(
  task: TaskSummary,
  reader: ReturnType<typeof useMemberDirectory>,
  faces: RowFaces,
): AssigneeFace | undefined {
  return faces.assignee ? assigneeFace(task, reader) : undefined;
}

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
  current: boolean;
  open?: boolean;
  unread: boolean;
  now: number;
  at?: number;
  repository?: React.ReactNode;
  faces?: RowFaces;
  depth?: number | undefined;
  nest?: ListRowNest | undefined;
  place?: VirtualRowPlace | undefined;
  fold?: ListRowFold | undefined;
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
  const row = useRef<HTMLElement | null>(null);
  const item = useRef<HTMLElement | null>(null);
  const hold = useCallback((press: HTMLElement | null) => {
    row.current = press;
    item.current = press?.parentElement ?? null;
  }, []);
  const endedByKey = useRefocusAfterEdit(rename.editing, row);
  const [statusAsks, setStatusAsks] = useState(0);
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
