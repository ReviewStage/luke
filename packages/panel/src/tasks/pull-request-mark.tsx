import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import { STATUS_TONE, type StatusTone } from "@luke/ui";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { pullRequestNumberLabel, pullRequestPillLabel } from "./coding-agent-model.js";

/**
 * pull-request-mark.tsx -- a pull request's mark wherever the window draws one: GitHub's glyph for where it stands, in GitHub's colour for it, whatever its checks say.
 *
 * A pull request is drawn on a sidebar task's row and its card, on the
 * row pinned over its agent's box, and on its Changes tab's card. Each
 * draws this one mark, so a pull request reads
 * the same in all of them: open in the success green, a draft in the
 * muted ink, merged in the merged purple, and closed in the danger red. An
 * open one GitHub holds in its merge queue is drawn as its Pull request
 * tab's pill draws it: the merge's glyph in the working tone, said queued.
 * Its checks never change its colour: failed checks are said in its words
 * for a reader who cannot see it, and drawn where the checks themselves
 * are. The colour is the stylesheet's, keyed on
 * `data-pull-request-state` (`tasks.css`); a chip naming the pull request
 * says the same in the shared palette's tone for it (`PULL_REQUEST_TONE`).
 */

/** The glyph a pull request is drawn with for where it stands, as GitHub draws it. */
const PULL_REQUEST_GLYPH = {
  [PULL_REQUEST_STATE.OPEN]: GitPullRequestIcon,
  [PULL_REQUEST_STATE.DRAFT]: GitPullRequestDraftIcon,
  [PULL_REQUEST_STATE.MERGED]: GitMergeIcon,
  [PULL_REQUEST_STATE.CLOSED]: GitPullRequestClosedIcon,
} as const;

/** The chip tone a pull request is named in for where it stands: GitHub's colour for it, in the shared palette. */
export const PULL_REQUEST_TONE = {
  [PULL_REQUEST_STATE.OPEN]: STATUS_TONE.COMPLETE,
  [PULL_REQUEST_STATE.DRAFT]: STATUS_TONE.NEUTRAL,
  [PULL_REQUEST_STATE.MERGED]: STATUS_TONE.MERGED,
  [PULL_REQUEST_STATE.CLOSED]: STATUS_TONE.DANGER,
} as const satisfies Record<PullRequestState, StatusTone>;

/** What a mark is drawn and coloured for: where the pull request stands, or queued for an open one in the merge queue. */
export const PULL_REQUEST_MARK_QUEUED = "queued";

/** Where a pull request's mark says it stands: queued where it is open and the merge queue holds it, else where it stands. */
export function pullRequestMarkState(
  pullRequest: Pick<CodingAgentPullRequest, "state" | "queued">,
): PullRequestState | typeof PULL_REQUEST_MARK_QUEUED {
  return pullRequest.queued === true && pullRequest.state === PULL_REQUEST_STATE.OPEN
    ? PULL_REQUEST_MARK_QUEUED
    : pullRequest.state;
}

/** What a failed check run adds to the mark's words for a reader who cannot see it. */
const CHECKS_FAILING_WORDS = ", checks failing";

/** What a pull request's mark is drawn from: its number, where it stands, whether the merge queue holds it, and how its checks went. */
export type PullRequestMarked = Pick<
  CodingAgentPullRequest,
  "number" | "state" | "checks" | "queued"
>;

/** A pull request's words for a reader who cannot see its mark: its number, where it stands, and that its checks failed where they did. */
function pullRequestMarkLabel(pullRequest: PullRequestMarked): string {
  const failing = pullRequest.checks === CHECK_SUMMARY.FAILING;
  const standing =
    pullRequestMarkState(pullRequest) === PULL_REQUEST_MARK_QUEUED
      ? `Pull request ${pullRequestNumberLabel(pullRequest)}, queued`
      : pullRequestPillLabel(pullRequest);
  return `${standing}${failing ? CHECKS_FAILING_WORDS : ""}`;
}

/** A pull request's mark: its glyph for where it stands, coloured for it alone, and named for a reader who cannot see it. */
export function PullRequestMark({
  pullRequest,
  className,
}: {
  pullRequest: PullRequestMarked;
  className?: string;
}): React.JSX.Element {
  const state = pullRequestMarkState(pullRequest);
  const Glyph = state === PULL_REQUEST_MARK_QUEUED ? GitMergeIcon : PULL_REQUEST_GLYPH[state];
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
