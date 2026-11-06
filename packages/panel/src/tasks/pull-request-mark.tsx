import {
  type AgentPullRequest,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import {
  PULL_REQUEST_GLYPH,
  PULL_REQUEST_MARK_QUEUED,
  pullRequestMarkState,
  STATUS_TONE,
  type StatusTone,
} from "@repo/ui";
import { pullRequestNumberLabel, pullRequestPillLabel } from "./agent-model.js";

export const PULL_REQUEST_TONE = {
  [PULL_REQUEST_STATE.OPEN]: STATUS_TONE.COMPLETE,
  [PULL_REQUEST_STATE.DRAFT]: STATUS_TONE.NEUTRAL,
  [PULL_REQUEST_STATE.MERGED]: STATUS_TONE.MERGED,
  [PULL_REQUEST_STATE.CLOSED]: STATUS_TONE.DANGER,
} as const satisfies Record<PullRequestState, StatusTone>;

const CHECKS_FAILING_WORDS = ", checks failing";

export type PullRequestMarked = Pick<AgentPullRequest, "number" | "state" | "checks" | "queued">;

function pullRequestMarkLabel(pullRequest: PullRequestMarked): string {
  const failing = pullRequest.checks === CHECK_SUMMARY.FAILING;
  const standing =
    pullRequestMarkState(pullRequest) === PULL_REQUEST_MARK_QUEUED
      ? `Pull request ${pullRequestNumberLabel(pullRequest)}, queued`
      : pullRequestPillLabel(pullRequest);
  return `${standing}${failing ? CHECKS_FAILING_WORDS : ""}`;
}

export function PullRequestMark({
  pullRequest,
  className,
}: {
  pullRequest: PullRequestMarked;
  className?: string;
}): React.JSX.Element {
  const state = pullRequestMarkState(pullRequest);
  const Glyph = PULL_REQUEST_GLYPH[state];
  return (
    <Glyph
      className={className === undefined ? "pull-request-mark" : `pull-request-mark ${className}`}
      data-pull-request-mark=""
      data-pull-request-state={state}
      role="img"
      aria-label={pullRequestMarkLabel(pullRequest)}
    />
  );
}
