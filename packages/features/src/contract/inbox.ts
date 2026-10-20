/**
 * inbox.ts -- what an agent posted for the developer (`inbox-wire.ts`, `account-inbox-wire.ts`), read, answered, closed, messaged, and marked read.
 *
 * The three reads, a task's, an agent's, and the account's, are held by the
 * service while nothing changed since the reader's cursor, and travel as
 * long-held JSON procedures rather than event iterators, so the wire is the
 * one the desktop already reads. A procedure that takes both an item's id
 * and a body is declared `detailed`, so the body is read whole as its own
 * schema; every output is its wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { accountInboxAnswerSchema } from "../account-inbox-wire.js";
import { MAXIMUM_ATTACHMENTS_BODY_BYTES } from "../coding-agent-wire.js";
import {
  INBOX_BOUNDS,
  inboxAnsweredSchema,
  inboxAnswerRequestSchema,
  inboxAnswerSchema,
  inboxCloseRequestSchema,
  inboxCursorSchema,
  inboxMessagedSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
} from "../inbox-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

/** An answer is a note, a few short fields, and the files a message may carry: the note's bound at JSON's widest escape, the files, and room for the rest. */
const ANSWER_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_NOTE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

/** A close is a revision and a key, so a few hundred bytes hold it. */
const CLOSE_BODY_BYTES = 1_024;

/** A message is its words, the files a message may carry, and the answer it may carry: the words' and the answer's picks and values at JSON's widest escape, the files, and room for the key, the ask, and the steps. */
const MESSAGE_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_MESSAGE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

/** A request to mark every item read names at most a workspace, so a few hundred bytes hold it. */
const READ_ALL_BODY_BYTES = 1_024;

/** The public paths that name a task, an agent, or an item by its id. */
const INBOX_PROCEDURE_PATH = {
  TASK: "/api/plans/{id}/inbox",
  AGENT: "/api/agents/{id}/inbox",
  ITEM: "/api/inbox/{id}",
  ITEM_CLOSE: "/api/inbox/{id}/close",
  ITEM_MESSAGES: "/api/inbox/{id}/messages",
  ITEM_READ: "/api/inbox/{id}/read",
} as const;

/** The id a path names; one that is no UUID is answered as not found, so it is read as text here. */
const pathIdSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** A held read past the reader's cursor, the start where it names none. */
const pastCursorSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  after: EffectSchema.optionalKey(inboxCursorSchema),
});

export const inboxContract = {
  account: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.INBOX }))
    .input(
      EffectSchema.Struct({
        after: EffectSchema.optionalKey(inboxCursorSchema),
        archived: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(accountInboxAnswerSchema)),
  task: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: INBOX_PROCEDURE_PATH.TASK }))
    .input(pastCursorSchema)
    .output(EffectSchema.flip(inboxAnswerSchema)),
  agent: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: INBOX_PROCEDURE_PATH.AGENT }))
    .input(pastCursorSchema)
    .output(EffectSchema.flip(inboxAnswerSchema)),
  answer: hostedProcedure
    .meta(bodyCap(ANSWER_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: INBOX_PROCEDURE_PATH.ITEM,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(pathIdSchema, inboxAnswerRequestSchema))
    .output(EffectSchema.flip(inboxAnsweredSchema)),
  close: hostedProcedure
    .meta(bodyCap(CLOSE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: INBOX_PROCEDURE_PATH.ITEM_CLOSE,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(pathIdSchema, inboxCloseRequestSchema))
    .output(EffectSchema.flip(inboxAnsweredSchema)),
  message: hostedProcedure
    .meta(bodyCap(MESSAGE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: INBOX_PROCEDURE_PATH.ITEM_MESSAGES,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(pathIdSchema, inboxMessageRequestSchema))
    .output(EffectSchema.flip(inboxMessagedSchema)),
  markItemRead: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: INBOX_PROCEDURE_PATH.ITEM_READ }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxReadStateSchema)),
  markItemUnread: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: INBOX_PROCEDURE_PATH.ITEM_READ }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxReadStateSchema)),
  markAllRead: hostedProcedure
    .meta(bodyCap(READ_ALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.INBOX_READ }))
    .input(exactInput(inboxReadAllRequestSchema))
    .output(EffectSchema.flip(inboxReadAllSchema)),
};
