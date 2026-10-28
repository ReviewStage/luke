import type { MacOffer } from "@luke/features/models-wire";
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
import { EXPERIMENT } from "@luke/settings";
import {
  CHIP_WIDTH,
  ErrorState,
  FailureNote,
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
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { memberRows } from "../member-rows.js";
import { Highlighted } from "../search-field.js";
import { Picker } from "../settings/picker-row.js";
import { useExperiment } from "../use-app-state.js";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "./repository-chip.js";
import { TaskRunsOnChip } from "./runs-on.js";

/**
 * task-standing.tsx -- a task's key over its name, and the chips under it that say and change where it stands, how much it matters, which repository it is about, and where its agents run.
 *
 * The key is the task's workspace prefix and its number (`ACME-42`), drawn
 * small in monospace above the title, as the task's own page names it. Under
 * the title stand three chips, each dropping the window's own menu
 * (`picker-row.tsx`): the status, each of the five with its mark, the
 * priority, each with its bars, and the assignee, each member of the
 * workspace by face and name, the reader first, and No assignee on the
 * dashed unassigned mark; then, where the page hands its doors, the
 * repository's chip (`repository-chip.tsx`), the owner's picture and
 * `owner/name`, or Choose a repository while the task has none, which drops
 * the search over every repository the workspace reaches, and which ⌘K's
 * Change repository opens the same way; and, while local agents are on, a
 * fifth for where its agents run (`runs-on.tsx`). A pick is handed back for the page to send;
 * without a door to send it, as on an archived task, the chips only say.
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

const STATUS_ROWS: readonly MenuRow[] = TASK_STATUS_ORDER.map((status) => ({
  id: status,
  label: TASK_STATUS_WORDS[status],
  icon: <TaskStatusMark status={status} />,
}));

const PRIORITY_ROWS: readonly MenuRow[] = TASK_PRIORITY_ORDER.map((priority) => ({
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
          <ErrorState onRetry={retry}>{readFailedWords(TERM.MEMBER.many)}</ErrorState>
        ) : membersReading ? (
          <Spinner delay label="Reading members" />
        ) : undefined
      }
      align={POPOVER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      disabled={onPick === undefined}
      onPick={(id) => {
        const picked = id === NO_ASSIGNEE ? null : id;
        if (picked !== (assignee?.userId ?? null)) onPick?.(picked);
      }}
    />
  );
}

/** The repository chip's doors, as the page hands them: what its menu offers, where a pick is sent, the asks from elsewhere to open its menu, and why the service refused the last pick, said beside it. */
export interface TaskRepositoryDoor {
  readonly chooser: RepositoryChooser;
  readonly onChoose: (repository: string) => void;
  /** Counts the asks from elsewhere to open the menu, ⌘K's Change repository, each opening it. */
  readonly openRequest?: number | undefined;
  /** Hears each ask the chip opened its menu for, so the page lets it go. */
  readonly onAsked?: ((request: number) => void) | undefined;
  /** Why the service refused the last pick; none once one is kept. */
  readonly note?: string | undefined;
}

/** What the page hands the task's head: its workspace's name, which the key is drawn from, the door a pick is sent through, none where the task takes no change, the repository chip's doors, none where the task's repository is not changed from here, and the member's devices, as the models answer last listed them, which say whether a cloud task shows its Runs on. */
export interface TaskStandingDoor {
  readonly workspaceName: string;
  readonly onSet?: ((standing: TaskStanding) => void) | undefined;
  readonly repository?: TaskRepositoryDoor | undefined;
  readonly devices?: readonly MacOffer[] | undefined;
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

/** The task's key over its title (`TaskKey`); nothing for a task from a service before keys. */
export function TaskKeyLine({
  task,
  workspaceName,
}: {
  task: Task;
  workspaceName: string;
}): React.JSX.Element | null {
  if (task.number === undefined) return null;
  return (
    <div className="plan-task-key">
      <TaskKey workspaceName={workspaceName} number={task.number} />
    </div>
  );
}

/**
 * A status chip dropping the five statuses, each with its mark, the one
 * `status` names checked; a pick other than it is handed to `onPick`.
 */
function TaskStatusPicker({
  label = "Status",
  status,
  onPick,
}: {
  /** The chip's name for a reader; the task page's own where none is named. */
  label?: string | undefined;
  status: TaskStatus;
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
      disabled={onPick === undefined}
      onPick={(id) => {
        const picked = statusOf(id);
        if (picked !== undefined && picked !== status) onPick?.(picked);
      }}
    />
  );
}

/**
 * The task's status, priority, and assignee chips, under its title, its
 * repository's where the page hands the chip's doors, with the service's
 * refusal of the last pick beside it, and where its agents run while the
 * Local agents experiment is on and the member has a device or the task
 * runs on one. A task from a service before statuses draws none of the
 * standing chips, and still its repository's, which does not wait on them,
 * since the plan's menu leaves Change repository to the chip.
 */
export function TaskStandingChips({
  task,
  onSet,
  repository,
  devices,
}: {
  task: Task;
  onSet: ((standing: TaskStanding) => void) | undefined;
  repository?: TaskRepositoryDoor | undefined;
  devices?: readonly MacOffer[] | undefined;
}): React.JSX.Element | null {
  const { status, priority } = task;
  const localAgents = useExperiment(EXPERIMENT.LOCAL_AGENTS);
  const standing = status !== undefined && priority !== undefined;
  if (!standing && repository === undefined) return null;
  const runsOnDrawn =
    standing &&
    localAgents &&
    ((devices !== undefined && devices.length > 0) || task.runsOn !== undefined);
  return (
    <div className="plan-task-standing">
      <Inline gap={GAP.CONTROL}>
        {status === undefined || priority === undefined ? null : (
          <>
            <TaskStatusPicker
              status={status}
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
          </>
        )}
        {repository === undefined ? null : (
          // Keyed by the task, so another task starts the chip and its menu afresh and the same task keeps them.
          <RepositoryChip
            key={task.id}
            place={CHIP_PLACE.FIELD}
            value={task.repository}
            chooser={repository.chooser}
            onChoose={repository.onChoose}
            openRequest={repository.openRequest}
            onAsked={repository.onAsked}
            align={POPOVER_ALIGN.START}
            width={CHIP_WIDTH.AUTO}
          />
        )}
        {repository?.note === undefined ? null : <FailureNote>{repository.note}</FailureNote>}
        {runsOnDrawn ? <TaskRunsOnChip runsOn={task.runsOn} /> : null}
      </Inline>
    </div>
  );
}
