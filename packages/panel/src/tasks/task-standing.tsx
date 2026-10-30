import { FAILURE_CONDITION, FAILURE_SURFACE } from "@luke/features/shown-failure";
import {
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type Task,
  type TaskPriority,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { noMatchWords, readFailedWords, TERM } from "@luke/features/words";
import { taskKey } from "@luke/features/workspace-key";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BREADCRUMB_POPUP,
  Breadcrumbs,
  CHIP_LOOK,
  CHIP_WIDTH,
  type Crumb,
  ErrorState,
  FailureNote,
  FrameHead,
  type FrameHeadTask,
  GAP,
  Inline,
  type MenuRow,
  POPOVER_ALIGN,
  Spinner,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { type ReactNode, useState } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { failureShown, unreadShown } from "../failure-report.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { memberRows } from "../member-rows.js";
import { Highlighted } from "../search-field.js";
import { Picker } from "../settings/picker-row.js";
import { useTaskCard } from "./chip-cards.js";
import {
  type RepositoryChooser,
  type RepositoryMenu,
  useRepositoryMenu,
} from "./repository-chip.js";
import { TaskBlockAdd, TaskBlockLines, type TaskBlocksDoor } from "./task-blocks.js";

/**
 * task-standing.tsx -- a task's head over its plan: the path to it, then the chips that say and change where it stands, how much it matters, and who is on it.
 *
 * Over the title stands the task's path (`TaskPath`), a caption-size
 * `Breadcrumbs`: its repository, the owner's picture and `owner/name`, or
 * Choose a repository while the task has none, which drops the search over
 * every repository the workspace reaches (`repository-chip.tsx`), and which
 * ⌘K's Change repository opens the same way; then the task it is a child
 * of, where it has one, by its status mark, key and name, which opens it
 * and hangs its card; then its own key (`ACME-42`), where the reader stands.
 * Under the title stand three chips on one line, each a toolbar's chip,
 * quiet until the pointer is on it or its menu is open, dropping the
 * window's own menu (`picker-row.tsx`): the status, each of the five with
 * its mark, the priority, each with its bars, and the assignee, each member
 * of the workspace by face and name, the reader first, and No assignee on
 * the dashed unassigned mark; then, where the page hands their door, Add
 * relation, until the task's menu adds a block instead, with the task's
 * blocks on lines of their own under the chips (`task-blocks.tsx`). A pick
 * is handed back for the page to send; without a door to send it, as on an
 * archived task, the chips only say. S, pressed while not typing, opens the
 * status chip's menu, as Linear's S does, and a task row's menu lists what
 * each chip lists (`standing-submenus.tsx`). Where its agents run is said
 * on each agent's row instead (`plan-agents.tsx`).
 * A task from a service before statuses has no key and no chips.
 */

/**
 * A task's card's lead, where it stands: its key, its status, its priority,
 * and who is on it, each a Badge of its mark and its words, wrapping where
 * the card is narrow. An Inbox row's card holds it on one line instead.
 */
export const TASK_CARD_STANDING = "task-card-standing flex flex-wrap items-center gap-tight-gap";

/** Each status as its chip, its menu's row, the Board's column, and the sidebar's filter say it. */
export const TASK_STATUS_WORDS = {
  [TASK_STATUS.BACKLOG]: "Backlog",
  [TASK_STATUS.TODO]: "Todo",
  [TASK_STATUS.IN_PROGRESS]: "In progress",
  [TASK_STATUS.DONE]: "Done",
  [TASK_STATUS.CANCELED]: "Canceled",
} as const satisfies Record<TaskStatus, string>;

/** Each priority as its chip, its menu's row, and a Board card's say it. */
export const TASK_PRIORITY_WORDS = {
  [TASK_PRIORITY.NONE]: "No priority",
  [TASK_PRIORITY.URGENT]: "Urgent",
  [TASK_PRIORITY.HIGH]: "High",
  [TASK_PRIORITY.MEDIUM]: "Medium",
  [TASK_PRIORITY.LOW]: "Low",
} as const satisfies Record<TaskPriority, string>;

/** The status chip's rows, each status by its mark, which a task row's Status submenu lists too. */
export const STATUS_ROWS: readonly MenuRow[] = TASK_STATUS_ORDER.map((status) => ({
  id: status,
  label: TASK_STATUS_WORDS[status],
  icon: <TaskStatusMark status={status} />,
}));

/** The priority chip's rows, each priority by its bars, which a task row's Priority submenu lists too. */
export const PRIORITY_ROWS: readonly MenuRow[] = TASK_PRIORITY_ORDER.map((priority) => ({
  id: priority,
  label: TASK_PRIORITY_WORDS[priority],
  icon: <TaskPriorityMark priority={priority} />,
}));

/** The status a picked row names; none for a row that names no status. */
function statusOf(id: string): TaskStatus | undefined {
  return TASK_STATUS_ORDER.find((status) => status === id);
}

/** The priority a picked row names; none for a row that names no priority. */
function priorityOf(id: string): TaskPriority | undefined {
  return TASK_PRIORITY_ORDER.find((priority) => priority === id);
}

/** The row of the assignee's menu that assigns the task to no one, apart from every account's id. */
export const NO_ASSIGNEE = "no-assignee";

/** What the assignee's chip and its first row say of a task no one is assigned to, as its hover card does, and what the Tasks page calls the tasks with none. */
export const NO_ASSIGNEE_WORDS = "No assignee";

/**
 * The assignee's menu: No assignee, then the workspace's members as every
 * people menu lists them (`memberRows`), each hanging their card; only No assignee while the members
 * are unread. The Tasks page's compact assignee chip drops the same rows.
 */
export function assigneeRows(
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
): readonly MenuRow[] {
  return [
    {
      id: NO_ASSIGNEE,
      label: NO_ASSIGNEE_WORDS,
      icon: <UnassignedMark size={ACTOR_SIZE.INLINE} decorative />,
    },
    ...memberRows(members, readerId).map((row) => ({
      id: row.member.userId,
      label: row.label,
      icon: row.icon,
      detail: row.detail,
      terms: row.terms,
      card: row.card,
    })),
  ];
}

/**
 * The assignee's menu for a task (`assigneeRows`), with the member it is
 * assigned to after them where the members do not name them, as while they
 * are unread, so they still stand checked by the name the task carries: what
 * a row's assignee chip and a task row's Assignee submenu both list.
 */
export function useAssigneeRows(assignee: TaskSummary["assignee"]): readonly MenuRow[] {
  const { members, readerId } = useMemberDirectory();
  const person = usePerson(assignee);
  const value = assignee?.userId ?? NO_ASSIGNEE;
  const listed = assigneeRows(members, readerId);
  if (listed.some((row) => row.id === value)) return listed;
  return [
    ...listed,
    {
      id: value,
      label: assignee?.name ?? NO_ASSIGNEE_WORDS,
      icon: <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />,
    },
  ];
}

/**
 * The assignee chip: the member the task is assigned to by face and name, or
 * No assignee, dropping the workspace's members (`assigneeRows`); a pick of
 * anyone else is handed to `onPick` by their id, and No assignee as null.
 */
function TaskAssigneePicker({
  assignee,
  onPick,
}: {
  assignee: TaskSummary["assignee"];
  /** Where a pick is sent; without one the chip only says. */
  onPick: ((assigneeId: string | null) => void) | undefined;
}): React.JSX.Element {
  const { members, readerId, membersReading, membersRefused, retry } = useMemberDirectory();
  const person = usePerson(assignee);
  return (
    <Picker
      label="Assignee"
      value={assignee?.userId ?? NO_ASSIGNEE}
      valueLabel={assignee?.name ?? NO_ASSIGNEE_WORDS}
      valueIcon={
        assignee === undefined ? (
          <UnassignedMark size={ACTOR_SIZE.INLINE} decorative />
        ) : (
          <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />
        )
      }
      rows={assigneeRows(members, readerId)}
      placeholder="Assign to…"
      noMatch={noMatchWords(TERM.MEMBER)}
      note={
        membersRefused ? (
          <ErrorState failure={unreadShown(FAILURE_SURFACE.MEMBERS_READ)} onRetry={retry}>
            {readFailedWords(TERM.MEMBER.many)}
          </ErrorState>
        ) : membersReading ? (
          <Spinner delay label="Reading members" />
        ) : undefined
      }
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      look={CHIP_LOOK.TOOLBAR}
      disabled={onPick === undefined}
      onPick={(id) => {
        const picked = id === NO_ASSIGNEE ? null : id;
        if (picked !== (assignee?.userId ?? null)) onPick?.(picked);
      }}
    />
  );
}

/** The repository crumb's doors, as the page hands them: what its menu offers, where a pick is sent, the asks from elsewhere to open its menu, and why the service refused the last pick, said beside it. */
export interface TaskRepositoryDoor {
  readonly chooser: RepositoryChooser;
  readonly onChoose: (repository: string) => void;
  /** Counts the asks from elsewhere to open the menu, ⌘K's Change repository, each opening it. */
  readonly openRequest?: number | undefined;
  /** Hears each ask the crumb opened its menu for, so the page lets it go. */
  readonly onAsked?: ((request: number) => void) | undefined;
  /** Why the service refused the last pick; none once one is kept. */
  readonly note?: string | undefined;
}

/** What the page hands the task's head: its workspace's name, which the keys are drawn from, the door a pick is sent through, none where the task takes no change, the repository crumb's doors, none where the task's repository is not changed from here, and the workspace's tasks, which name its parent. */
export interface TaskStandingDoor {
  readonly workspaceName: string;
  /** Settles once the service has answered, where the page waits on it. */
  readonly onSet?: ((standing: TaskStanding) => void | Promise<void>) | undefined;
  readonly repository?: TaskRepositoryDoor | undefined;
  /** The workspace's tasks, which name the task's parent in its path; none where it is not named. */
  readonly tasks?: readonly TaskSummary[] | undefined;
  /** Opens a task, as a press on the parent's crumb does; none where it opens nothing. */
  readonly onOpenTask?: ((taskId: string) => void) | undefined;
  /** The task's blocks' door: the tasks they name, where a press opens one, and where a change is sent; none where they are not drawn. */
  readonly blocks?: TaskBlocksDoor | undefined;
  /** Whether the plan is in sight, which S's ask waits on, so it never opens a menu behind another tab; in sight where unsaid. */
  readonly inSight?: boolean | undefined;
}

/**
 * A task's key, “ACME-42”, as every place in the window draws it: the task's
 * page over its title, its hover card and an Inbox row's card at the head,
 * the Tasks list's row, the board's card, and ⌘K's row, where the words
 * typed that found it are marked in it. Plain caption-size words in the
 * muted ink, monospace with even figures, never a chip, and never shrunk by
 * what stands beside it, so a chip there gives way instead. Nothing for a
 * task from a service before keys, or where the window holds no such
 * workspace.
 */
export function TaskKey({
  workspaceName,
  number,
  decorative = false,
  tokens,
}: {
  workspaceName: string | undefined;
  number: number | undefined;
  /** Hidden from a screen reader, where the row says the key in words of its own. */
  decorative?: boolean;
  /** The words a search typed, marked where the key holds them. */
  tokens?: readonly string[] | undefined;
}): React.JSX.Element | null {
  if (workspaceName === undefined || number === undefined) return null;
  return (
    <span
      className="task-key inline-flex shrink-0 items-center whitespace-nowrap tabular-nums"
      data-task-key=""
      aria-hidden={decorative ? true : undefined}
    >
      <Text
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.MUTED}
        font={TEXT_FONT.MONO}
        as={TEXT_ELEMENT.SPAN}
      >
        <Highlighted text={taskKey(workspaceName, number)} tokens={tokens} />
      </Text>
    </span>
  );
}

