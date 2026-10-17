import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { pullRequestPillLabel } from "./coding-agent-model";

/**
 * pull-request-mark.tsx -- a pull request's mark wherever the window draws one: GitHub's glyph for where it stands, in GitHub's colour for it, and red where its checks failed.
 *
 * A pull request is drawn on a sidebar task's row and its card, on its
 * agent's chip and the row a finished transcript ends on, and on its
 * Changes tab's card. Each draws this one mark, so a pull request reads
 * the same in all of them: open in the success green, a draft in the
 * muted ink, merged in the merged purple, closed in the danger red, and
 * the danger red over any of them once its checks have failed, the one
 * result that asks for a look. The colour is the stylesheet's, keyed on
 * `data-pull-request-state` (`tasks.css`), which a chip wearing the
 * pull request's colour carries too.
 */

/** The glyph a pull request is drawn with for where it stands, as GitHub draws it. */
const PULL_REQUEST_GLYPH = {
  [PULL_REQUEST_STATE.OPEN]: GitPullRequestIcon,
  [PULL_REQUEST_STATE.DRAFT]: GitPullRequestDraftIcon,
  [PULL_REQUEST_STATE.MERGED]: GitMergeIcon,
  [PULL_REQUEST_STATE.CLOSED]: GitPullRequestClosedIcon,
} as const;

/** What a failed check run adds to the mark's words for a reader who cannot see its colour. */
const CHECKS_FAILING_WORDS = ", checks failing";

/** A pull request's words for a reader who cannot see its mark: its number, where it stands, and that its checks failed where they did; a control naming the pull request says the same. */
export function pullRequestMarkLabel(
  pullRequest: Pick<CodingAgentPullRequest, "number" | "state" | "checks">,
): string {
  const failing = pullRequest.checks === CHECK_SUMMARY.FAILING;
  return `${pullRequestPillLabel(pullRequest)}${failing ? CHECKS_FAILING_WORDS : ""}`;
}

/** What a pull request's mark is drawn from: its number, where it stands, and how its checks went. */
export type PullRequestMarked = Pick<CodingAgentPullRequest, "number" | "state" | "checks">;

/** A pull request's mark: its glyph for where it stands, coloured for it, red where its checks failed, and named for a reader who cannot see it. */
export function PullRequestMark({
  pullRequest,
  className,
}: {
  pullRequest: Pick<CodingAgentPullRequest, "number" | "state" | "checks">;
  className?: string;
}): React.JSX.Element {
  const Glyph = PULL_REQUEST_GLYPH[pullRequest.state];
  const failing = pullRequest.checks === CHECK_SUMMARY.FAILING;
  return (
    <Glyph
      className={className === undefined ? "pull-request-mark" : `pull-request-mark ${className}`}
      data-pull-request-mark=""
      data-pull-request-state={pullRequest.state}
      data-failing={String(failing)}
      role="img"
      aria-label={pullRequestMarkLabel(pullRequest)}
    />
  );
}
