import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { TASK_AGENTS_STATUS, taskAgentsStatus } from "@repo/features/task-agents-model";
import type { TaskAgentsSummary } from "@repo/features/task-wire";
import {
  PULL_REQUEST_GLYPH,
  PULL_REQUEST_MARK_QUEUED,
  type PullRequestMarkState,
  pullRequestMarkState,
} from "../../marks/pull-request-glyph.js";
import { FailedMark } from "../row-mark/row-mark.js";
import { WorkingMark } from "../working-mark/working-mark.js";

export const TASK_AGENTS_MARK_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
} as const;

export type TaskAgentsMarkSize = (typeof TASK_AGENTS_MARK_SIZE)[keyof typeof TASK_AGENTS_MARK_SIZE];

const SEAT_CLASS = {
  [TASK_AGENTS_MARK_SIZE.SMALL]: "size-ui-12 [--ui-working-mark-size:var(--spacing-ui-12)]",
  [TASK_AGENTS_MARK_SIZE.MEDIUM]: "size-ui-16 [--ui-working-mark-size:var(--spacing-ui-16)]",
} as const satisfies Record<TaskAgentsMarkSize, string>;

const PULL_REQUEST_WORDS = {
  [PULL_REQUEST_STATE.OPEN]: "Pull request open",
  [PULL_REQUEST_STATE.DRAFT]: "Pull request draft",
  [PULL_REQUEST_STATE.MERGED]: "Pull request merged",
  [PULL_REQUEST_STATE.CLOSED]: "Pull request closed",
  [PULL_REQUEST_MARK_QUEUED]: "Pull request queued",
} as const satisfies Record<PullRequestMarkState, string>;

const PULL_REQUEST_INK = {
  [PULL_REQUEST_STATE.OPEN]: "text-complete",
  [PULL_REQUEST_STATE.DRAFT]: "text-muted-foreground",
  [PULL_REQUEST_STATE.MERGED]: "text-merged",
  [PULL_REQUEST_STATE.CLOSED]: "text-destructive",
  [PULL_REQUEST_MARK_QUEUED]: "text-attention",
} as const satisfies Record<PullRequestMarkState, string>;

export function TaskAgentsMark({
  agents,
  size = TASK_AGENTS_MARK_SIZE.SMALL,
}: {
  agents: TaskAgentsSummary | undefined;
  size?: TaskAgentsMarkSize;
}): React.JSX.Element | null {
  const status = taskAgentsStatus(agents);
  const seat = `task-agents-mark inline-flex flex-none items-center justify-center [&>.failed-mark]:size-full ${SEAT_CLASS[size]}`;
  switch (status.kind) {
    case TASK_AGENTS_STATUS.NONE:
      return null;
    case TASK_AGENTS_STATUS.FAILED:
      return (
        <span className={seat} data-task-agents={status.kind}>
          <FailedMark />
        </span>
      );
    case TASK_AGENTS_STATUS.WORKING:
      return (
        <span className={seat} data-task-agents={status.kind} role="img" aria-label="Working">
          <WorkingMark />
        </span>
      );
    case TASK_AGENTS_STATUS.PULL_REQUEST: {
      const state = pullRequestMarkState(status.pullRequest);
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
