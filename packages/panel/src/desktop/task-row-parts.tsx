import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskPriority,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  type ChipLook,
  ChipName,
  dropBelowStart,
  type MenuSubject,
  QUIET_MARK,
  QuietWords,
  STATUS_TONE,
  TaskPriorityMark,
  TaskStatusMark,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { actorName, creatorActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, actorCard } from "../actor-ref.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { useActorDoor } from "../person-door.js";
import { needsYouWords } from "../tasks/inbox-model.js";
import {
  NO_ASSIGNEE,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
  useAssigneeRows,
} from "../tasks/task-standing.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { ActionMenu } from "./action-menu.js";

const UNCHANGED_LINE = "The task could not be changed. Try again.";

export function statusOf(task: Pick<TaskSummary, "status">): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

export function taskSubject(
  task: Pick<TaskSummary, "name" | "status">,
  repository: string | undefined,
  key: string | undefined,
): MenuSubject {
  const status = statusOf(task);
  const detail = [repository, TASK_STATUS_WORDS[status], key].filter(
    (part): part is string => part !== undefined,
  );
  return { mark: <TaskStatusMark status={status} />, name: task.name, detail: detail.join(" · ") };
}

type ChipTask = Pick<TaskSummary, "status" | "priority" | "assignee">;

export function priorityOf(task: ChipTask): TaskPriority {
  return task.priority ?? TASK_PRIORITY.NONE;
}

export function standsAt(task: TaskSummary, standing: TaskStanding): boolean {
  if (standing.status !== undefined) return statusOf(task) === standing.status;
  if (standing.assigneeId !== undefined) {
    return (task.assignee?.userId ?? null) === standing.assigneeId;
  }
  return priorityOf(task) === standing.priority;
}

export function useStandingDoor(
  tasks: Pick<TasksControl, "onSetTaskStanding">,
): (task: TaskSummary, standing: TaskStanding, onRefused?: () => void) => Promise<void> {
  const toast = useToast();
  const { members } = useMemberDirectory();
  return (task, standing, onRefused) => {
    if (standsAt(task, standing)) return Promise.resolve();
    const named = members?.find((member) => member.userId === standing.assigneeId)?.name;
    return tasks.onSetTaskStanding(task.id, standing, named).then((kept) => {
      if (kept.kept) return;
      onRefused?.();
      toast({
        words: UNCHANGED_LINE,
        replayUnmasked: true,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: {
          surface: FAILURE_SURFACE.TASK_STANDING,
          cause: kept.cause,
          about: { taskId: task.id, workspaceId: task.workspaceId },
        },
      });
    });
  };
}

function StandingChip<T extends string>({
  label,
  value,
  order,
  words,
  mark,
  look,
  card,
  masked,
  onPick,
}: {
  label: string;
  value: T;
  order: readonly T[];
  words: Readonly<Record<T, string>>;
  mark: (value: T) => React.JSX.Element;
  look: ChipLook;
  card?: ReactNode;
  masked?: ((value: T) => boolean) | undefined;
  onPick: (value: T) => void;
}): React.JSX.Element {
  const { drawn, close, trigger } = useMenu(true);
  const name = `${label}: ${words[value]}`;
  const hidden = (each: T) => masked?.(each) === true;
  return (
    <>
      <Tooltip label={name} card={card}>
        <Chip
          look={look}
          size={CHIP_SIZE.COMPACT}
          iconOnly
          aria-label={name}
          {...trigger(dropBelowStart)}
        >
          {hidden(value) ? <ReplayMask>{mark(value)}</ReplayMask> : mark(value)}
          <ChipName>
            {hidden(value) ? <ReplayMask>{words[value]}</ReplayMask> : words[value]}
          </ChipName>
        </Chip>
      </Tooltip>
      {drawn === undefined ? null : (
        <ActionMenu
          label={label}
          menu={drawn}
          replayUnmasked
          groups={[
            order.map((each) => ({
              label: words[each],
              icon: hidden(each) ? <ReplayMask>{mark(each)}</ReplayMask> : mark(each),
              replayMasked: hidden(each),
              checked: each === value,
              onSelect: () => {
                if (each !== value) onPick(each);
              },
            })),
          ]}
          onClose={close}
        />
      )}
    </>
  );
}

export function PriorityChip({
  task,
  look,
  onStanding,
}: {
  task: ChipTask;
  look: ChipLook;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  return (
    <StandingChip
      label="Priority"
      value={priorityOf(task)}
      order={TASK_PRIORITY_ORDER}
      words={TASK_PRIORITY_WORDS}
      mark={(priority) => <TaskPriorityMark priority={priority} />}
      look={look}
      onPick={(priority) => onStanding({ priority })}
    />
  );
}

export function AssigneeChip({
  task,
  look,
  onStanding,
}: {
  task: ChipTask;
  look: ChipLook;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const person = usePerson(task.assignee);
  const value = task.assignee?.userId ?? NO_ASSIGNEE;
  const rows = useAssigneeRows(task.assignee);
  const words = Object.fromEntries(rows.map((row) => [row.id, row.label]));
  const icons = new Map(rows.map((row) => [row.id, row.icon]));
  return (
    <StandingChip
      label="Assignee"
      value={value}
      order={rows.map((row) => row.id)}
      words={words}
      mark={(id) => <>{icons.get(id)}</>}
      look={look}
      card={task.assignee === undefined ? undefined : actorCard(person)}
      masked={(id) => id !== NO_ASSIGNEE}
      onPick={(id) => onStanding({ assigneeId: id === NO_ASSIGNEE ? null : id })}
    />
  );
}

export function StatusChip({
  task,
  look,
  onStanding,
}: {
  task: ChipTask;
  look: ChipLook;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  return (
    <StandingChip
      label="Status"
      value={statusOf(task)}
      order={TASK_STATUS_ORDER}
      words={TASK_STATUS_WORDS}
      mark={(status) => <TaskStatusMark status={status} />}
      look={look}
      onPick={(status) => onStanding({ status })}
    />
  );
}

export function WaitingCount({ count }: { count: number }): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <QuietWords mark={QUIET_MARK.ATTENTION} label={needsYouWords(count)}>
      {count}
    </QuietWords>
  );
}

export function CreatorFace({
  task,
  onOpen,
}: {
  task: TaskSummary;
  onOpen: () => void;
}): React.JSX.Element {
  const creator = creatorActor(task, useMemberDirectory(), undefined);
  const maker = useTaskMaker(task);
  const shown = maker?.actor ?? creator;
  const door = useActorDoor(creator);
  return (
    <Tooltip label={actorName(shown)} card={actorCard(shown)}>
      <Chip
        look={CHIP_LOOK.TOOLBAR}
        size={CHIP_SIZE.COMPACT}
        iconOnly
        data-task-creator=""
        onClick={door ?? onOpen}
      >
        <ReplayMask>
          <ActorMark
            actor={shown}
            size={ACTOR_SIZE.MARK}
            forWhom={maker === undefined ? undefined : creator}
          />
          <ChipName>{actorName(shown)}</ChipName>
        </ReplayMask>
      </Chip>
    </Tooltip>
  );
}
