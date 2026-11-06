import {
  CHECK_SUMMARY,
  type CheckSummary,
  type PullRequestMerging,
  REVIEW_DECISION,
  type ReviewDecision,
} from "@repo/features/agent-wire";
import { MERGE_METHOD, type MergeMethod } from "@repo/features/pull-request-write-wire";
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

const GITHUB_ROLLUP = new Map<string, CheckSummary>([
  ["SUCCESS", CHECK_SUMMARY.PASSING],
  ["PENDING", CHECK_SUMMARY.PENDING],
  ["EXPECTED", CHECK_SUMMARY.PENDING],
  ["FAILURE", CHECK_SUMMARY.FAILING],
  ["ERROR", CHECK_SUMMARY.FAILING],
]);

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

export const PULL_REQUEST_QUEUED_OPERATION = "PullRequestQueued";

const QUEUED_QUERY = `query ${PULL_REQUEST_QUEUED_OPERATION}($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      mergeQueueEntry { position }
    }
  }
}`;

const QueuedAnswerSchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            mergeQueueEntry: Schema.NullOr(Schema.Struct({ position: Schema.Number })),
          }),
        ),
      }),
    ),
  }),
});

export const pullRequestQueued = /* @__PURE__ */ Effect.fn("web/pullRequestQueued")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.fn.Return<boolean, GitHubUnavailable, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost("/graphql", token, {
    query: QUEUED_QUERY,
    variables: { owner, name, number },
  });
  const answer = yield* Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, QueuedAnswerSchema)),
  );
  return (answer.data.repository?.pullRequest?.mergeQueueEntry ?? null) !== null;
});