/** What the path is named for a reader moving between landmarks. */
const PATH_LABEL = "Task path";

/**
 * The task the open one is a child of, as the workspace's tasks list it: by
 * the open task's own row's parent where the list holds it, else by the
 * plan's; none for a task at the top, or one whose parent the list does not
 * hold yet.
 */
function parentOf(task: Task, tasks: readonly TaskSummary[]): TaskSummary | undefined {
  const parentId = tasks.find((each) => each.id === task.id)?.parentTaskId ?? task.parentTaskId;
  return parentId === undefined ? undefined : tasks.find((each) => each.id === parentId);
}

/**
 * The tasks the open one is a child of, as the workspace's tasks list them,
 * eldest first; none for a task at the top. Note that a task met twice ends
 * the walk, so a parent the list holds in a loop names each task once.
 */
function ancestorsOf(task: Task, tasks: readonly TaskSummary[]): readonly TaskSummary[] {
  const found: TaskSummary[] = [];
  const met = new Set([task.id]);
  for (let at = parentOf(task, tasks); at !== undefined && !met.has(at.id); ) {
    met.add(at.id);
    found.unshift(at);
    const parentId = at.parentTaskId;
    at = parentId === undefined ? undefined : tasks.find((each) => each.id === parentId);
  }
  return found;
}

