import {
  FILE_VIEWED_STATE,
  type FileViewedState,
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_REFUSAL,
  PULL_REQUEST_WRITE_BOUNDS,
  type PullRequestRefusal,
  type PullRequestReviewerRef,
  REVIEW_COMMENT_MODE,
  REVIEW_COMMENT_SIDE,
  REVIEW_EVENT,
  REVIEWER_KIND,
  type ReviewCommentMode,
  type ReviewCommentSide,
  type ReviewEvent,
} from "@repo/features/pull-request-write-wire";
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

const GRAPHQL_PATH = "/graphql";

class GitHubTokenRefused extends Data.TaggedError("GitHubTokenRefused") {
  override get message(): string {
    return "GitHub refused the member's token";
  }
}

class GitHubWriteRefused extends Data.TaggedError("GitHubWriteRefused")<{
  readonly words: string;
  readonly reason?: PullRequestRefusal;
}> {
  override get message(): string {
    return "GitHub refused the change";
  }
}

export type GitHubWriteFailure = GitHubTokenRefused | GitHubWriteRefused | GitHubUnavailable;

const GraphqlAnswerSchema = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const RefusalSchema = Schema.Struct({ message: Schema.String });

function refusalOf(messages: readonly string[]): GitHubWriteRefused {
  return new GitHubWriteRefused({
    words: messages.join(" ").slice(0, PULL_REQUEST_WRITE_BOUNDS.MAX_REFUSAL_CHARS),
  });
}

function unreadable(status: number): GitHubUnavailable {
  return new GitHubUnavailable({ reason: GITHUB_FAILURE.UNREADABLE, status });
}

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

function succeeded(response: HttpClientResponse.HttpClientResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

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

const NodeIdSchema = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({ pullRequest: Schema.NullOr(Schema.Struct({ id: Schema.String })) }),
  ),
});

const NOT_RESOLVED = "Could not resolve to a pull request your GitHub account can see.";

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

const GRAPHQL_REVIEW_EVENT = {
  [REVIEW_EVENT.COMMENT]: "COMMENT",
  [REVIEW_EVENT.APPROVE]: "APPROVE",
  [REVIEW_EVENT.REQUEST_CHANGES]: "REQUEST_CHANGES",
} as const satisfies Record<ReviewEvent, string>;

const PENDING_REVIEWS_READ = 10;

const PENDING_REVIEW_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      reviews(states: PENDING, first: ${PENDING_REVIEWS_READ}) { nodes { id viewerDidAuthor commit { oid } } }
    }
  }
}`;

const PendingReviewsSchema = Schema.Struct({
  node: Schema.Struct({
    reviews: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          viewerDidAuthor: Schema.Boolean,
          commit: Schema.optionalKey(Schema.NullOr(Schema.Struct({ oid: Schema.String }))),
        }),
      ),
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

const ownPendingReview = (token: Redacted.Redacted, pullRequestId: string) =>
  Effect.map(
    githubWrite(token, PENDING_REVIEW_QUERY, { id: pullRequestId }, PendingReviewsSchema),
    (pending) => pending.node.reviews.nodes.find((node) => node.viewerDidAuthor),
  );

export const submitPullRequestReview = /* @__PURE__ */ Effect.fn("web/submitPullRequestReview")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
    review: { readonly event: ReviewEvent; readonly body: string },
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    const own = yield* ownPendingReview(token, pullRequestId);
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

const REST_METHOD = { POST: "POST", DELETE: "DELETE" } as const;

type RestMethod = (typeof REST_METHOD)[keyof typeof REST_METHOD];

type RestWriteBody =
  | { readonly reviewers: readonly string[] }
  | { readonly team_reviewers: readonly string[] }
  | { readonly labels: readonly string[] };

function segment(value: string): string {
  return encodeURIComponent(value);
}

function repositoryPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${segment(owner)}/${segment(name)}`;
}

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

export const setLabeled = /* @__PURE__ */ Effect.fn("web/setLabeled")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
  label: string,
  labeled: boolean,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const labels = `${repositoryPath(fullName)}/issues/${number}/labels`;
  yield* labeled
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

const NOT_THIS_THREAD = "Could not resolve to a review thread on this pull request.";

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

interface AutoMerge {
  readonly method: MergeMethod | undefined;
  readonly headSha: string;
}

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

export const takeOutOfMergeQueue = /* @__PURE__ */ Effect.fn("web/takeOutOfMergeQueue")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(token, DEQUEUE_MUTATION, { id: pullRequestId }, Schema.Unknown);
});

const COMMENT_MUTATION = `mutation($id: ID!, $body: String!) {
  addComment(input: { subjectId: $id, body: $body }) { commentEdge { node { id } } }
}`;

export const commentOnPullRequest = /* @__PURE__ */ Effect.fn("web/commentOnPullRequest")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
    body: string,
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    yield* githubWrite(token, COMMENT_MUTATION, { id: pullRequestId, body }, Schema.Unknown);
  },
);

