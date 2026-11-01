/**
 * pr-214-tab.ts -- #214's Pull request tab as 0.19.0 reads it: its head, its conversation with Dana's thread on invite.ts, its files, and which of them Dean marked viewed.
 *
 * Throwaway (`README.md`). Shared by the Chapters and Files changed shots;
 * each says which files are viewed and what waits in Dean's pending review.
 */

import type { PendingReviewComment } from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ago } from "./clock";
import { codingAgentAnswers, shotPullRequest } from "./coding-agent";
import { GITHUB } from "./github-people";
import { SHOT_ID } from "./plan-document";
import { FILES, INVITE_HUNK, INVITE_PATH, PR_URL, pr214Changes, THREAD_LINE, TOTALS } from "./pr-214";
import type { ShotAnswers } from "./shot-spec";
import { acmeMembers } from "./who";

const DESCRIPTION =
  "<h2>Summary</h2>" +
  "<p>A member invites a teammate by email, and the teammate joins by opening the link.</p>";

/** The thread Dana left on invite.ts's withdraw, answered. */
function withdrawThread() {
  return {
    id: "thread-withdraw",
    path: INVITE_PATH,
    line: THREAD_LINE,
    startLine: null,
    originalLine: THREAD_LINE,
    originalStartLine: null,
    side: "right" as const,
    startSide: null,
    diffHunk: INVITE_HUNK,
    resolved: false,
    outdated: false,
    more: 0,
    comments: [
      {
        by: GITHUB.DANA,
        html: "<p>Should withdrawing also clear <code>invite_token</code>, so an old link can never be replayed?</p>",
        body: "Should withdrawing also clear invite_token, so an old link can never be replayed?",
        at: ago(17),
        url: `${PR_URL}#discussion_r2384170003`,
      },
      {
        by: GITHUB.DEAN,
        html: "<p>It does now: <code>withdrawInvite</code> nulls the token, and a test opens the old link.</p>",
        body: "It does now: withdrawInvite nulls the token, and a test opens the old link.",
        at: ago(14),
        url: `${PR_URL}#discussion_r2384170004`,
      },
    ],
  };
}

/** Every read #214's tab makes, answered: `viewed` the files Dean marked, `drafts` his pending review's comments. */
export function pr214TabAnswers(input: {
  readonly viewed: ReadonlySet<string>;
  readonly drafts?: readonly PendingReviewComment[];
}): ShotAnswers {
  const members = acmeMembers();
  const drafts = input.drafts ?? [];
  return {
    ...codingAgentAnswers(),
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST]: (payload) => {
      const answer = shotPullRequest(payload.agentId);
      if (payload.agentId !== SHOT_ID.AGENT || "failure" in answer || answer.pullRequest === null)
        return answer;
      return {
        ...answer,
        pullRequest: {
          ...answer.pullRequest,
          additions: TOTALS.additions,
          deletions: TOTALS.deletions,
          changedFiles: TOTALS.files,
        },
      };
    },
    [ACT_KIND.CODING_AGENTS_CHANGES]: (payload) =>
      payload.agentId === SHOT_ID.AGENT ? pr214Changes() : { pullRequest: null },
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_VIEWED]: () => ({
      outcome: "done",
      files: FILES.map((each) => ({
        path: each.path,
        state: input.viewed.has(each.path) ? "viewed" : "unviewed",
      })),
    }),
    [ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION]: () => ({ outcome: "done" }),
    [ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: (payload) =>
      payload.agentId !== SHOT_ID.AGENT
        ? undefined
        : {
            pullRequest: {
              number: 214,
              title: "Add teammate invitations",
              url: PR_URL,
              state: "open",
              html: DESCRIPTION,
              base: "main",
              head: "luke/teammate-invitations",
              createdAt: ago(31),
              mergedAt: null,
              merge: "clean",
              author: GITHUB.DEAN,
              writtenAs: "developer",
              requested: [GITHUB.JORDAN],
            },
          },
    [ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION]: (payload) =>
      payload.agentId !== SHOT_ID.AGENT
        ? undefined
        : {
            pullRequest: {
              reviewers: [
                { by: GITHUB.DANA, state: "commented" },
                { by: GITHUB.JORDAN, state: "requested" },
              ],
              earlier: 0,
              ...(drafts.length === 0 ? {} : { pendingReview: { comments: drafts.length, drafts } }),
              conversation: [
                {
                  kind: "review",
                  by: GITHUB.DANA,
                  state: "commented",
                  html: "<p>One question on withdraw.</p>",
                  body: "One question on withdraw.",
                  at: ago(17),
                  url: `${PR_URL}#pullrequestreview-2384170002`,
                  threads: [withdrawThread()],
                },
              ],
            },
          },
  };
}
