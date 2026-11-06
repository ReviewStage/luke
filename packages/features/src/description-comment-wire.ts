import { LEGACY_APP_WORD, literalsReadingLegacy } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { agentMessageRequestSchema } from "./agent-wire.js";
import { pageVersionNumberSchema } from "./page-wire.js";
import { chosenIdSchema, countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { TASK_BOUNDS } from "./task-wire.js";
import { filledText } from "./text-schema.js";

export const DESCRIPTION_COMMENT_BOUNDS = {
  MAX_WORDS_CHARS: 8_000,
  MAX_QUOTE_CHARS: 2_000,
  MAX_THREADS_PER_DESCRIPTION: 500,
  MAX_ENTRIES_PER_THREAD: 200,
  MAX_CLIENT_KEY_CHARS: 200,
  MAX_CURSOR_CHARS: 200,
  MAX_ELEMENT_PATH_CHARS: 1_000,
  MAX_SECTION_CHARS: 200,
} as const;

export const DESCRIPTION_COMMENT_SCOPE = {
  WORDS: "words",
  BLOCK: "block",
  ELEMENT: "element",
  PAGE: "page",
} as const;

export type DescriptionCommentScope =
  (typeof DESCRIPTION_COMMENT_SCOPE)[keyof typeof DESCRIPTION_COMMENT_SCOPE];

export const DESCRIPTION_COMMENT_STATUS = {
  OPEN: "open",
  RESOLVED: "resolved",
} as const;

export type DescriptionCommentStatus =
  (typeof DESCRIPTION_COMMENT_STATUS)[keyof typeof DESCRIPTION_COMMENT_STATUS];

export const DESCRIPTION_COMMENT_ACTOR = {
  MEMBER: "member",
  APP: "app",
  AGENT: "agent",
} as const;

export type DescriptionCommentActor =
  (typeof DESCRIPTION_COMMENT_ACTOR)[keyof typeof DESCRIPTION_COMMENT_ACTOR];

export const descriptionCommentActorSchema = literalsReadingLegacy(
  Object.values(DESCRIPTION_COMMENT_ACTOR),
  LEGACY_APP_WORD,
  DESCRIPTION_COMMENT_ACTOR.APP,
);

export const DESCRIPTION_COMMENT_ENTRY = {
  COMMENT: "comment",
  ASKED: "asked",
  RESOLVED: "resolved",
  REOPENED: "reopened",
} as const;

export type DescriptionCommentEntryKind =
  (typeof DESCRIPTION_COMMENT_ENTRY)[keyof typeof DESCRIPTION_COMMENT_ENTRY];

export const descriptionCommentWordsSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS),
  EffectSchema.isPattern(/\S/u),
);

const descriptionCommentClientKeySchema = filledText(
  DESCRIPTION_COMMENT_BOUNDS.MAX_CLIENT_KEY_CHARS,
);

const descriptionCommentSpanSchema = EffectSchema.Struct({
  from: countedNumber,
  to: countedNumber,
});

const descriptionCommentWriterSchema = EffectSchema.Struct({
  actor: descriptionCommentActorSchema,
  by: EffectSchema.optionalKey(memberRefSchema),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type DescriptionCommentWriter = typeof descriptionCommentWriterSchema.Type;

const descriptionCommentAskedSchema = EffectSchema.Struct({
  actor: literalsReadingLegacy(
    [DESCRIPTION_COMMENT_ACTOR.APP, DESCRIPTION_COMMENT_ACTOR.AGENT],
    LEGACY_APP_WORD,
    DESCRIPTION_COMMENT_ACTOR.APP,
  ),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type DescriptionCommentAsked = typeof descriptionCommentAskedSchema.Type;

const descriptionCommentFileSchema = EffectSchema.Struct({
  attachmentId: wireUuidSchema,
  name: EffectSchema.String,
  mediaType: EffectSchema.String,
});

export type DescriptionCommentFile = typeof descriptionCommentFileSchema.Type;

const descriptionCommentFilesSchema = agentMessageRequestSchema.fields.attachments;

const descriptionCommentEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_ENTRY)),
  writer: descriptionCommentWriterSchema,
  words: EffectSchema.optionalKey(EffectSchema.String),
  files: EffectSchema.optionalKey(EffectSchema.Array(descriptionCommentFileSchema)),
  asked: EffectSchema.optionalKey(descriptionCommentAskedSchema),
  at: countedNumber,
  editedAt: EffectSchema.optionalKey(countedNumber),
});

export type DescriptionCommentEntry = typeof descriptionCommentEntrySchema.Type;

const descriptionCommentElementPathSchema = filledText(
  DESCRIPTION_COMMENT_BOUNDS.MAX_ELEMENT_PATH_CHARS,
);

const descriptionCommentPageSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  version: pageVersionNumberSchema,
  element: EffectSchema.optionalKey(EffectSchema.String),
});

const descriptionCommentThreadSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
  quote: EffectSchema.String,
  anchor: EffectSchema.optionalKey(descriptionCommentSpanSchema),
  page: EffectSchema.optionalKey(descriptionCommentPageSchema),
  section: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_STATUS)),
  entries: EffectSchema.Array(descriptionCommentEntrySchema),
  createdAt: countedNumber,
  updatedAt: countedNumber,
  revision: countedNumber,
});