/** The parent's crumb: its status mark, then its key and name, which opens it and hangs its card. */
function useParentCrumb(
  parent: TaskSummary | undefined,
  workspaceName: string,
  onOpen: ((taskId: string) => void) | undefined,
): Crumb | undefined {
  const card = useTaskCard(parent?.id);
  if (parent === undefined) return undefined;
  const key = parent.number === undefined ? undefined : taskKey(workspaceName, parent.number);
  return {
    label: key === undefined ? parent.name : `${key} ${parent.name}`,
    glyph: parent.status === undefined ? undefined : <TaskStatusMark status={parent.status} />,
    hint: parent.name,
    card,
    onPress: onOpen === undefined ? undefined : () => onOpen(parent.id),
  };
}

/** The key's crumb, where the reader stands, kept whole however narrow the path; none for a task from a service before keys. */
function keyCrumb(task: Task, workspaceName: string): Crumb | undefined {
  if (task.number === undefined) return undefined;
  return { label: taskKey(workspaceName, task.number), current: true, fixed: true };
}

/** The path's line: its crumbs, the menu a crumb drops hung from the line's own box, and the refusal of the last pick under it. */
function PathLine({
  crumbs,
  room,
  menu,
  note,
}: {
  crumbs: readonly (Crumb | undefined)[];
  room?: React.RefObject<HTMLDivElement | null> | undefined;
  menu?: ReactNode;
  note?: string | undefined;
}): React.JSX.Element | null {
  const drawn = crumbs.filter((crumb) => crumb !== undefined);
  if (drawn.length === 0) return null;
  // Note that the menu hangs from the line rather than from its crumb, because the path clips what stands inside it,
  // and that the line is pulled back by a crumb's inset, so its first mark stands on the title's edge.
  return (
    <div className="plan-task-path mb-luke-4">
      <div className="relative -ms-breadcrumb-pill-inline flex min-w-0" ref={room}>
        <Breadcrumbs label={PATH_LABEL} crumbs={drawn} />
        {menu}
      </div>
      {note === undefined ? null : (
        <FailureNote
          failure={failureShown({
            surface: FAILURE_SURFACE.REPOSITORY_PIN,
            cause: FAILURE_CONDITION.REFUSED,
            refused: true,
          })}
        >
          {note}
        </FailureNote>
      )}
    </div>
  );
}