const GRAPHQL_DIFF_SIDE = {
  [REVIEW_COMMENT_SIDE.LEFT]: "LEFT",
  [REVIEW_COMMENT_SIDE.RIGHT]: "RIGHT",
} as const satisfies Record<ReviewCommentSide, string>;

export interface LineComment {
  readonly mode: ReviewCommentMode;
  readonly path: string;
  readonly line: number;
  readonly side: ReviewCommentSide;
  readonly startLine?: number;
  readonly startSide?: ReviewCommentSide;
  readonly body: string;
  readonly headSha: string;
}

const THREAD_VARIABLES =
  "$path: String!, $body: String!, $line: Int!, $side: DiffSide!, $startLine: Int, $startSide: DiffSide";
const THREAD_FIELDS =
  "path: $path, body: $body, line: $line, side: $side, startLine: $startLine, startSide: $startSide";

const SINGLE_COMMENT_MUTATION = `mutation($id: ID!, $commit: GitObjectID!, ${THREAD_VARIABLES}) {
  addPullRequestReview(input: { pullRequestId: $id, commitOID: $commit, event: COMMENT, threads: [{ ${THREAD_FIELDS} }] }) {
    pullRequestReview { id }
  }
}`;

const START_REVIEW_MUTATION = `mutation($id: ID!, $commit: GitObjectID!, ${THREAD_VARIABLES}) {
  addPullRequestReview(input: { pullRequestId: $id, commitOID: $commit, threads: [{ ${THREAD_FIELDS} }] }) {
    pullRequestReview { id }
  }
}`;

const REVIEW_THREAD_MUTATION = `mutation($review: ID!, ${THREAD_VARIABLES}) {
  addPullRequestReviewThread(input: { pullRequestReviewId: $review, ${THREAD_FIELDS} }) { thread { id } }
}`;

function threadVariables(comment: LineComment) {
  return {
    path: comment.path,
    body: comment.body,
    line: comment.line,
    side: GRAPHQL_DIFF_SIDE[comment.side],
    ...(comment.startLine === undefined ? undefined : { startLine: comment.startLine }),
    ...(comment.startSide === undefined
      ? undefined
      : { startSide: GRAPHQL_DIFF_SIDE[comment.startSide] }),
  };
}

const PENDING_ON_OTHER_COMMIT =
  "Your pending review was started on another commit. Submit or discard it, then refresh changes to comment on these lines.";

export const addLineComment = /* @__PURE__ */ Effect.fn("web/addLineComment")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  comment: LineComment,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const thread = threadVariables(comment);
  if (comment.mode === REVIEW_COMMENT_MODE.SINGLE) {
    yield* githubWrite(
      token,
      SINGLE_COMMENT_MUTATION,
      { id: pullRequestId, commit: comment.headSha, ...thread },
      Schema.Unknown,
    );
    return;
  }
  const own = yield* ownPendingReview(token, pullRequestId);
  if (own === undefined) {
    yield* githubWrite(
      token,
      START_REVIEW_MUTATION,
      { id: pullRequestId, commit: comment.headSha, ...thread },
      Schema.Unknown,
    );
    return;
  }
  const started = own.commit?.oid;
  if (started !== undefined && started !== comment.headSha) {
    return yield* refusalOf([PENDING_ON_OTHER_COMMIT]);
  }
  yield* githubWrite(token, REVIEW_THREAD_MUTATION, { review: own.id, ...thread }, Schema.Unknown);
});

const DISCARD_REVIEW_MUTATION = `mutation($id: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $id }) { pullRequestReview { id } }
}`;

const NO_PENDING_REVIEW = "You have no pending review on this pull request.";

export const discardPendingReview = /* @__PURE__ */ Effect.fn("web/discardPendingReview")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    const own = yield* ownPendingReview(token, pullRequestId);
    if (own === undefined) return yield* refusalOf([NO_PENDING_REVIEW]);
    yield* githubWrite(token, DISCARD_REVIEW_MUTATION, { id: own.id }, Schema.Unknown);
  },
);

