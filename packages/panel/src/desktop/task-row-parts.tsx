import { FAILURE_SURFACE } from "@luke/features/shown-failure";
import {
  TASK_PRIORITY,
  TASK_PRIORITY_ORDER,
  TASK_STATUS,
  TASK_STATUS_ORDER,
  type TaskPriority,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import {
  Badge,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  type ChipLook,
  ChipName,
  dropBelowStart,
  type MenuSubject,
  STATUS_TONE,
  TaskPriorityMark,
  TaskStatusMark,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { actorName, creatorActor } from "@luke/ui/actor-model";
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

/**
 * task-row-parts.tsx -- what the Tasks page's List row and Board card share: the chips that change a task's priority, status, and assignee where it stands, how many Inbox threads of it wait on the reader, and the door that sends a change.
 *
 * A row and a card draw the same task the same way, so a status picked on
 * either is picked from one menu, and a
 * change the service did not keep says so in one toast. A chip names its
 * value by its mark alone where its place has no room for words, its words
 * still its name, and drops a menu of every value, each with its mark, the
 * one standing checked. The assignee's chip is its face, or the dashed
 * unassigned mark, dropping the task page's assignee rows
 * (`task-standing.tsx`'s `assigneeRows`), and hangs the assignee's own
 * card. A task from a service before statuses stands as Todo, and one
 * before priorities as No priority, as everywhere else. Neither hangs the
 * task's own card, which says nothing the row or the card does not: each
 * chip hangs its own instead.
 */

/** What a change the service did not keep says. */
const UNCHANGED_LINE = "The task could not be changed. Try again.";

/** A task's status, Todo for one from a service before statuses. */
export function statusOf(task: Pick<TaskSummary, "status">): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

/**
 * A task as its menu is headed when it rises as a phone's sheet, the way
 * its row and card read: its status's mark, its name, and under it its
 * repository, its status, and its key, each where the row has one.
 */
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

/** What a standing chip reads of a task: its status, priority, and assignee. */
type ChipTask = Pick<TaskSummary, "status" | "priority" | "assignee">;

/** A task's priority, No priority for one from a service before priorities. */
export function priorityOf(task: ChipTask): TaskPriority {
  return task.priority ?? TASK_PRIORITY.NONE;
}

/** Whether a task already stands where a standing would send it. */
export function standsAt(task: TaskSummary, standing: TaskStanding): boolean {
  if (standing.status !== undefined) return statusOf(task) === standing.status;
  if (standing.assigneeId !== undefined) {
    return (task.assignee?.userId ?? null) === standing.assigneeId;
  }
  return priorityOf(task) === standing.priority;
}

/**
 * Sends a task a change of where it stands, unless it stands there already,
 * which the tab draws at once, a member assigned by the directory's name for
 * them, and puts back where the service did not keep it, and says so then.
 * What the caller moved with it to put back too, `onRefused`, runs only on
 * that refusal. It settles once the service has answered, so a press may wait on it.
 */
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

/** A chip that names one of a task's standings by its mark and drops the menu that changes it, each value with its mark, the one standing checked. */
function StandingChip<T extends string>({
  label,
  value,
  order,
  words,
  mark,
  look,
  card,
  onPick,
}: {
  /** What it changes, Status, Priority, or Assignee, which its tooltip and its menu say before the value. */
  label: string;
  value: T;
  order: readonly T[];
  words: Readonly<Record<T, string>>;
  mark: (value: T) => React.JSX.Element;
  look: ChipLook;
  /** The card the value standing hangs in its pill's place, as an assignee's face hangs theirs. */
  card?: ReactNode;
  onPick: (value: T) => void;
}): React.JSX.Element {
  const { drawn, close, trigger } = useMenu(true);
  const name = `${label}: ${words[value]}`;
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
          {mark(value)}
          <ChipName>{words[value]}</ChipName>
        </Chip>
      </Tooltip>
      {drawn === undefined ? null : (
        <ActionMenu
          label={label}
          menu={drawn}
          groups={[
            order.map((each) => ({
              label: words[each],
              icon: mark(each),
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

/** The chip that says a task's priority and changes it. */
export function PriorityChip({
  task,
  look,
  onStanding,
}: {
  /** What it says of the task: where it stands, as a card or a row holds it, or as a quick add's draft does before it is a task. */
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

/**
 * The chip that says who a task is assigned to by their face, or the dashed
 * unassigned mark, and changes it: No assignee, then the workspace's members,
 * the reader first. An assignee the members do not name, as while they are
 * unread, still stands checked by the name the task carries.
 */
export function AssigneeChip({
  task,
  look,
  onStanding,
}: {
  /** What it says of the task: where it stands, as a card or a row holds it, or as a quick add's draft does before it is a task. */
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
      onPick={(id) => onStanding({ assigneeId: id === NO_ASSIGNEE ? null : id })}
    />
  );
}

/** The chip that says a task's status by its mark and changes it. */
export function StatusChip({
  task,
  look,
  onStanding,
}: {
  /** What it says of the task: where it stands, as a card or a row holds it, or as a quick add's draft does before it is a task. */
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

/** How many of a task's questions wait on the reader, as a badge; nothing at none. */
export function WaitingBadge({ count }: { count: number }): React.JSX.Element | null {
  if (count === 0) return null;
  return <Badge tone={STATUS_TONE.ATTENTION}>{needsYouWords(count)}</Badge>;
}

/**
 * Who made a task, by their face: the member's, or the square of Luke or the
 * agent that made it for them with the member's face on its corner, as every
 * task surface draws it. It hangs their card, and a press opens the member's
 * page where the window offers one, else the task, so it is never a press
 * that does nothing.
 */
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
  // Note that the face opens the member it stands for, whoever made the task for them, since Luke and an agent have no page.
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
        <ActorMark
          actor={shown}
          size={ACTOR_SIZE.MARK}
          forWhom={maker === undefined ? undefined : creator}
        />
        <ChipName>{actorName(shown)}</ChipName>
      </Chip>
    </Tooltip>
  );
}
