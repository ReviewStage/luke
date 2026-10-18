/**
 * pull-request-writes.ts -- a change to a pull request on GitHub, on the token of the member who asked for it: one GraphQL call, its refusals told apart.
 *
 * Every write here runs on a member's own GitHub App user token
 * (`github-app.ts`'s `userToken`), handed in by the one seam that resolves it
 * (`agents/pull-request-write.ts`), never on an installation token, so what
 * the member may do on GitHub bounds what they do through Luke. A write is
 * one call of GitHub's GraphQL API (`githubWrite`) composed over the App
 * module's own kit (`githubPost`, `send`), so a token leaves this module no
 * more than it leaves that one. What GitHub answers is told apart three
 * ways: a token GitHub will not take (401), which the member mends by
 * signing in with GitHub again; a change GitHub refused, in its own words,
 * whether as GraphQL errors on a 200 or as a refusal status with a message
 * (a missing permission, a branch protection, a rate limit); and a GitHub
 * that could not be reached or answered in no shape the call reads.
 * Nothing of the token, the request, or GitHub's body reaches a log line.
 * Which files the member marked viewed is read through the same call, on
 * the same token, since GitHub keeps that mark for each account alone.
 */

import {
  FILE_VIEWED_STATE,
  type FileViewedState,
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_WRITE_BOUNDS,
  REVIEW_EVENT,
  type ReviewEvent,
} from "@luke/features/pull-request-write-wire";
import { Data, Effect, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  GITHUB_FAILURE,
  GITHUB_HTTP_STATUS,
  GitHubUnavailable,
  githubPost,
  send,
} from "./github-app.js";

/** GitHub's GraphQL endpoint, under the API's origin. */
const GRAPHQL_PATH = "/graphql";

/** GitHub would not take the member's token: expired, revoked, or never one of the App's. */
class GitHubTokenRefused extends Data.TaggedError("GitHubTokenRefused") {
  override get message(): string {
    return "GitHub refused the member's token";
  }
}

/** GitHub refused the change itself; its words, cut to the bound, are the member's to read. */
class GitHubWriteRefused extends Data.TaggedError("GitHubWriteRefused")<{
  readonly words: string;
}> {
  override get message(): string {
    return "GitHub refused the change";
  }
}

/** What a write on a member's token can fail with. */
export type GitHubWriteFailure = GitHubTokenRefused | GitHubWriteRefused | GitHubUnavailable;

/** A GraphQL answer's frame: its data, which the caller's schema reads, and its errors, each with its words. */
const GraphqlAnswerSchema = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

/** A refusal status's body, as far as its words. */
const RefusalSchema = Schema.Struct({ message: Schema.String });

/** Words GitHub said, joined and cut to the bound. */
function refusalOf(messages: readonly string[]): GitHubWriteRefused {
  return new GitHubWriteRefused({
    words: messages.join(" ").slice(0, PULL_REQUEST_WRITE_BOUNDS.MAX_REFUSAL_CHARS),
  });
}

function unreadable(status: number): GitHubUnavailable {
  return new GitHubUnavailable({ reason: GITHUB_FAILURE.UNREADABLE, status });
}

/**
 * The answer to a GraphQL call read for what it said: a 401 is the token
 * refused, any other status that is not OK a refusal in GitHub's words where
 * it gave some, and an OK answer carrying errors a refusal in theirs.
 */