/** The repository's crumb, which drops its menu, named by the repository or the pick it waits on. */
function repositoryCrumb(menu: RepositoryMenu, repository: Task["repository"]): Crumb {
  return {
    label: menu.label,
    glyph: menu.glyph,
    hint: menu.open ? undefined : (repository ?? undefined),
    card: menu.card,
    popup: BREADCRUMB_POPUP.DIALOG,
    expanded: menu.open,
    onPress: menu.press,
  };
}

/** The path led by the task's repository, whose crumb drops the repository's menu (`useRepositoryMenu`). */
function RepositoryPath({
  task,
  door,
  rest,
}: {
  task: Task;
  door: TaskRepositoryDoor;
  rest: readonly (Crumb | undefined)[];
}): React.JSX.Element | null {
  const menu = useRepositoryMenu({
    value: task.repository,
    chooser: door.chooser,
    onChoose: door.onChoose,
    openRequest: door.openRequest,
    onAsked: door.onAsked,
    align: POPOVER_ALIGN.START,
  });
  const repository = repositoryCrumb(menu, task.repository);
  return (
    <PathLine crumbs={[repository, ...rest]} room={menu.room} menu={menu.menu} note={door.note} />
  );
}

/**
 * The task's path over its title: its repository's crumb where the page
 * hands the repository's doors, its parent's where it has one, and its own
 * key, current; nothing where none of them stands.
 */
