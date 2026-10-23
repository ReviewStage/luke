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
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  type ChipLook,
  ChipName,
  dropBelowStart,
  TaskPriorityMark,
  TaskStatusMark,
  Tooltip,
  useMenu,
} from "@luke/ui";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark, actorCard } from "../actor-ref.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { agentStillWriting, pullRequestNumberLabel } from "../tasks/coding-agent-model.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { PullRequestMark, pullRequestMarkState } from "../tasks/pull-request-mark.js";
import {
  assigneeRows,
  NO_ASSIGNEE,
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
} from "../tasks/task-standing.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { ActionMenu } from "./action-menu.js";
import { MorePullRequestsCard, PullRequestCard, TaskAgentsCard } from "./task-part-cards.js";

/**
 * task-row-parts.tsx -- what the Tasks page's List row and Board card share: the chips that change a task's priority, status, and assignee where it stands, the marks of its agents at work and its pull requests, how many Inbox threads of it wait on the reader, and the door that sends a change.
 *
 * A row and a card draw the same task the same way, so a status picked on
 * either is picked from one menu, a pull request reads alike in both, and a
 * change the service did not keep says so in one toast. A chip names its
 * value by its mark alone where its place has no room for words, its words
 * still its name, and drops a menu of every value, each with its mark, the
 * one standing checked. The assignee's chip is its face, or the dashed
 * unassigned mark, dropping the task page's assignee rows
 * (`task-standing.tsx`'s `assigneeRows`), and hangs the assignee's own
 * card. A task from a service before statuses stands as Todo, and one
 * before priorities as No priority, as everywhere else. Neither hangs the
 * task's own card, which says nothing the row or the card does not: each
 * part hangs its own instead (`task-part-cards.tsx`).
 */

/** What a change the service did not keep says. */
const UNCHANGED_LINE = "The task could not be changed. Try again.";

/** The most pull requests a task's marks draw before they count the rest. */
const MARKED_PULL_REQUESTS = 3;

/** How a task's agents and pull requests are drawn: bare marks in the List's column, or a Board card's pills, each a press of its own. */
export const WORK_LOOK = {
  MARKS: "marks",
  PILLS: "pills",
} as const;