const readWrite = /* @__PURE__ */ Effect.fnUntraced(function* <A>(
  response: HttpClientResponse.HttpClientResponse,
  data: Schema.Codec<A, unknown>,
): Effect.fn.Return<A, GitHubWriteFailure> {
  if (response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED) {
    return yield* new GitHubTokenRefused();
  }
  if (response.status < 200 || response.status >= 300) {
    const refusal = yield* HttpClientResponse.schemaBodyJson(RefusalSchema)(response).pipe(
      Effect.mapError(
        () => new GitHubUnavailable({ reason: GITHUB_FAILURE.STATUS, status: response.status }),
      ),
    );
    return yield* refusalOf([refusal.message]);
  }
  const answer = yield* HttpClientResponse.schemaBodyJson(GraphqlAnswerSchema)(response).pipe(
    Effect.mapError(() => unreadable(response.status)),
  );
  const errors = answer.errors ?? [];
  if (errors.length > 0) return yield* refusalOf(errors.map((error) => error.message));
  return yield* Schema.decodeUnknownEffect(data)(answer.data).pipe(
    Effect.mapError(() => unreadable(response.status)),
  );
});

/**
 * One call of GitHub's GraphQL API on the member's token: the document and
 * its variables, its data read under the schema given. Every write on a
 * pull request goes through here, so every one tells GitHub's refusals
 * apart the same way.
 */
const githubWrite = <A>(
  token: Redacted.Redacted,
  document: string,
  variables: Readonly<Record<string, string | number | boolean | null>>,
  data: Schema.Codec<A, unknown>,
): Effect.Effect<A, GitHubWriteFailure, HttpClient.HttpClient> =>
  Effect.scoped(
    Effect.flatMap(
      send(githubPost(GRAPHQL_PATH, token, { query: document, variables })),
      (answer) => readWrite(answer, data),
    ),
  );

const NODE_ID_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { id } }
}`;

/** GraphQL answers a repository or pull request it cannot resolve as null, at times with no error beside it. */
const NodeIdSchema = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({ pullRequest: Schema.NullOr(Schema.Struct({ id: Schema.String })) }),
  ),
});

/** What the member is told where GitHub answered no such pull request and said nothing of why. */
const NOT_RESOLVED = "Could not resolve to a pull request your GitHub account can see.";

/**
 * The pull request's GraphQL id, which every mutation names it by, read on
 * the member's token, so a repository or pull request out of their sight is
 * GitHub's refusal in its own words before anything is changed.
 */
export const pullRequestNodeId = /* @__PURE__ */ Effect.fn("web/pullRequestNodeId")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.fn.Return<string, GitHubWriteFailure, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const read = yield* githubWrite(token, NODE_ID_QUERY, { owner, name, number }, NodeIdSchema);
  const id = read.repository?.pullRequest?.id;
  if (id === undefined) return yield* refusalOf([NOT_RESOLVED]);
  return id;
});

const READY_FOR_REVIEW_MUTATION = `mutation($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } }
}`;

const CONVERT_TO_DRAFT_MUTATION = `mutation($id: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } }
}`;

/** A pull request marked ready for review, or turned back into a draft where `draft` asks, on the member's token. */
export const setPullRequestDraft = /* @__PURE__ */ Effect.fn("web/setPullRequestDraft")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  draft: boolean,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(
    token,
    draft ? CONVERT_TO_DRAFT_MUTATION : READY_FOR_REVIEW_MUTATION,
    { id: pullRequestId },
    Schema.Unknown,
  );
});

/** GitHub's own word for each review event, as `PullRequestReviewEvent` spells it. */
const GRAPHQL_REVIEW_EVENT = {
  [REVIEW_EVENT.COMMENT]: "COMMENT",
  [REVIEW_EVENT.APPROVE]: "APPROVE",
  [REVIEW_EVENT.REQUEST_CHANGES]: "REQUEST_CHANGES",
} as const satisfies Record<ReviewEvent, string>;

/** At most this many pending reviews are read to find the member's own; GitHub shows a member only theirs, so one is the most ever answered. */
const PENDING_REVIEWS_READ = 10;

const PENDING_REVIEW_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      reviews(states: PENDING, first: ${PENDING_REVIEWS_READ}) { nodes { id viewerDidAuthor } }
    }
  }
}`;

const PendingReviewsSchema = Schema.Struct({
  node: Schema.Struct({
    reviews: Schema.Struct({
      nodes: Schema.Array(Schema.Struct({ id: Schema.String, viewerDidAuthor: Schema.Boolean })),
    }),
  }),
});

