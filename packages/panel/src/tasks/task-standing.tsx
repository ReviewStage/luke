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
import { taskKey } from "@luke/features/workspace-key";
import type { WorkspaceMember } from "@luke/features/workspace-wire";
import {
  CHIP_WIDTH,
  GAP,
  Inline,
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
import type { MenuRow } from "../searchable-menu.js";
import { PICKER_ALIGN, Picker } from "../settings/picker-row.js";

/**
 * task-standing.tsx -- a task's key over its name, and the chips under it that say and change where it stands and how much it matters.
 *
 * The key is the task's workspace prefix and its number (`ACME-42`), drawn
 * small in monospace above the title, as the task's own page names it. Under
 * the title stand three chips, each dropping the window's own menu
 * (`picker-row.tsx`): the status, each of the five with its mark, the
 * priority, each with its bars, and the assignee, each member of the
 * workspace by face and name, the reader first, and No assignee on the
 * dashed unassigned mark. A pick is handed back for the page to send;
 * without a door to send it, as on an archived task, the chips only say.
 * A task from a service before statuses has no key and no chips.
 */

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
  const { members, readerId, membersReading } = useMemberDirectory();
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
      noMatch="No people match"
      note={membersReading ? <Spinner delay label="Reading members" /> : undefined}
      align={PICKER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      disabled={onPick === undefined}
      onPick={(id) => {
        const picked = id === NO_ASSIGNEE ? null : id;
        if (picked !== (assignee?.userId ?? null)) onPick?.(picked);
      }}
    />
  );
}

/** What the page hands the task's head: its workspace's name, which the key is drawn from, and the door a pick is sent through, none where the task takes no change. */
export interface TaskStandingDoor {
  readonly workspaceName: string;
  readonly onSet?: ((standing: TaskStanding) => void) | undefined;
}

/**
 * A task's key, “ACME-42”, as every place in the window draws it: the task's
 * page over its title, its hover card and an Inbox row's card at the head,
 * the Tasks list's row, and the board's card. Plain caption-size words in the
 * subtle ink, monospace with even figures, never a chip, and never shrunk by
 * what stands beside it, so a chip there gives way instead. Nothing for a
 * task from a service before keys, or where the window holds no such
 * workspace.
 */
export function TaskKey({
  workspaceName,
  number,
  decorative = false,
}: {
  workspaceName: string | undefined;
  number: number | undefined;
  /** Hidden from a screen reader, where the row says the key in words of its own. */
  decorative?: boolean;
}): React.JSX.Element | null {
  if (workspaceName === undefined || number === undefined) return null;
  return (
    <span className="task-key" data-task-key="" aria-hidden={decorative ? true : undefined}>
      <Text
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.SUBTLE}
        font={TEXT_FONT.MONO}
        as={TEXT_ELEMENT.SPAN}
      >
        {taskKey(workspaceName, number)}
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
      align={PICKER_ALIGN.START}
      width={CHIP_WIDTH.AUTO}
      disabled={onPick === undefined}
      onPick={(id) => {
        const picked = statusOf(id);
        if (picked !== undefined && picked !== status) onPick?.(picked);
      }}
    />
  );
}

/** The task's status, priority, and assignee chips, under its title; nothing for a task from a service before them. */
export function TaskStandingChips({
  task,
  onSet,
}: {
  task: Task;
  onSet: ((standing: TaskStanding) => void) | undefined;
}): React.JSX.Element | null {
  const { status, priority } = task;
  if (status === undefined || priority === undefined) return null;
  return (
    <div className="plan-task-standing">
      <Inline gap={GAP.CONTROL}>
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
          align={PICKER_ALIGN.START}
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
      </Inline>
    </div>
  );
}