export function TaskPath({
  task,
  door,
}: {
  task: Task;
  door: TaskStandingDoor;
}): React.JSX.Element | null {
  const parent = useParentCrumb(
    parentOf(task, door.tasks ?? []),
    door.workspaceName,
    door.onOpenTask,
  );
  const rest = [parent, keyCrumb(task, door.workspaceName)];
  return door.repository === undefined ? (
    <PathLine crumbs={rest} />
  ) : (
    // Keyed by the task, so another task starts the crumb's menu afresh and the same task keeps it.
    <RepositoryPath key={task.id} task={task} door={door.repository} rest={rest} />
  );
}

/** A task as the window's title bar names it: its mark, name, and key, its press, and its card. */
function frameTask(
  task: {
    readonly name: string;
    readonly status?: TaskStatus | undefined;
    readonly number?: number | undefined;
  },
  workspaceName: string,
  onOpen: () => void,
  card?: ReactNode,
): FrameHeadTask {
  return {
    name: task.name,
    taskKey: task.number === undefined ? undefined : taskKey(workspaceName, task.number),
    status: task.status,
    onOpen,
    card,
  };
}

/**
 * The task's head in the window's title bar (`FrameHead`): its repository's
 * crumb where the page hands the repository's doors, dropping the menu the
 * plan's path drops; the tasks it is a child of, eldest first, each opening
 * its own task, the parent hanging its card; then the task, whose press is
 * `onOpen`, its Overview. Note that ⌘K's Change repository stays the plan's path's to
 * answer, so one ask never opens two menus.
 */
export function TaskFrameHead({
  task,
  shown,
  door,
  onOpen,
}: {
  task: Task;
  /** The task as the list draws it now, its name and status. */
  shown: Pick<TaskSummary, "name" | "status">;
  door: TaskStandingDoor;
  onOpen: () => void;
}): React.JSX.Element {
  const ancestors = ancestorsOf(task, door.tasks ?? []);
  const parentCard = useTaskCard(ancestors.at(-1)?.id);
  const { workspaceName, onOpenTask } = door;
  const drawn = {
    ancestors: ancestors.map((each, at) =>
      frameTask(
        each,
        workspaceName,
        () => onOpenTask?.(each.id),
        at === ancestors.length - 1 ? parentCard : undefined,
      ),
    ),
    head: frameTask({ ...shown, number: task.number }, workspaceName, onOpen),
  };
  return door.repository === undefined ? (
    <FrameHead ancestors={drawn.ancestors} task={drawn.head} />
  ) : (
    // Keyed by the task, so another task starts the crumb's menu afresh and the same task keeps it.
    <RepositoryFrameHead key={task.id} task={task} door={door.repository} {...drawn} />
  );
}

/** The title bar's head led by the task's repository, whose crumb drops the repository's menu (`useRepositoryMenu`). */
function RepositoryFrameHead({
  task,
  door,
  ancestors,
  head,
}: {
  task: Task;
  door: TaskRepositoryDoor;
  ancestors: readonly FrameHeadTask[];
  head: FrameHeadTask;
}): React.JSX.Element {
  const menu = useRepositoryMenu({
    value: task.repository,
    chooser: door.chooser,
    onChoose: door.onChoose,
    align: POPOVER_ALIGN.START,
  });
  const repository = repositoryCrumb(menu, task.repository);
  return (
    <FrameHead
      repository={repository}
      ancestors={ancestors}
      task={head}
      room={menu.room}
      menu={menu.menu}
    />
  );
}

