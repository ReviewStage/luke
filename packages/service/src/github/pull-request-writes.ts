/**
 * pull-request-writes.ts -- a change to a pull request on GitHub, on the token of the member who asked for it: one GraphQL or REST call, its refusals told apart.
 *
 * Every write here runs on a member's own GitHub App user token
 * (`github-app.ts`'s `userToken`), handed in by the one seam that resolves it
 * (`agents/pull-request-write.ts`), never on an installation token, so what
 * the member may do on GitHub bounds what they do through Luke. A write is
 * one call of GitHub's GraphQL API (`githubWrite`), or, for its requested
 * reviewers and its labels, of its REST API (`githubRestWrite`), composed
 * over the App module's own kit (`githubPost`, `send`), so a token leaves
 * this module no more than it leaves that one. What GitHub answers is told apart three
 * ways: a token GitHub will not take (401), which the member mends by
 * signing in with GitHub again; a change GitHub refused, in its own words,
 * whether as GraphQL errors on a 200 or as a refusal status with a message
 * (a missing permission, a branch protection, a rate limit); and a GitHub
 * that could not be reached or answered in no shape the call reads.
 * Nothing of the token, the request, or GitHub's body reaches a log line.
 */

import {
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_WRITE_BOUNDS,
  type PullRequestReviewerRef,
  REVIEW_EVENT,
  REVIEWER_KIND,
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
  githubSendRequest,
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
 * A status that is not OK read for what it said: a 401 is the token
 * refused, and any other a refusal in GitHub's words where it gave some.
 */
const refusedStatus = /* @__PURE__ */ Effect.fnUntraced(function* (
  response: HttpClientResponse.HttpClientResponse,
): Effect.fn.Return<never, GitHubWriteFailure> {
  if (response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED) {
    return yield* new GitHubTokenRefused();
  }
  const refusal = yield* HttpClientResponse.schemaBodyJson(RefusalSchema)(response).pipe(
    Effect.mapError(
      () => new GitHubUnavailable({ reason: GITHUB_FAILURE.STATUS, status: response.status }),
    ),
  );
  return yield* refusalOf([refusal.message]);
});

/** Whether a status is one of GitHub's OK answers. */
function succeeded(response: HttpClientResponse.HttpClientResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

/**
 * The answer to a GraphQL call read for what it said: a status that is not
 * OK as `refusedStatus` reads it, and an OK answer carrying errors a
 * refusal in GitHub's words.
 */
const readWrite = /* @__PURE__ */ Effect.fnUntraced(function* <A>(
  response: HttpClientResponse.HttpClientResponse,
  data: Schema.Codec<A, unknown>,
): Effect.fn.Return<A, GitHubWriteFailure> {
  if (!succeeded(response)) return yield* refusedStatus(response);
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
  variables: Readonly<Record<string, string | number | boolean>>,
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

/** The REST methods a write on a pull request's people or labels uses. */
const REST_METHOD = { POST: "POST", DELETE: "DELETE" } as const;

type RestMethod = (typeof REST_METHOD)[keyof typeof REST_METHOD];

/** What a REST write on a pull request's people or labels sends: the users or teams it names, or the labels. */
type RestWriteBody =
  | { readonly reviewers: readonly string[] }
  | { readonly team_reviewers: readonly string[] }
  | { readonly labels: readonly string[] };

/** A path segment as GitHub takes it, so a label's name with a slash or a space stays one segment. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/** The repository's own path under the API, each half a segment of its own. */
function repositoryPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${segment(owner)}/${segment(name)}`;
}

/**
 * One call of GitHub's REST API on the member's token, its JSON body where
 * one is given, its answer read only for whether GitHub took it, as a
 * GraphQL write's refusals are told apart. Note that a requested reviewer
 * is taken off only through REST, GraphQL offering no such mutation, so
 * the people and labels writes are REST alike.
 */
const githubRestWrite = (
  token: Redacted.Redacted,
  method: RestMethod,
  path: string,
  body?: RestWriteBody,
): Effect.Effect<void, GitHubWriteFailure, HttpClient.HttpClient> => {
  return Effect.scoped(
    Effect.flatMap(send(githubSendRequest(method, path, token, body)), (response) =>
      succeeded(response) ? Effect.void : refusedStatus(response),
    ),
  );
};

/** A user or a team asked for a review on the pull request, or asked no longer where `requested` says not, on the member's token. */
export const setReviewRequested = /* @__PURE__ */ Effect.fn("web/setReviewRequested")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
  reviewer: PullRequestReviewerRef,
  requested: boolean,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const body: RestWriteBody =
    reviewer.kind === REVIEWER_KIND.TEAM
      ? { team_reviewers: [reviewer.name] }
      : { reviewers: [reviewer.name] };
  yield* githubRestWrite(
    token,
    requested ? REST_METHOD.POST : REST_METHOD.DELETE,
    `${repositoryPath(fullName)}/pulls/${number}/requested_reviewers`,
    body,
  );
});

/** One of the repository's labels put on the pull request, or taken off where `labelled` says not, on the member's token. */
export const setLabelled = /* @__PURE__ */ Effect.fn("web/setLabelled")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
  label: string,
  labelled: boolean,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const labels = `${repositoryPath(fullName)}/issues/${number}/labels`;
  yield* labelled
    ? githubRestWrite(token, REST_METHOD.POST, labels, { labels: [label] })
    : githubRestWrite(token, REST_METHOD.DELETE, `${labels}/${segment(label)}`);
});

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

/**
 * The pull request what a reaction names is on, read on the member's token:
 * the pull request itself, a comment on it, one of its reviews, or a
 * review's comment, each by its GraphQL id.
 */
const SUBJECT_PULL_REQUEST_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on PullRequest { id }
    ... on IssueComment { issue { id } }
    ... on PullRequestReview { pullRequest { id } }
    ... on PullRequestReviewComment { pullRequest { id } }
  }
}`;

const NodeIdOfSchema = Schema.optionalKey(Schema.Struct({ id: Schema.String }));

const SubjectPullRequestSchema = Schema.Struct({
  node: Schema.NullOr(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      issue: NodeIdOfSchema,
      pullRequest: NodeIdOfSchema,
    }),
  ),
});

/** What the member is told where a reaction names nothing of this pull request, or nothing they can see. */
const NOT_THIS_SUBJECT = "Could not resolve to a comment on this pull request.";

const ADD_REACTION_MUTATION = `mutation($id: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $id, content: $content }) { reaction { content } }
}`;

const REMOVE_REACTION_MUTATION = `mutation($id: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $id, content: $content }) { reaction { content } }
}`;

/**
 * A reaction given, or the member's own taken back where `add` is false, on
 * the member's token: what it names is first confirmed this pull request's,
 * its description, a comment, a review, or a review comment, so nothing
 * else on GitHub is reacted to through this one's tab. `content` is the
 * reaction in GitHub's GraphQL words (`ReactionContent`).
 */
export const reactOnPullRequest = /* @__PURE__ */ Effect.fn("web/reactOnPullRequest")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  reaction: { readonly subject: string; readonly content: string; readonly add: boolean },
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const { subject, content, add } = reaction;
  const read = yield* githubWrite(
    token,
    SUBJECT_PULL_REQUEST_QUERY,
    { id: subject },
    SubjectPullRequestSchema,
  );
  const node = read.node;
  // Note that the pull request itself answers its own id; anything on it answers its pull request's.
  const on = node?.pullRequest?.id ?? node?.issue?.id ?? node?.id;
  if (on !== pullRequestId) return yield* refusalOf([NOT_THIS_SUBJECT]);
  yield* githubWrite(
    token,
    add ? ADD_REACTION_MUTATION : REMOVE_REACTION_MUTATION,
    { id: subject, content },
    Schema.Unknown,
  );
});
