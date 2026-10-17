/**
 * pull-request-merging.ts -- how an open pull request may be merged, as its merge box offers it, read from GitHub's GraphQL API on the token the overview reads on.
 *
 * One query reads what the REST pull request does not carry: the merge
 * methods the repository allows, whether it allows auto-merge, whether the
 * pull request's base is merged through a merge queue and where it stands
 * in it, whether auto-merge is on for it and by which method, its head
 * commit, what its required reviews say, and its head's checks as one word.
 * It runs on the installation token the App minted for the agent's one
 * repository (`github-app.ts`'s `repositoryPullRequestToken`), as every
 * other overview read does, over the App module's own kit (`githubPost`,
 * `send`, `readBody`). An answer GitHub gave in no shape this reads, errors
 * among it, is unreadable, which the caller answers as no merge box rather
 * than failing the header it rides with.
 */

import {
  CHECK_SUMMARY,
  type CheckSummary,
  type PullRequestMerging,
  REVIEW_DECISION,
  type ReviewDecision,
} from "@luke/features/coding-agent-wire";
import { MERGE_METHOD, type MergeMethod } from "@luke/features/pull-request-write-wire";
import { Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type GitHubUnavailable, githubPost, readBody, send } from "./github-app.js";

const MERGING_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    autoMergeAllowed
    pullRequest(number: $number) {
      headRefOid
      isMergeQueueEnabled
      mergeQueueEntry { position }
      autoMergeRequest { mergeMethod }
      reviewDecision
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`;

const MergingAnswerSchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        mergeCommitAllowed: Schema.Boolean,
        squashMergeAllowed: Schema.Boolean,
        rebaseMergeAllowed: Schema.Boolean,
        autoMergeAllowed: Schema.Boolean,
        pullRequest: Schema.NullOr(
          Schema.Struct({
            headRefOid: Schema.String,
            isMergeQueueEnabled: Schema.Boolean,
            mergeQueueEntry: Schema.NullOr(Schema.Struct({ position: Schema.Number })),
            autoMergeRequest: Schema.NullOr(
              Schema.Struct({ mergeMethod: Schema.NullOr(Schema.String) }),
            ),
            reviewDecision: Schema.NullOr(Schema.String),
            commits: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  commit: Schema.Struct({
                    statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.String })),
                  }),
                }),
              ),
            }),
          }),
        ),
      }),
    ),
  }),
});

/** GitHub's word for each merge method, as GraphQL spells it. */
const GITHUB_MERGE_METHOD = new Map<string, MergeMethod>([
  ["MERGE", MERGE_METHOD.MERGE],
  ["SQUASH", MERGE_METHOD.SQUASH],
  ["REBASE", MERGE_METHOD.REBASE],
]);

const GITHUB_REVIEW_DECISION = new Map<string, ReviewDecision>([
  ["APPROVED", REVIEW_DECISION.APPROVED],
  ["CHANGES_REQUESTED", REVIEW_DECISION.CHANGES_REQUESTED],
  ["REVIEW_REQUIRED", REVIEW_DECISION.REVIEW_REQUIRED],
]);

/** A head's status rollup as one word; one GitHub has not rolled up is none run. */
const GITHUB_ROLLUP = new Map<string, CheckSummary>([
  ["SUCCESS", CHECK_SUMMARY.PASSING],
  ["PENDING", CHECK_SUMMARY.PENDING],
  ["EXPECTED", CHECK_SUMMARY.PENDING],
  ["FAILURE", CHECK_SUMMARY.FAILING],
  ["ERROR", CHECK_SUMMARY.FAILING],
]);

/**
 * How the pull request may be merged, read on the token; none where the
 * repository or the pull request reads as none. Note that the methods are
 * the repository's own settings alone: a ruleset narrowing them on the base
 * is GitHub's to refuse, in its own words, when a merge names one.
 */
export const pullRequestMerging = /* @__PURE__ */ Effect.fn("web/pullRequestMerging")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.fn.Return<Option.Option<PullRequestMerging>, GitHubUnavailable, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost("/graphql", token, {
    query: MERGING_QUERY,
    variables: { owner, name, number },
  });
  const answer = yield* Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, MergingAnswerSchema)),
  );
  const repository = answer.data.repository;
  const pull = repository?.pullRequest;
  if (repository === null || pull === null || pull === undefined) return Option.none();
  const methods = [
    ...(repository.mergeCommitAllowed ? [MERGE_METHOD.MERGE] : []),
    ...(repository.squashMergeAllowed ? [MERGE_METHOD.SQUASH] : []),
    ...(repository.rebaseMergeAllowed ? [MERGE_METHOD.REBASE] : []),
  ];
  const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return Option.some({
    methods,
    autoMergeAllowed: repository.autoMergeAllowed,
    queue: pull.isMergeQueueEnabled,
    queued: pull.mergeQueueEntry === null ? null : { position: pull.mergeQueueEntry.position },
    autoMerge:
      pull.autoMergeRequest === null
        ? null
        : { method: GITHUB_MERGE_METHOD.get(pull.autoMergeRequest.mergeMethod ?? "") ?? null },
    headSha: pull.headRefOid,
    review: GITHUB_REVIEW_DECISION.get(pull.reviewDecision ?? "") ?? null,
    checks:
      rollup === undefined ? CHECK_SUMMARY.NONE : (GITHUB_ROLLUP.get(rollup) ?? CHECK_SUMMARY.NONE),
  });
});
