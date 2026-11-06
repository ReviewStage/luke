import { Schema as EffectSchema } from "effect";

export const PULL_REQUEST_WRITE_BOUNDS = {
  MAX_REFUSAL_CHARS: 1_000,
  MAX_COMMIT_CHARS: 64,
  MAX_TITLE_CHARS: 256,
  MAX_BODY_CHARS: 65_536,
  MAX_NAME_CHARS: 100,
  MAX_NODE_ID_CHARS: 256,
  MAX_PATH_CHARS: 4_096,
  MAX_VIEWED_FILES: 300,
} as const;

export const MERGE_METHOD = {
  MERGE: "merge",
  SQUASH: "squash",
  REBASE: "rebase",
} as const;

export type MergeMethod = (typeof MERGE_METHOD)[keyof typeof MERGE_METHOD];

export const mergeMethodSchema = EffectSchema.Literals(Object.values(MERGE_METHOD));

const headShaSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_COMMIT_CHARS),
  EffectSchema.isPattern(/^[0-9a-f]+$/u),
);

export const REACTION = {
  THUMBS_UP: "thumbs_up",
  THUMBS_DOWN: "thumbs_down",
  LAUGH: "laugh",
  HOORAY: "hooray",
  CONFUSED: "confused",
  HEART: "heart",
  ROCKET: "rocket",
  EYES: "eyes",
} as const;

export type Reaction = (typeof REACTION)[keyof typeof REACTION];

export const PULL_REQUEST_ACTION = {
  READY_FOR_REVIEW: "ready-for-review",
  CONVERT_TO_DRAFT: "convert-to-draft",
  MERGE: "merge",
  ENABLE_AUTO_MERGE: "enable-auto-merge",
  DISABLE_AUTO_MERGE: "disable-auto-merge",
  DEQUEUE: "dequeue",
  CLOSE: "close",
  REOPEN: "reopen",
  EDIT_TITLE: "edit-title",
  EDIT_DESCRIPTION: "edit-description",
  SUBMIT_REVIEW: "submit-review",
  REQUEST_REVIEW: "request-review",
  REMOVE_REVIEW_REQUEST: "remove-review-request",
  ADD_LABEL: "add-label",
  REMOVE_LABEL: "remove-label",
  REPLY_TO_THREAD: "reply-to-thread",
  RESOLVE_THREAD: "resolve-thread",
  UNRESOLVE_THREAD: "unresolve-thread",
  COMMENT: "comment",
  ADD_REACTION: "add-reaction",
  REMOVE_REACTION: "remove-reaction",
  ADD_REVIEW_COMMENT: "add-review-comment",
  DISCARD_REVIEW: "discard-review",
  EDIT_REVIEW_COMMENT: "edit-review-comment",
  DELETE_REVIEW_COMMENT: "delete-review-comment",
  MARK_FILE_VIEWED: "mark-file-viewed",
  UNMARK_FILE_VIEWED: "unmark-file-viewed",
} as const;

export type PullRequestAction = (typeof PULL_REQUEST_ACTION)[keyof typeof PULL_REQUEST_ACTION];

export const REVIEW_EVENT = {
  COMMENT: "comment",
  APPROVE: "approve",
  REQUEST_CHANGES: "request-changes",
} as const;

export type ReviewEvent = (typeof REVIEW_EVENT)[keyof typeof REVIEW_EVENT];

export const REVIEW_COMMENT_MODE = {
  SINGLE: "single",
  REVIEW: "review",
} as const;

export type ReviewCommentMode = (typeof REVIEW_COMMENT_MODE)[keyof typeof REVIEW_COMMENT_MODE];

export const REVIEW_COMMENT_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type ReviewCommentSide = (typeof REVIEW_COMMENT_SIDE)[keyof typeof REVIEW_COMMENT_SIDE];

const reviewCommentSideSchema = EffectSchema.Literals(Object.values(REVIEW_COMMENT_SIDE));

const fileLineSchema = EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1));

const reviewBodySchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS),
);

export const REVIEWER_KIND = {
  USER: "user",
  TEAM: "team",
} as const;

const writeName = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NAME_CHARS),
);

const reviewerSchema = EffectSchema.Struct({
  kind: EffectSchema.Literals(Object.values(REVIEWER_KIND)),
  name: writeName,
});

export type PullRequestReviewerRef = typeof reviewerSchema.Type;

const threadIdSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NODE_ID_CHARS),
);

const subjectIdSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NODE_ID_CHARS),
);

const filePathSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_PATH_CHARS),
);

const replyBodySchema = reviewBodySchema.check(EffectSchema.isPattern(/\S/u));

const reviewCommentIdSchema = EffectSchema.NonEmptyString.check(
  EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_NODE_ID_CHARS),
);

export const pullRequestActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.READY_FOR_REVIEW) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.CONVERT_TO_DRAFT) }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.MERGE),
    method: mergeMethodSchema,
    headSha: headShaSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE),
    method: EffectSchema.optionalKey(mergeMethodSchema),
    headSha: headShaSchema,
  }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.DEQUEUE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.CLOSE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.REOPEN) }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.EDIT_TITLE),
    title: EffectSchema.Trim.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_TITLE_CHARS),
    ),
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.EDIT_DESCRIPTION),
    body: reviewBodySchema,
    expectedBody: reviewBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.SUBMIT_REVIEW),
    event: EffectSchema.Literals(Object.values(REVIEW_EVENT)),
    body: reviewBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REQUEST_REVIEW),
    reviewer: reviewerSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST),
    reviewer: reviewerSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.ADD_LABEL),
    label: writeName,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REMOVE_LABEL),
    label: writeName,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.REPLY_TO_THREAD),
    threadId: threadIdSchema,
    body: replyBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.RESOLVE_THREAD),
    threadId: threadIdSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.UNRESOLVE_THREAD),
    threadId: threadIdSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.COMMENT),
    body: replyBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literals([
      PULL_REQUEST_ACTION.ADD_REACTION,
      PULL_REQUEST_ACTION.REMOVE_REACTION,
    ]),
    subject: subjectIdSchema,
    content: EffectSchema.Literals(Object.values(REACTION)),
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT),
    mode: EffectSchema.Literals(Object.values(REVIEW_COMMENT_MODE)),
    path: EffectSchema.NonEmptyString.check(
      EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_PATH_CHARS),
    ),
    line: fileLineSchema,
    side: reviewCommentSideSchema,
    startLine: EffectSchema.optionalKey(fileLineSchema),
    startSide: EffectSchema.optionalKey(reviewCommentSideSchema),
    body: replyBodySchema,
    headSha: headShaSchema,
  }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PULL_REQUEST_ACTION.DISCARD_REVIEW) }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT),
    commentId: reviewCommentIdSchema,
    body: replyBodySchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT),
    commentId: reviewCommentIdSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.MARK_FILE_VIEWED),
    path: filePathSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED),
    path: filePathSchema,
  }),
]);

export type PullRequestActionRequest = typeof pullRequestActionRequestSchema.Type;

export const PULL_REQUEST_WRITE_OUTCOME = {
  DONE: "done",
  SIGN_IN_REQUIRED: "sign-in-required",
  REFUSED: "refused",
} as const;

export const PULL_REQUEST_REFUSAL = {
  DESCRIPTION_CHANGED: "description-changed",
} as const;

export type PullRequestRefusal = (typeof PULL_REQUEST_REFUSAL)[keyof typeof PULL_REQUEST_REFUSAL];

export const pullRequestWriteAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.DONE) }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED),
  }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.REFUSED),
    words: EffectSchema.String.check(
      EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_REFUSAL_CHARS),
    ),
    reason: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(PULL_REQUEST_REFUSAL))),
  }),
]);

export type PullRequestWriteAnswer = typeof pullRequestWriteAnswerSchema.Type;

export const FILE_VIEWED_STATE = {
  VIEWED: "viewed",
  UNVIEWED: "unviewed",
  DISMISSED: "dismissed",
} as const;

export type FileViewedState = (typeof FILE_VIEWED_STATE)[keyof typeof FILE_VIEWED_STATE];

export const pullRequestViewedAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.DONE),
    files: EffectSchema.Array(
      EffectSchema.Struct({
        path: EffectSchema.String,
        state: EffectSchema.Literals(Object.values(FILE_VIEWED_STATE)),
      }),
    ).check(EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_VIEWED_FILES)),
  }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED),
  }),
  EffectSchema.Struct({
    outcome: EffectSchema.Literal(PULL_REQUEST_WRITE_OUTCOME.REFUSED),
    words: EffectSchema.String.check(
      EffectSchema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_REFUSAL_CHARS),
    ),
  }),
]);

export type PullRequestViewedAnswer = typeof pullRequestViewedAnswerSchema.Type;