type WorkLook = (typeof WORK_LOOK)[keyof typeof WORK_LOOK];

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
  if (standing.assigneeId !== undefined) {
    return (task.assignee?.userId ?? null) === standing.assigneeId;
  }
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
  /** Whether it says its value in words beside its mark, as on a phone's Board, where it is how a card moves. */
  named: boolean;
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
  task: TaskSummary;
  look: ChipLook;
  onStanding: (standing: TaskStanding) => void;
}): React.JSX.Element {
  const { members, readerId } = useMemberDirectory();
  const person = usePerson(task.assignee);
  const value = task.assignee?.userId ?? NO_ASSIGNEE;
  const listed = assigneeRows(members, readerId);
  const rows = listed.some((row) => row.id === value)
    ? listed
    : [
        ...listed,
        {
          id: value,
          label: task.assignee?.name ?? NO_ASSIGNEE_WORDS,
          icon: <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />,
        },
      ];
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
      named={false}
      card={task.assignee === undefined ? undefined : actorCard(person)}
      onPick={(id) => onStanding({ assigneeId: id === NO_ASSIGNEE ? null : id })}
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

/** What the count after a task's pull request marks says, to a reader who cannot see it. */
function moreWords(more: number): string {
  return `${more} more ${more === 1 ? "pull request" : "pull requests"}`;
}

/** What the working mark says of a task's agents at work, to a reader who cannot see it. */
function workingWords(working: number): string {
  return `${working} ${working === 1 ? "agent" : "agents"} working`;
}

/**
 * What a task's agents are doing and what they published, at a glance: the
 * working mark while one works, then its pull requests, each its mark in
 * GitHub's colour for where it stands and its number, those still standing
 * first, at most `most` of them and a count of the rest; nothing where it has
 * neither. Each hangs its own card (`task-part-cards.tsx`): the working mark
 * the task's agents, a pull request itself, and the count those it counts.
 * As the List's marks (`WORK_LOOK.MARKS`) they are facts, the card's rows
 * being where a pull request or an agent opens; as a Board card's pills
 * (`WORK_LOOK.PILLS`) each is a press of its own, a pull request opening it
 * as a link to it does, the working mark the agent at work, and the count the
 * task. Where `steady`, as in the List's column, a task whose agents rest
 * keeps the working mark's room before its pull requests, so they line up
 * with those of a task whose agent works.
 */
export function TaskWorkMarks({
  task,
  tasks,
  look = WORK_LOOK.MARKS,
  most = MARKED_PULL_REQUESTS,
  steady = false,
  onOpen,
}: {
  task: TaskSummary;
  tasks: Parameters<typeof TaskAgentsCard>[0]["tasks"];
  look?: WorkLook;
  most?: number;
  steady?: boolean;
  /** Opens the task, as a Board card's count of pull requests does. */
  onOpen?: () => void;
}): React.JSX.Element | null {
  const openLink = useOpenLink();
  const working = task.agents?.working ?? 0;
  const pullRequests = markedPullRequests(task);
  const shown = pullRequests.slice(0, most);
  const total = task.agents?.pullRequestTotal ?? pullRequests.length;
  const more = total - shown.length;
  if (working === 0 && shown.length === 0) return null;
  const agents = task.agents?.agents ?? [];
  const agentsCard =
    agents.length === 0 ? undefined : (
      <TaskAgentsCard
        taskId={task.id}
        agents={agents}
        total={task.agents?.total ?? agents.length}
        tasks={tasks}
      />
    );
  const moreCard = (
    <MorePullRequestsCard pullRequests={pullRequests.slice(shown.length)} total={more} />
  );
  if (look === WORK_LOOK.PILLS) {
    // Note that the working pill opens the agent at work the row names, else the task, which shows its agents.
    const atWork = agents.find((agent) => agentStillWriting(agent.status)) ?? agents[0];
    return (
      <>
        {working === 0 ? null : (
          <Tooltip label={workingWords(working)} card={agentsCard}>
            <Chip
              look={CHIP_LOOK.PILL}
              size={CHIP_SIZE.COMPACT}
              aria-label={workingWords(working)}
              data-task-work="agents"
              onClick={atWork === undefined ? onOpen : () => tasks.onShowAgent(task.id, atWork.id)}
            >
              <StateGlyph state={GLYPH_STATE.WORKING} />
              <ChipName>{`${working} working`}</ChipName>
            </Chip>
          </Tooltip>
        )}
        {shown.map((pullRequest) => {
          const { url } = pullRequest;
          return (
            <Tooltip
              key={url ?? pullRequest.number}
              label={pullRequest.title}
              card={<PullRequestCard pullRequest={pullRequest} />}
            >
              <Chip
                look={CHIP_LOOK.PILL}
                size={CHIP_SIZE.COMPACT}
                data-task-work="pull-request"
                data-pull-request-state={pullRequestMarkState(pullRequest)}
                onClick={url === undefined ? undefined : () => openLink(url)}
              >
                <PullRequestMark pullRequest={pullRequest} />
                <ChipName>{pullRequestNumberLabel(pullRequest)}</ChipName>
              </Chip>
            </Tooltip>
          );
        })}
        {more > 0 ? (
          <Tooltip label={moreWords(more)} card={moreCard}>
            <Chip
              look={CHIP_LOOK.PILL}
              size={CHIP_SIZE.COMPACT}
              data-task-work="more"
              onClick={onOpen}
            >
              <ChipName>{`+${more}`}</ChipName>
            </Chip>
          </Tooltip>
        ) : null}
      </>
    );
  }
  return (
    <span className="task-work-marks">
      {working > 0 ? (
        <Tooltip label={workingWords(working)} card={agentsCard}>
          <span className="task-work-agents" data-carded="">
            <StateGlyph state={GLYPH_STATE.WORKING} />
          </span>
        </Tooltip>
      ) : steady ? (
        <span className="task-work-agents">
          <StateGlyph state={GLYPH_STATE.REST} />
        </span>
      ) : null}
      {shown.map((pullRequest) => (
        <Tooltip
          key={pullRequest.url ?? pullRequest.number}
          label={pullRequest.title}
          card={<PullRequestCard pullRequest={pullRequest} />}
        >
          <span
            className="task-work-pull-request"
            data-carded=""
            data-pull-request-state={pullRequestMarkState(pullRequest)}
          >
            <PullRequestMark pullRequest={pullRequest} className="task-mark-glyph" />
            <span aria-hidden="true">{pullRequestNumberLabel(pullRequest)}</span>
          </span>
        </Tooltip>
      ))}
      {more > 0 ? (
        <Tooltip label={moreWords(more)} card={moreCard}>
          <span className="task-work-more" data-carded="">
            {`+${more}`}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