export type DescriptionCommentThread = typeof descriptionCommentThreadSchema.Type;

export const DESCRIPTION_COMMENTS_CURSOR_START = "0";

export const descriptionCommentsCursorSchema = filledText(
  DESCRIPTION_COMMENT_BOUNDS.MAX_CURSOR_CHARS,
);

export const descriptionCommentsAnswerSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(descriptionCommentThreadSchema),
  cursor: EffectSchema.String,
});

export type DescriptionCommentsAnswer = typeof descriptionCommentsAnswerSchema.Type;

const ANCHOR_TEXT = EffectSchema.String.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS));

const descriptionCommentDescriptionStartSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(chosenIdSchema),
  clientKey: descriptionCommentClientKeySchema,
  scope: EffectSchema.Literals([DESCRIPTION_COMMENT_SCOPE.WORDS, DESCRIPTION_COMMENT_SCOPE.BLOCK]),
  quote: filledText(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
  anchor: descriptionCommentSpanSchema,
  text: ANCHOR_TEXT,
  words: descriptionCommentWordsSchema,
  attachments: descriptionCommentFilesSchema,
});

const descriptionCommentPageStartSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(chosenIdSchema),
  clientKey: descriptionCommentClientKeySchema,
  page: EffectSchema.Struct({ id: wireUuidSchema, version: pageVersionNumberSchema }),
  element: EffectSchema.optionalKey(
    EffectSchema.Struct({
      path: descriptionCommentElementPathSchema,
      quote: filledText(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
      section: EffectSchema.String.check(
        EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_SECTION_CHARS),
      ),
      words: EffectSchema.optionalKey(EffectSchema.Literal(true)),
    }),
  ),
  words: descriptionCommentWordsSchema,
  attachments: descriptionCommentFilesSchema,
  held: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  along: EffectSchema.optionalKey(
    EffectSchema.Array(wireUuidSchema).check(
      EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION),
    ),
  ),
});

export type DescriptionCommentStartRequest = typeof descriptionCommentDescriptionStartSchema.Type;

export type DescriptionCommentPageStart = typeof descriptionCommentPageStartSchema.Type;

export const descriptionCommentStartRequestSchema = EffectSchema.Union([
  descriptionCommentDescriptionStartSchema,
  descriptionCommentPageStartSchema,
]);

export type DescriptionCommentStart = typeof descriptionCommentStartRequestSchema.Type;

export const DESCRIPTION_COMMENT_ACTION = {
  REPLY: "reply",
  EDIT: "edit",
  DELETE: "delete",
  RESOLVE: "resolve",
  REOPEN: "reopen",
  DELETE_THREAD: "delete-thread",
  ASK: "ask",
} as const;

export const descriptionCommentActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({
    action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.REPLY),
    clientKey: descriptionCommentClientKeySchema,
    words: descriptionCommentWordsSchema,
    attachments: descriptionCommentFilesSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.EDIT),
    entry: wireUuidSchema,
    words: descriptionCommentWordsSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.DELETE),
    entry: wireUuidSchema,
  }),
  EffectSchema.Struct({ action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.RESOLVE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.REOPEN) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.DELETE_THREAD) }),
]);

export type DescriptionCommentActionRequest = typeof descriptionCommentActionRequestSchema.Type;

export interface DescriptionCommentAskRequest {
  readonly action: typeof DESCRIPTION_COMMENT_ACTION.ASK;
  readonly clientKey: string;
  readonly to: DescriptionCommentAsked;
}

export const DESCRIPTION_COMMENT_REFUSAL = {
  TOO_MANY: "too-many",
  NO_WORDS: "no-words",
  NOT_YOURS: "not-yours",
  NO_ENTRY: "no-entry",
  KEY_TAKEN: "key-taken",
} as const;

export type DescriptionCommentRefusal =
  (typeof DESCRIPTION_COMMENT_REFUSAL)[keyof typeof DESCRIPTION_COMMENT_REFUSAL];

const writtenTxidSchema = EffectSchema.optionalKey(EffectSchema.String);

export const descriptionCommentThreadAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    thread: descriptionCommentThreadSchema,
    unsent: EffectSchema.optionalKey(EffectSchema.Array(descriptionCommentAskedSchema)),
    txid: writtenTxidSchema,
  }),
  EffectSchema.Struct({ deleted: wireUuidSchema, txid: writtenTxidSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_REFUSAL)),
  }),
]);

export type DescriptionCommentThreadAnswer = typeof descriptionCommentThreadAnswerSchema.Type;

export const descriptionCommentAnchorsSchema = EffectSchema.Struct({
  anchors: EffectSchema.Array(
    EffectSchema.Struct({ thread: wireUuidSchema, ...descriptionCommentSpanSchema.fields }),
  ).check(EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION)),
  carried: EffectSchema.Array(wireUuidSchema).check(
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION),
  ),
});

export type DescriptionCommentAnchors = typeof descriptionCommentAnchorsSchema.Type;

export const DESCRIPTION_COMMENT_TOOL = {
  READ: "read_comments",
  REPLY: "reply_to_comment",
  UPDATE: "update_comment",
} as const;
