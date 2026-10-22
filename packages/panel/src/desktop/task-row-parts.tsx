import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
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
  BADGE_TONE,
  Badge,
  CHIP_SIZE,
  Chip,
  type ChipLook,
  ChipName,
  dropBelowStart,
  TaskPriorityMark,
  TaskStatusMark,
  useMenu,
} from "@luke/ui";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { pullRequestNumberLabel } from "../tasks/coding-agent-model.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { PullRequestMark, pullRequestMarkState } from "../tasks/pull-request-mark.js";
import { TASK_PRIORITY_WORDS, TASK_STATUS_WORDS } from "../tasks/task-standing.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu } from "./action-menu.js";

/**
 * task-row-parts.tsx -- what the Tasks page's List row and Board card share: the chips that change a task's priority and status where it stands, the marks of its agents at work and its pull requests, how many Inbox threads of it wait on the reader, and the door that sends a change.
 *
 * A row and a card draw the same task the same way, so a status picked on
 * either is picked from one menu, a pull request reads alike in both, and a
 * change the service did not keep says so in one toast. A chip names its
 * value by its mark alone where its place has no room for words, its words
 * still its name, and drops a menu of every value, each with its mark, the
 * one standing checked. A task from a service before statuses stands as
 * Todo, and one before priorities as No priority, as everywhere else.
 */

/** What a change the service did not keep says. */
const UNCHANGED_LINE = "The task could not be changed. Try again.";

/** The most pull requests a task's marks draw before they count the rest. */
const MARKED_PULL_REQUESTS = 3;

/** The pull requests that still stand, the open and the drafts, which a task's marks lead with. */
const STANDING_PULL_REQUESTS = new Set<string>([PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.DRAFT]);

/** A task's status, Todo for one from a service before statuses. */
export function statusOf(task: TaskSummary): TaskStatus {
  return task.status ?? TASK_STATUS.TODO;
}

/** A task's priority, No priority for one from a service before priorities. */
function priorityOf(task: TaskSummary): TaskPriority {
  return task.priority ?? TASK_PRIORITY.NONE;
}

/** Whether a task already stands where a standing would send it. */
export function standsAt(task: TaskSummary, standing: TaskStanding): boolean {
  if (standing.status !== undefined) return statusOf(task) === standing.status;
  return priorityOf(task) === standing.priority;
}

/**
 * Sends a task a change of where it stands, unless it stands there already,
 * and says so where the service did not keep it. What must follow only a
 * change kept, `onKept`, runs once the service keeps it, or at once where
 * the task already stands there, and never where it was refused.
 */
export function useStandingDoor(
  tasks: Pick<TasksControl, "onSetTaskStanding">,
): (task: TaskSummary, standing: TaskStanding, onKept?: () => void) => void {
  const toast = useToast();
  return (task, standing, onKept) => {
    if (standsAt(task, standing)) {
      onKept?.();
      return;
    }
    void tasks.onSetTaskStanding(task.id, standing).then((kept) => {
      if (kept) onKept?.();
      else toast({ words: UNCHANGED_LINE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
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
  named,
  onPick,
}: {
  /** What it changes, Status or Priority, which its tooltip and its menu say before the value. */
  label: string;
  value: T;
  order: readonly T[];
  words: Readonly<Record<T, string>>;
  mark: (value: T) => React.JSX.Element;
  look: ChipLook;
  /** Whether it says its value in words beside its mark, as on a phone's Board, where it is how a card moves. */
  named: boolean;
  onPick: (value: T) => void;
}): React.JSX.Element {
  const { drawn, close, trigger } = useMenu(true);
  const name = `${label}: ${words[value]}`;
  return (
    <>
      <Tooltip label={name}>
        <Chip
          look={look}
          size={CHIP_SIZE.COMPACT}
          iconOnly={!named}
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
  task: TaskSummary;
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
      named={false}
      onPick={(priority) => onStanding({ priority })}
    />
  );
}

/** The chip that says a task's status and changes it, its words beside its mark where `named`. */
export function StatusChip({
  task,
  look,
  named = false,
  onStanding,
}: {
  task: TaskSummary;
  look: ChipLook;
  named?: boolean;
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
      named={named}
      onPick={(status) => onStanding({ status })}
    />
  );
}

/** How many of a task's Inbox threads wait on the reader, as a badge; nothing at none. */
export function WaitingBadge({ count }: { count: number }): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <Badge tone={BADGE_TONE.ATTENTION}>
      {`${count} ${count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`}
    </Badge>
  );
}

/** A task's pull requests in the order its marks draw them: those still standing first, then the merged and the closed, each kept in the order the service sent. */
function markedPullRequests(task: TaskSummary) {
  const all = task.agents?.pullRequests ?? [];
  return [
    ...all.filter((each) => STANDING_PULL_REQUESTS.has(each.state)),
    ...all.filter((each) => !STANDING_PULL_REQUESTS.has(each.state)),
  ];
}

/**
 * What a task's agents are doing and what they published, at a glance: the
 * working mark while one works, then its pull requests, each its mark in
 * GitHub's colour for where it stands and its number, those still standing
 * first, at most `most` of them and a count of the rest; nothing where it has
 * neither. The marks are facts, its card's rows being where a pull request
 * opens.
 */
export function TaskWorkMarks({
  task,
  most = MARKED_PULL_REQUESTS,
}: {
  task: TaskSummary;
  most?: number;
}): React.JSX.Element | null {
  const working = (task.agents?.working ?? 0) > 0;
  const pullRequests = markedPullRequests(task);
  const shown = pullRequests.slice(0, most);
  const more = (task.agents?.pullRequestTotal ?? pullRequests.length) - shown.length;
  if (!working && shown.length === 0) return null;
  return (
    <span className="task-work-marks">
      {working ? <StateGlyph state={GLYPH_STATE.WORKING} /> : null}
      {shown.map((pullRequest) => (
        <span
          key={pullRequest.url ?? pullRequest.number}
          className="task-work-pull-request"
          data-pull-request-state={pullRequestMarkState(pullRequest)}
        >
          <PullRequestMark pullRequest={pullRequest} className="task-mark-glyph" />
          <span aria-hidden="true">{pullRequestNumberLabel(pullRequest)}</span>
        </span>
      ))}
      {more > 0 ? <span className="task-work-more">{`+${more}`}</span> : null}
    </span>
  );
}
