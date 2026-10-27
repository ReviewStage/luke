import { CHECK_SUMMARY, type CheckSummary } from "@luke/features/coding-agent-wire";
import type { TaskPullRequestLine } from "@luke/features/task-wire";
import { HoverCard, HoverCardHead, HoverCardNote } from "@luke/ui";
import { LinesChanged } from "../tasks/agent-published.js";
import { pullRequestNumberLabel, pullRequestStateLabel } from "../tasks/coding-agent-model.js";
import { OpenedNote } from "../tasks/pull-request-card-notes.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { openerOf } from "../tasks/use-link-standing.js";
import { TASK_MARK_GLYPH } from "./task-card.js";

/**
 * pull-request-card.tsx -- the card a pull request's chip hangs: its mark and title, its key and where it stands, who opened it, its checks, and its size.
 *
 * The pointer resting on a pull request's chip says more about that pull
 * request alone, as Linear's board does, read from what the window already
 * holds, so the card fetches nothing.
 */

/** What a pull request's card says of its checks; nothing where it has none. */
const CHECKS_WORDS = {
  [CHECK_SUMMARY.PASSING]: "Checks passing",
  [CHECK_SUMMARY.PENDING]: "Checks running",
  [CHECK_SUMMARY.FAILING]: "Checks failing",
  [CHECK_SUMMARY.NONE]: undefined,
} as const satisfies Record<CheckSummary, string | undefined>;

/** The repository a pull request's GitHub address names, `owner/name`; none for a line from a service before it sent one. */
const PULL_REQUEST_REPOSITORY = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//u;

/** A pull request's key as its card's head says it: `owner/name#42` where its address names its repository, else `#42`. */
function pullRequestKey(pullRequest: TaskPullRequestLine): string {
  const repository = pullRequest.url?.match(PULL_REQUEST_REPOSITORY)?.[1];
  return `${repository ?? ""}${pullRequestNumberLabel(pullRequest)}`;
}

/** One pull request's card: its mark and title, its key and where it stands under them, then who opened it where GitHub named them, its checks, and the lines it adds and removes. */
export function PullRequestCard({
  pullRequest,
}: {
  pullRequest: TaskPullRequestLine;
}): React.JSX.Element {
  const checks = CHECKS_WORDS[pullRequest.checks];
  return (
    <HoverCard data-pull-request-card="">
      <HoverCardHead
        glyph={<PullRequestMark pullRequest={pullRequest} className={TASK_MARK_GLYPH} />}
        name={pullRequest.title}
        sub={`${pullRequestKey(pullRequest)} · ${pullRequestStateLabel(pullRequest)}`}
      />
      <OpenedNote opener={openerOf(pullRequest)} />
      <HoverCardNote>
        {checks === undefined ? null : `${checks} · `}
        <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
      </HoverCardNote>
    </HoverCard>
  );
}
