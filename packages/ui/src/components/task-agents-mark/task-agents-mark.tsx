import { PULL_REQUEST_STATE, type PullRequestState } from "@luke/features/coding-agent-wire";
import { TASK_AGENTS_STATUS, taskAgentsStatus } from "@luke/features/task-agents-model";
import type { TaskAgentsSummary } from "@luke/features/task-wire";
import { PULL_REQUEST_GLYPH } from "../../marks/pull-request-glyph.js";
import { AttentionMark } from "../attention-mark/attention-mark.js";
import { FailedMark } from "../row-mark/row-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";

/**
 * task-agents-mark.tsx -- the one icon a task's row ends with: how its agents stand, most pressing first.
 *
 * A question waiting on the reader wears the orange attention mark; an
 * agent that failed, the failed triangle every failure wears; an agent at
 * work, the working mark; and else the pull request they left, in GitHub's
 * glyph and colour for where it stands: open in the success green, a draft
 * in the muted ink, merged in the merged purple, closed in the danger red.
 * Which one stands is `taskAgentsStatus`'s answer, and a task with none of
 * them wears nothing. Every icon is named in a fixed phrase, so nothing a
 * task holds rides it, and is drawn in the one seat its `size` sets, so a
 * row moves nothing as its status changes.
 */

/** The seat a task's icon is drawn in: the sidebar's caption size, or a page row's glyph size. */
export const TASK_AGENTS_MARK_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
} as const;

export type TaskAgentsMarkSize = (typeof TASK_AGENTS_MARK_SIZE)[keyof typeof TASK_AGENTS_MARK_SIZE];

/** Each seat's box, which every mark inside it fills, the working mark through its own size. */
const SEAT_CLASS = {
  [TASK_AGENTS_MARK_SIZE.SMALL]:
    "size-luke-12 [--luke-working-mark-size:var(--spacing-luke-12)] [&_.attention-mark_svg]:size-attention-glyph-small",
  [TASK_AGENTS_MARK_SIZE.MEDIUM]:
    "size-luke-16 [--luke-working-mark-size:var(--spacing-luke-16)] [&_.attention-mark_svg]:size-luke-12",
} as const satisfies Record<TaskAgentsMarkSize, string>;

/** What each status but a pull request's is called. */
const STATUS_WORDS = {
  [TASK_AGENTS_STATUS.WAITING_ON_YOU]: "Waiting on you",
  [TASK_AGENTS_STATUS.WORKING]: "Working",
} as const;

/** What a pull request's status is called for where it stands. */
const PULL_REQUEST_WORDS = {
  [PULL_REQUEST_STATE.OPEN]: "Pull request open",
  [PULL_REQUEST_STATE.DRAFT]: "Pull request draft",
  [PULL_REQUEST_STATE.MERGED]: "Pull request merged",
  [PULL_REQUEST_STATE.CLOSED]: "Pull request closed",
} as const satisfies Record<PullRequestState, string>;

/** GitHub's colour for where a pull request stands. */
const PULL_REQUEST_INK = {
  [PULL_REQUEST_STATE.OPEN]: "text-complete",
  [PULL_REQUEST_STATE.DRAFT]: "text-muted-foreground",
  [PULL_REQUEST_STATE.MERGED]: "text-merged",
  [PULL_REQUEST_STATE.CLOSED]: "text-destructive",
} as const satisfies Record<PullRequestState, string>;

/** The icon at the end of a task's row for how its agents stand; nothing where none of them asks, failed, works, or left a pull request. */
export function TaskAgentsMark({
  agents,
  waiting,
  size = TASK_AGENTS_MARK_SIZE.SMALL,
}: {
  agents: TaskAgentsSummary | undefined;
  /** How many of the task's questions wait on the reader, as the Inbox counts them. */
  waiting: number;
  size?: TaskAgentsMarkSize;
}): React.JSX.Element | null {
  const status = taskAgentsStatus(agents, waiting);
  const seat = `task-agents-mark inline-flex flex-none items-center justify-center [&>.attention-mark]:size-full [&>.failed-mark]:size-full ${SEAT_CLASS[size]}`;
  switch (status.kind) {
    case TASK_AGENTS_STATUS.NONE:
      return null;
    case TASK_AGENTS_STATUS.FAILED:
      // Note that the failed mark names itself, as it does on an agent's tab.
      return (
        <span className={seat} data-task-agents={status.kind}>
          <FailedMark />
        </span>
      );
    case TASK_AGENTS_STATUS.WAITING_ON_YOU:
    case TASK_AGENTS_STATUS.WORKING:
      return (
        <span
          className={seat}
          data-task-agents={status.kind}
          role="img"
          aria-label={STATUS_WORDS[status.kind]}
        >
          {status.kind === TASK_AGENTS_STATUS.WORKING ? <WorkingMark /> : <AttentionMark />}
        </span>
      );
    case TASK_AGENTS_STATUS.PULL_REQUEST: {
      const { state } = status.pullRequest;
      const Glyph = PULL_REQUEST_GLYPH[state];
      return (
        <span
          className={seat}
          data-task-agents={status.kind}
          role="img"
          aria-label={PULL_REQUEST_WORDS[state]}
        >
          <Glyph className={`size-full ${PULL_REQUEST_INK[state]}`} aria-hidden="true" />
        </span>
      );
    }
  }
}
