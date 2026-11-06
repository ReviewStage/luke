import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
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
} from "@repo/features/task-wire";
import { noMatchWords, TERM } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  Breadcrumbs,
  CHIP_LOOK,
  CHIP_WIDTH,
  type Crumb,
  FailureNote,
  GAP,
  Inline,
  type MenuRow,
  POPOVER_ALIGN,
  TaskPriorityMark,
  TaskStatusMark,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ReplayUnmask, ReplayWords } from "@repo/ui/session-replay-marks";
import { type ReactNode, useState } from "react";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { useAppCommand } from "../app-commands.js";
import { failureShown } from "../failure-report.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { memberReadNote, memberRows } from "../member-rows.js";
import { Highlighted } from "../search-field.js";
import { Picker } from "../settings/picker-row.js";
import { useTaskCard } from "./chip-cards.js";
import { type RepositoryChooser, useRepositoryMenu } from "./repository-chip.js";
import { TaskRelationAsked, type TaskRelationsDoor } from "./task-relation-menu.js";

export const TASK_CARD_STANDING = "task-card-standing flex flex-wrap items-center gap-tight-gap";

export const TASK_STATUS_WORDS = {
  [TASK_STATUS.BACKLOG]: "Backlog",
  [TASK_STATUS.TODO]: "Todo",
  [TASK_STATUS.IN_PROGRESS]: "In progress",
  [TASK_STATUS.DONE]: "Done",
  [TASK_STATUS.CANCELED]: "Canceled",
} as const satisfies Record<TaskStatus, string>;

export const TASK_PRIORITY_WORDS = {
  [TASK_PRIORITY.NONE]: "No priority",
  [TASK_PRIORITY.URGENT]: "Urgent",
  [TASK_PRIORITY.HIGH]: "High",
  [TASK_PRIORITY.MEDIUM]: "Medium",
  [TASK_PRIORITY.LOW]: "Low",
} as const satisfies Record<TaskPriority, string>;

export const STATUS_ROWS: readonly MenuRow[] = TASK_STATUS_ORDER.map((status) => ({
  id: status,
  label: TASK_STATUS_WORDS[status],
  icon: <TaskStatusMark status={status} />,
}));

export const PRIORITY_ROWS: readonly MenuRow[] = TASK_PRIORITY_ORDER.map((priority) => ({
  id: priority,
  label: TASK_PRIORITY_WORDS[priority],
  icon: <TaskPriorityMark priority={priority} />,
}));

function statusOf(id: string): TaskStatus | undefined {
  return TASK_STATUS_ORDER.find((status) => status === id);
}

function priorityOf(id: string): TaskPriority | undefined {
  return TASK_PRIORITY_ORDER.find((priority) => priority === id);
}

export const NO_ASSIGNEE = "no-assignee";

export const NO_ASSIGNEE_WORDS = "No assignee";

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
      replayMasked: true,
    })),
  ];
}

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
      replayMasked: assignee !== undefined,
    },
  ];
}

function TaskAssigneePicker({
  assignee,
  onPick,
}: {
  assignee: TaskSummary["assignee"];
  onPick: ((assigneeId: string | null) => void) | undefined;
}): React.JSX.Element {
  const { members, readerId, reading, refused, retry } = useMemberDirectory();
  const person = usePerson(assignee);
  return (
    <Picker
      replayUnmasked
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
      placeholder="Assign to"
      noMatch={noMatchWords(TERM.MEMBER)}
      note={memberReadNote({ reading, refused, retry })}
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

export interface TaskRepositoryDoor {
  readonly chooser: RepositoryChooser;
  readonly onChoose: (repository: string) => void;
  readonly openRequest?: number | undefined;
  readonly onAsked?: ((request: number) => void) | undefined;
  readonly note?: string | undefined;
}

export interface TaskStandingDoor {
  readonly workspaceName: string;
  readonly onSet?: ((standing: TaskStanding) => void | Promise<void>) | undefined;
  readonly repository?: TaskRepositoryDoor | undefined;
  readonly tasks?: readonly TaskSummary[] | undefined;
  readonly onOpenTask?: ((taskId: string) => void) | undefined;
  readonly relations?: TaskRelationsDoor | undefined;
  readonly inSight?: boolean | undefined;
}

export function TaskKey({
  workspaceName,
  number,
  decorative = false,
  tokens,
}: {
  workspaceName: string | undefined;
  number: number | undefined;
  decorative?: boolean;
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

const PATH_LABEL = "Task path";

function parentOf(task: Task, tasks: readonly TaskSummary[]): TaskSummary | undefined {
  const parentId = tasks.find((each) => each.id === task.id)?.parentTaskId ?? task.parentTaskId;
  return parentId === undefined ? undefined : tasks.find((each) => each.id === parentId);
}

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

function keyCrumb(task: Task, workspaceName: string): Crumb | undefined {
  if (task.number === undefined) return undefined;
  return { label: taskKey(workspaceName, task.number), current: true, fixed: true };
}

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
  return (
    <div className="plan-task-path mb-ui-4">
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
  const repository: Crumb = { label: menu.label, glyph: menu.glyph, kept: true };
  return (
    <PathLine crumbs={[repository, ...rest]} room={menu.room} menu={menu.menu} note={door.note} />
  );
}

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
    <RepositoryPath key={task.id} task={task} door={door.repository} rest={rest} />
  );
}

function TaskStatusPicker({
  label = "Status",
  status,
  openRequest,
  onPick,
}: {
  label?: string | undefined;
  status: TaskStatus;
  openRequest?: number | undefined;
  onPick: ((status: TaskStatus) => void) | undefined;
}): React.JSX.Element {
  return (
    <ReplayUnmask>
      <Picker
        replayUnmasked
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
    </ReplayUnmask>
  );
}

export function TaskStandingChips({
  task,
  onSet,
  relations,
  inSight = true,
}: {
  task: Task;
  onSet: ((standing: TaskStanding) => void | Promise<void>) | undefined;
  relations?: TaskRelationsDoor | undefined;
  inSight?: boolean | undefined;
}): React.JSX.Element | null {
  const { status, priority } = task;
  const standing = status !== undefined && priority !== undefined;
  const [statusAsks, setStatusAsks] = useState(0);
  useAppCommand(
    APP_COMMAND.SET_STATUS,
    onSet !== undefined && standing && inSight
      ? () => setStatusAsks((asks) => asks + 1)
      : undefined,
  );
  const asked =
    relations === undefined ? null : (
      <TaskRelationAsked
        task={task}
        door={relations}
        ask={relations.ask}
        onAsked={relations.onAsked}
      />
    );
  if (status === undefined || priority === undefined) return asked;
  return (
    <div className="plan-task-standing">
      <Inline gap={GAP.TIGHT} className="-ms-chip-lead">
        <TaskStatusPicker
          status={status}
          openRequest={statusAsks}
          onPick={onSet === undefined ? undefined : (picked) => onSet({ status: picked })}
        />
        <ReplayUnmask>
          <Picker
            replayUnmasked
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
        </ReplayUnmask>
        <ReplayWords unmasked={task.assignee === undefined}>
          <TaskAssigneePicker
            assignee={task.assignee}
            onPick={onSet === undefined ? undefined : (assigneeId) => onSet({ assigneeId })}
          />
        </ReplayWords>
        {asked}
      </Inline>
    </div>
  );
}