/**
 * A status chip dropping the five statuses, each with its mark, the one
 * `status` names checked; a pick other than it is handed to `onPick`.
 */
function TaskStatusPicker({
  label = "Status",
  status,
  openRequest,
  onPick,
}: {
  /** The chip's name for a reader; the task page's own where none is named. */
  label?: string | undefined;
  status: TaskStatus;
  /** Counts the S key's asks to open the menu, each opening it. */
  openRequest?: number | undefined;
  /** Where a pick is sent; without one the chip only says. */
  onPick: ((status: TaskStatus) => void) | undefined;
}): React.JSX.Element {
  return (
    <Picker
      label={label}
      value={status}
      valueLabel={TASK_STATUS_WORDS[status]}
      valueIcon={<TaskStatusMark status={status} />}
      rows={STATUS_ROWS}
      noMatch="No statuses match"
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      look={CHIP_LOOK.TOOLBAR}
      disabled={onPick === undefined}
      openRequest={openRequest}
      onPick={(id) => {
        const picked = statusOf(id);
        if (picked !== undefined && picked !== status) onPick?.(picked);
      }}
    />
  );
}

/**
 * The task's status, priority, and assignee chips on one line under its
 * title, each a toolbar's chip, then Add relation, and under them the
 * task's blocks, where the page hands their door. A task from a service before statuses draws no
 * chips, and still its blocks.
 */
export function TaskStandingChips({
  task,
  onSet,
  blocks,
  inSight = true,
}: {
  task: Task;
  /** Where a pick is sent, settling once the service has answered where the page waits on it; without one the chips only say. */
  onSet: ((standing: TaskStanding) => void | Promise<void>) | undefined;
  /** The task's blocks' door; without it no block is drawn. */
  blocks?: TaskBlocksDoor | undefined;
  /** Whether the plan is in sight, which S waits on, so it never opens a menu behind another tab. */
  inSight?: boolean | undefined;
}): React.JSX.Element | null {
  const { status, priority } = task;
  const standing = status !== undefined && priority !== undefined;
  // S opens the status chip's menu while the chip is in sight and takes a pick, each press counted so it opens it again.
  const [statusAsks, setStatusAsks] = useState(0);
  useAppCommand(
    APP_COMMAND.SET_STATUS,
    onSet !== undefined && standing && inSight
      ? () => setStatusAsks((asks) => asks + 1)
      : undefined,
  );
  const lines = blocks === undefined ? null : <TaskBlockLines task={task} door={blocks} />;
  if (status === undefined || priority === undefined) return lines;
  return (
    <div className="plan-task-standing">
      {/* Note that the line is pulled back by a chip's inset, so the status's mark stands on the title's edge. */}
      <Inline gap={GAP.TIGHT} className="-ms-chip-lead">
        <TaskStatusPicker
          status={status}
          openRequest={statusAsks}
          onPick={onSet === undefined ? undefined : (picked) => onSet({ status: picked })}
        />
        <Picker
          label="Priority"
          value={priority}
          valueLabel={TASK_PRIORITY_WORDS[priority]}
          valueIcon={<TaskPriorityMark priority={priority} />}
          rows={PRIORITY_ROWS}
          noMatch="No priorities match"
          align={POPOVER_ALIGN.START}
          width={CHIP_WIDTH.AUTO}
          look={CHIP_LOOK.TOOLBAR}
          disabled={onSet === undefined}
          onPick={(id) => {
            const picked = priorityOf(id);
            if (picked !== undefined && picked !== priority) onSet?.({ priority: picked });
          }}
        />
        <TaskAssigneePicker
          assignee={task.assignee}
          onPick={onSet === undefined ? undefined : (assigneeId) => onSet({ assigneeId })}
        />
        {blocks?.onChange === undefined ? null : (
          <TaskBlockAdd task={task} door={blocks} onChange={blocks.onChange} />
        )}
      </Inline>
      {lines}
    </div>
  );
}