const SUBMIT_PENDING_REVIEW_MUTATION = `mutation($id: ID!, $event: PullRequestReviewEvent!, $body: String) {
  submitPullRequestReview(input: { pullRequestReviewId: $id, event: $event, body: $body }) {
    pullRequestReview { id }
  }
}`;

const ADD_REVIEW_MUTATION = `mutation($id: ID!, $event: PullRequestReviewEvent!, $body: String) {
  addPullRequestReview(input: { pullRequestId: $id, event: $event, body: $body }) {
    pullRequestReview { id }
  }
}`;

/**
 * A review submitted on the member's token: their own pending review,
 * where they hold one, so the comments they started it with are what
 * publishes, else a new review made and submitted at once. An empty body
 * is left unsent, so a pending review keeps the words it already holds.
 * GitHub's own rules, such as no approving one's own pull request, are its
 * refusal in its words.
 */
export const submitPullRequestReview = /* @__PURE__ */ Effect.fn("web/submitPullRequestReview")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
    review: { readonly event: ReviewEvent; readonly body: string },
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    const pending = yield* githubWrite(
      token,
      PENDING_REVIEW_QUERY,
      { id: pullRequestId },
      PendingReviewsSchema,
    );
    const own = pending.node.reviews.nodes.find((node) => node.viewerDidAuthor);
    const event = GRAPHQL_REVIEW_EVENT[review.event];
    const body = review.body.trim() === "" ? {} : { body: review.body };
    yield* githubWrite(
      token,
      own === undefined ? ADD_REVIEW_MUTATION : SUBMIT_PENDING_REVIEW_MUTATION,
      { id: own?.id ?? pullRequestId, event, ...body },
      Schema.Unknown,
    );
  },
);

const THREAD_PULL_REQUEST_QUERY = `query($id: ID!) {
  node(id: $id) { ... on PullRequestReviewThread { pullRequest { id } } }
}`;

const ThreadPullRequestSchema = Schema.Struct({
  node: Schema.NullOr(
    Schema.Struct({
      pullRequest: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
    }),
  ),
});

/** What the member is told where the thread named is none of this pull request's, or none they can see. */
const NOT_THIS_THREAD = "Could not resolve to a review thread on this pull request.";

/**
 * The review thread confirmed one of this pull request's, read on the
 * member's token, so a thread of another pull request is never changed
 * through this one's tab; a thread out of their sight is refused alike.
 */
const threadOnPullRequest = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  threadId: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const read = yield* githubWrite(
    token,
    THREAD_PULL_REQUEST_QUERY,
    { id: threadId },
    ThreadPullRequestSchema,
  );
  if (read.node?.pullRequest?.id !== pullRequestId) return yield* refusalOf([NOT_THIS_THREAD]);
});

const REPLY_MUTATION = `mutation($id: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $id, body: $body }) {
    comment { id }
  }
}`;