const REVIEW_COMMENT_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on PullRequestReviewComment { viewerDidAuthor state pullRequest { id } }
  }
}`;

const ReviewCommentSchema = Schema.Struct({
  node: Schema.NullOr(
    Schema.Struct({
      viewerDidAuthor: Schema.optionalKey(Schema.Boolean),
      state: Schema.optionalKey(Schema.String),
      pullRequest: Schema.optionalKey(Schema.Struct({ id: Schema.String })),
    }),
  ),
});

const NOT_OWN_PENDING_COMMENT =
  "That comment is not one of your pending review's on this pull request.";

const ownPendingComment = /* @__PURE__ */ Effect.fn("web/ownPendingComment")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  commentId: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  const read = yield* githubWrite(
    token,
    REVIEW_COMMENT_QUERY,
    { id: commentId },
    ReviewCommentSchema,
  );
  const comment = read.node;
  const own =
    comment?.viewerDidAuthor === true &&
    comment.state === "PENDING" &&
    comment.pullRequest?.id === pullRequestId;
  if (!own) return yield* refusalOf([NOT_OWN_PENDING_COMMENT]);
});

const EDIT_REVIEW_COMMENT_MUTATION = `mutation($id: ID!, $body: String!) {
  updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
    pullRequestReviewComment { id }
  }
}`;

const DELETE_REVIEW_COMMENT_MUTATION = `mutation($id: ID!) {
  deletePullRequestReviewComment(input: { id: $id }) { pullRequestReview { id } }
}`;

export const editPendingComment = /* @__PURE__ */ Effect.fn("web/editPendingComment")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  comment: { readonly commentId: string; readonly body: string },
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* ownPendingComment(token, pullRequestId, comment.commentId);
  yield* githubWrite(
    token,
    EDIT_REVIEW_COMMENT_MUTATION,
    { id: comment.commentId, body: comment.body },
    Schema.Unknown,
  );
});

export const deletePendingComment = /* @__PURE__ */ Effect.fn("web/deletePendingComment")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
    commentId: string,
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    yield* ownPendingComment(token, pullRequestId, commentId);
    yield* githubWrite(token, DELETE_REVIEW_COMMENT_MUTATION, { id: commentId }, Schema.Unknown);
  },
);

const CLOSE_MUTATION = `mutation($id: ID!) {
  closePullRequest(input: { pullRequestId: $id }) { pullRequest { state } }
}`;

const REOPEN_MUTATION = `mutation($id: ID!) {
  reopenPullRequest(input: { pullRequestId: $id }) { pullRequest { state } }
}`;

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

export const setPullRequestTitle = /* @__PURE__ */ Effect.fn("web/setPullRequestTitle")(function* (
  token: Redacted.Redacted,
  pullRequestId: string,
  title: string,
): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
  yield* githubWrite(token, TITLE_MUTATION, { id: pullRequestId, title }, Schema.Unknown);
});

const DESCRIPTION_QUERY = `query($id: ID!) {
  node(id: $id) { ... on PullRequest { body } }
}`;

const DescriptionSchema = Schema.Struct({
  node: Schema.NullOr(Schema.Struct({ body: Schema.optionalKey(Schema.String) })),
});

const DESCRIPTION_MUTATION = `mutation($id: ID!, $body: String!) {
  updatePullRequest(input: { pullRequestId: $id, body: $body }) { pullRequest { id } }
}`;

const DESCRIPTION_CHANGED =
  "The description changed on GitHub since you opened it. Reload it to see the change before saving yours.";

function comparable(body: string): string {
  return body.replaceAll("\r\n", "\n");
}

export interface DescriptionEdit {
  readonly body: string;
  readonly expectedBody: string;
}

export const setPullRequestDescription = /* @__PURE__ */ Effect.fn("web/setPullRequestDescription")(
  function* (
    token: Redacted.Redacted,
    pullRequestId: string,
    edit: DescriptionEdit,
  ): Effect.fn.Return<void, GitHubWriteFailure, HttpClient.HttpClient> {
    const read = yield* githubWrite(
      token,
      DESCRIPTION_QUERY,
      { id: pullRequestId },
      DescriptionSchema,
    );
    if (read.node === null) return yield* refusalOf([NOT_RESOLVED]);
    if (comparable(read.node.body ?? "") !== comparable(edit.expectedBody)) {
      return yield* new GitHubWriteRefused({
        words: DESCRIPTION_CHANGED,
        reason: PULL_REQUEST_REFUSAL.DESCRIPTION_CHANGED,
      });
    }
    yield* githubWrite(
      token,
      DESCRIPTION_MUTATION,
      { id: pullRequestId, body: edit.body },
      Schema.Unknown,
    );
  },
);

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

const NOT_THIS_SUBJECT = "Could not resolve to a comment on this pull request.";

const ADD_REACTION_MUTATION = `mutation($id: ID!, $content: ReactionContent!) {
  addReaction(input: { subjectId: $id, content: $content }) { reaction { content } }
}`;

const REMOVE_REACTION_MUTATION = `mutation($id: ID!, $content: ReactionContent!) {
  removeReaction(input: { subjectId: $id, content: $content }) { reaction { content } }
}`;

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
  const on = node?.pullRequest?.id ?? node?.issue?.id ?? node?.id;
  if (on !== pullRequestId) return yield* refusalOf([NOT_THIS_SUBJECT]);
  yield* githubWrite(
    token,
    add ? ADD_REACTION_MUTATION : REMOVE_REACTION_MUTATION,
    { id: subject, content },
    Schema.Unknown,
  );
});

const MARK_VIEWED_MUTATION = `mutation($id: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId }
}`;

const UNMARK_VIEWED_MUTATION = `mutation($id: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $id, path: $path }) { clientMutationId }
}`;

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

const GRAPHQL_VIEWED_STATE = {
  VIEWED: FILE_VIEWED_STATE.VIEWED,
  UNVIEWED: FILE_VIEWED_STATE.UNVIEWED,
  DISMISSED: FILE_VIEWED_STATE.DISMISSED,
} as const satisfies Record<string, FileViewedState>;

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

export interface FileViewed {
  readonly path: string;
  readonly state: FileViewedState;
}

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
