import { PULL_REQUEST_STATE, type PullRequestState } from "@repo/features/agent-wire";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "../icons/icons.js";

export const PULL_REQUEST_MARK_QUEUED = "queued";

export type PullRequestMarkState = PullRequestState | typeof PULL_REQUEST_MARK_QUEUED;

export const PULL_REQUEST_GLYPH = {
  [PULL_REQUEST_STATE.OPEN]: GitPullRequestIcon,
  [PULL_REQUEST_STATE.DRAFT]: GitPullRequestDraftIcon,
  [PULL_REQUEST_STATE.MERGED]: GitMergeIcon,
  [PULL_REQUEST_STATE.CLOSED]: GitPullRequestClosedIcon,
  [PULL_REQUEST_MARK_QUEUED]: GitMergeIcon,
} as const satisfies Record<PullRequestMarkState, unknown>;

export function pullRequestMarkState(pullRequest: {
  readonly state: PullRequestState;
  readonly queued?: true;
}): PullRequestMarkState {
  return pullRequest.queued === true && pullRequest.state === PULL_REQUEST_STATE.OPEN
    ? PULL_REQUEST_MARK_QUEUED
    : pullRequest.state;
}