const RESOLVE_MUTATION = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { isResolved } }
}`;

const UNRESOLVE_MUTATION = `mutation($id: ID!) {
  unresolveReviewThread(input: { threadId: $id }) { thread { isResolved } }
}`;

/** A reply on one of the pull request's review threads, on the member's token, published at once. */
export const replyToReviewThread = /* @__PURE__ */ Effect.fn("web/replyToReviewThread")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  reply: { readonly threadId: string; readonly body: string },
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* threadOnPullRequest(token, pullRequestId, reply.threadId);
  yield* githubWrite(
    token,
    REPLY_MUTATION,
    { id: reply.threadId, body: reply.body },
    Schema.Unknown,
  );
});

/** One of the pull request's review threads marked resolved, or opened again where `resolved` is false, on the member's token. */
export const setReviewThreadResolved = /* @__PURE__ */ Effect.fn("web/setReviewThreadResolved")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
    threadId: string,
    resolved: boolean,
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    yield* threadOnPullRequest(token, pullRequestId, threadId);
    yield* githubWrite(
      token,
      resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION,
      { id: threadId },
      Schema.Unknown,
    );
  },
);

/** Each merge method as GitHub's GraphQL spells it. */
const GRAPHQL_MERGE_METHOD = {
  [MERGE_METHOD.MERGE]: "MERGE",
  [MERGE_METHOD.SQUASH]: "SQUASH",
  [MERGE_METHOD.REBASE]: "REBASE",
} as const satisfies Record<MergeMethod, string>;

const MERGE_MUTATION = `mutation($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID!) {
  mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) {
    pullRequest { merged }
  }
}`;

/**
 * The pull request merged now by the method given, on the member's token,
 * against the head they saw: GitHub refuses it where the head has moved
 * since, the method is not allowed, or a rule still stands in the way.
 */
export const mergePullRequest = /* @__PURE__ */ Effect.fn("web/mergePullRequest")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  method: MergeMethod,
  headSha: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(
    token,
    MERGE_MUTATION,
    { id: pullRequestId, method: GRAPHQL_MERGE_METHOD[method], head: headSha },
    Schema.Unknown,
  );
});

const ENABLE_AUTO_MERGE_MUTATION = `mutation($id: ID!, $method: PullRequestMergeMethod, $head: GitObjectID!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $head }) {
    clientMutationId
  }
}`;

const DISABLE_AUTO_MERGE_MUTATION = `mutation($id: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId }
}`;

/** What auto-merge is turned on with: the method, none on a base a merge queue merges, and the head the member saw. */
interface AutoMerge {
  readonly method: MergeMethod | undefined;
  readonly headSha: string;
}

/**
 * Auto-merge turned on for the pull request as given, or off where none is
 * given, on the member's token. On a base merged through a merge queue,
 * turning it on is how a pull request is added to the queue once it is
 * ready, as `gh pr merge --auto` adds one, the queue's method standing.
 */
export const setAutoMerge = /* @__PURE__ */ Effect.fn("web/setAutoMerge")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  autoMerge: AutoMerge | undefined,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  if (autoMerge === undefined) {
    yield* githubWrite(token, DISABLE_AUTO_MERGE_MUTATION, { id: pullRequestId }, Schema.Unknown);
    return;
  }
  yield* githubWrite(
    token,
    ENABLE_AUTO_MERGE_MUTATION,
    {
      id: pullRequestId,
      head: autoMerge.headSha,
      ...(autoMerge.method === undefined
        ? undefined
        : { method: GRAPHQL_MERGE_METHOD[autoMerge.method] }),
    },
    Schema.Unknown,
  );
});

const DEQUEUE_MUTATION = `mutation($id: ID!) {
  dequeuePullRequest(input: { id: $id }) { clientMutationId }
}`;

/** The pull request taken out of its base's merge queue, on the member's token. */
export const takeOutOfMergeQueue = /* @__PURE__ */ Effect.fn("web/takeOutOfMergeQueue")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(token, DEQUEUE_MUTATION, { id: pullRequestId }, Schema.Unknown);
});

const CLOSE_MUTATION = `mutation($id: ID!) {
  closePullRequest(input: { pullRequestId: $id }) { pullRequest { state } }
}`;

const REOPEN_MUTATION = `mutation($id: ID!) {
  reopenPullRequest(input: { pullRequestId: $id }) { pullRequest { state } }
}`;

/** The pull request closed without merging, or opened again where `open` asks, on the member's token. */
export const setPullRequestOpen = /* @__PURE__ */ Effect.fn("web/setPullRequestOpen")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  open: boolean,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(
    token,
    open ? REOPEN_MUTATION : CLOSE_MUTATION,
    { id: pullRequestId },
    Schema.Unknown,
  );
});

const TITLE_MUTATION = `mutation($id: ID!, $title: String!) {
  updatePullRequest(input: { pullRequestId: $id, title: $title }) { pullRequest { title } }
}`;

/** The pull request's title changed to the one given, on the member's token. */
export const setPullRequestTitle = /* @__PURE__ */ Effect.fn("web/setPullRequestTitle")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  title: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(token, TITLE_MUTATION, { id: pullRequestId, title }, Schema.Unknown);
});

const MARK_VIEWED_MUTATION = `mutation($id: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId }
}`;

const UNMARK_VIEWED_MUTATION = `mutation($id: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId }
}`;

/** One of the pull request's files marked viewed, or unmarked where `viewed` is false, for the member alone, on their token. */
export const setFileViewed = /* @__PURE__ */ Effect.fn("web/setFileViewed")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  path: string,
  viewed: boolean,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(
    token,
    viewed ? MARK_VIEWED_MUTATION : UNMARK_VIEWED_MUTATION,
    { id: pullRequestId, path },
    Schema.Unknown,
  );
});

/** GitHub lists a pull request's files a hundred to a page. */
const VIEWED_PER_PAGE = 100;

const VIEWED_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: ${VIEWED_PER_PAGE}, after: $after) {
        nodes { path viewerViewedState }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

/** GitHub's own word for where a file stands for the viewer, as `FileViewedState` spells it. */
const GRAPHQL_VIEWED_STATE = {
  VIEWED: FILE_VIEWED_STATE.VIEWED,
  UNVIEWED: FILE_VIEWED_STATE.UNVIEWED,
  DISMISSED: FILE_VIEWED_STATE.DISMISSED,
} as const satisfies Record<string, FileViewedState>;

/** GitHub's words for where a file stands, each one `GRAPHQL_VIEWED_STATE` reads. */
const GRAPHQL_VIEWED_STATES = [
  "VIEWED",
  "UNVIEWED",
  "DISMISSED",
] as const satisfies readonly (keyof typeof GRAPHQL_VIEWED_STATE)[];

const ViewedPageSchema = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      pullRequest: Schema.NullOr(
        Schema.Struct({
          files: Schema.NullOr(
            Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  path: Schema.String,
                  viewerViewedState: Schema.Literals(GRAPHQL_VIEWED_STATES),
                }),
              ),
              pageInfo: Schema.Struct({
                hasNextPage: Schema.Boolean,
                endCursor: Schema.NullOr(Schema.String),
              }),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** One file and where it stands for the member. */
export interface FileViewed {
  readonly path: string;
  readonly state: FileViewedState;
}

/**
 * Where each of the pull request's files stands for the member on GitHub,
 * read on their token a page at a time, up to as many as a read of the
 * changes lists; a pull request out of their sight is GitHub's refusal.
 */
export const pullRequestViewedStates = /* @__PURE__ */ Effect.fn("web/pullRequestViewedStates")(
  function* (
    token: Redacted.Redacted,
    fullName: string,
    number: number,
  ): Effect.fn.Return<readonly FileViewed[], GitHubWriteFailure, HttpClient.HttpClient> {
    const [owner = "", name = ""] = fullName.split("/");
    const files: FileViewed[] = [];
    let after: string | null = null;
    while (files.length < PULL_REQUEST_WRITE_BOUNDS.MAX_VIEWED_FILES) {
      const page: typeof ViewedPageSchema.Type = yield* githubWrite(
        token,
        VIEWED_QUERY,
        { owner, name, number, after },
        ViewedPageSchema,
      );
      const listed = page.repository?.pullRequest?.files;
      if (listed === undefined || listed === null) return yield* refusalOf([NOT_RESOLVED]);
      for (const node of listed.nodes) {
        files.push({ path: node.path, state: GRAPHQL_VIEWED_STATE[node.viewerViewedState] });
      }
      if (!listed.pageInfo.hasNextPage || listed.pageInfo.endCursor === null) break;
      after = listed.pageInfo.endCursor;
    }
    return files.slice(0, PULL_REQUEST_WRITE_BOUNDS.MAX_VIEWED_FILES);
  },
);
