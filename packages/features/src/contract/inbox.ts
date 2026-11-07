/**
 * inbox.ts -- what an agent posted for the developer (`inbox-wire.ts`, `account-inbox-wire.ts`), read, answered, closed, messaged, and marked read, and a thread a member starts.
 *
 * The three reads, a task's, an agent's, and the account's, are held by the
 * service while nothing changed since the reader's cursor, and travel as
 * long-held JSON procedures rather than event iterators, so the wire is the
 * one the desktop already reads. A procedure that takes both an item's id
 * and a body is declared `detailed`, so the body is read whole as its own
 * schema; every output is its wire schema flipped
 * (`packages/service/src/orpc/base.ts`).
 *
 * The member's writes and an item's home each declare their own refusals
 * (`declaredProcedure`); the three held reads still declare every refusal
 * (`hostedProcedure`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { ACCOUNT_INBOX_REPOSITORYLESS, accountInboxAnswerSchema } from "../account-inbox-wire.js";
import { MAXIMUM_ATTACHMENTS_BODY_BYTES } from "../agent-wire.js";
import {
  INBOX_BOUNDS,
  inboxAcknowledgeRequestSchema,
  inboxAnsweredSchema,
  inboxAnswerSchema,
  inboxCloseRequestSchema,
  inboxCursorSchema,
  inboxItemHomeSchema,
  inboxMessagedSchema,
  inboxMessageRequestSchema,
  inboxReadAllRequestSchema,
  inboxReadAllSchema,
  inboxReadStateSchema,
  inboxRemindRequestSchema,
  inboxStartRequestSchema,
} from "../inbox-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  bodyCap,
  declaredProcedure,
  exactBodyInput,
  exactInput,
  hostedProcedure,
  refuses,
} from "./base.js";

/** A nod is a revision and a key, so a few hundred bytes hold it. */
const NOD_BODY_BYTES = 1_024;

/** A close is a revision, a key, and the note it may carry: the note's words at JSON's widest escape, its files, and room for the rest. */
const CLOSE_BODY_BYTES =
  6 * INBOX_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 2_048;

/** A message is its words, the files a message may carry, and the answer it may carry: the words' and the answer's picks and values at JSON's widest escape, the files, and room for the key, the ask, and the steps. */
const MESSAGE_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_MESSAGE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

/** A new thread is a subject, its first message's words and files, and room for the agent's id and the key: the words at JSON's widest escape, the files, and the rest. */
const START_BODY_BYTES =
  6 * (INBOX_BOUNDS.MAX_TITLE_CHARS + INBOX_BOUNDS.MAX_MESSAGE_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

/** A request to mark every item read names at most a workspace, so a few hundred bytes hold it. */
const READ_ALL_BODY_BYTES = 1_024;

/** A reminder is one instant or none, so a few hundred bytes hold it. */
const REMIND_BODY_BYTES = 1_024;

/**
 * What a member's words on a thread refuse, an answer, a close, a message,
 * or a new thread, each handed to the item's agent as a message through the
 * one steer path (`coder-host/steer.ts`'s `steerAgentWritten`): the item or
 * its agent not found or not the caller's to write to, its session ended for
 * good, and every refusal a message to an agent answers
 * (`contract/messages.ts`'s), words past the bound and GitHub unanswered
 * among them, which the steer never answers here but the client has always
 * read as its own. A nod on an item holding an ask open, or a message that
 * answers none, is an invalid request.
 */
const THREAD_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.MESSAGE_TOO_LONG,
  HOSTED_API_ERROR.AGENT_NOT_READY,
  HOSTED_API_ERROR.AGENT_RETIRED,
  HOSTED_API_ERROR.DEVICE_REMOVED,
  HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
  HOSTED_API_ERROR.GITHUB_UNANSWERED,
  HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE,
  HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT,
  HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE,
  HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED,
  HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE,
  HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING,
  HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE,
  HOSTED_API_ERROR.LOCAL_AGENT_REFUSED,
] as const;

/** A message on a thread, or a new one. */
const threadProcedure = declaredProcedure.errors(refuses(...THREAD_REFUSALS));

/** An answer or a close, each taken once under its idempotency key, which refuses a key already written under (`writeReceiptMiddleware`). */
const settleProcedure = declaredProcedure.errors(
  refuses(...THREAD_REFUSALS, HOSTED_API_ERROR.ALREADY_WRITTEN),
);

/** An item's home, read by its id, which refuses one not found: one the account may not read, or an id that is no UUID. */
const homeProcedure = declaredProcedure.errors(refuses(HOSTED_API_ERROR.NOT_FOUND));

/** One item's read state or reminder written, under its idempotency key: the item not found, or a key already written under. */
const readStateProcedure = declaredProcedure.errors(
  refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.ALREADY_WRITTEN),
);

/** Every item marked read, under its idempotency key: a key already written under. */
const readAllProcedure = declaredProcedure.errors(refuses(HOSTED_API_ERROR.ALREADY_WRITTEN));

/** The public paths that name a task, an agent, or an item by its id. */
const INBOX_PROCEDURE_PATH = {
  TASK: "/api/plans/{id}/inbox",
  AGENT: "/api/agents/{id}/inbox",
  ITEM: "/api/inbox/{id}",
  ITEM_CLOSE: "/api/inbox/{id}/close",
  ITEM_MESSAGES: "/api/inbox/{id}/messages",
  ITEM_READ: "/api/inbox/{id}/read",
  ITEM_REMIND: "/api/inbox/{id}/remind",
  ITEM_SNOOZE: "/api/inbox/{id}/snooze",
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
        [ACCOUNT_INBOX_REPOSITORYLESS.QUERY]: EffectSchema.optionalKey(
          EffectSchema.Literal(ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
        ),
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
  home: homeProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: INBOX_PROCEDURE_PATH.ITEM }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxItemHomeSchema)),
  answer: settleProcedure
    .meta(bodyCap(NOD_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: INBOX_PROCEDURE_PATH.ITEM,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(pathIdSchema, inboxAcknowledgeRequestSchema))
    .output(EffectSchema.flip(inboxAnsweredSchema)),
  close: settleProcedure
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
  message: threadProcedure
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
  start: threadProcedure
    .meta(bodyCap(START_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.INBOX }))
    .input(exactInput(inboxStartRequestSchema))
    .output(EffectSchema.flip(inboxMessagedSchema)),
  markItemRead: readStateProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: INBOX_PROCEDURE_PATH.ITEM_READ }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxReadStateSchema)),
  markItemUnread: readStateProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: INBOX_PROCEDURE_PATH.ITEM_READ }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxReadStateSchema)),
  remindItem: readStateProcedure
    .meta(bodyCap(REMIND_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: INBOX_PROCEDURE_PATH.ITEM_REMIND,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(pathIdSchema, inboxRemindRequestSchema))
    .output(EffectSchema.flip(inboxReadStateSchema)),
  /** `remindItem` under the path a desktop built before the rename still calls; goes once the releases after it are out. */
  snoozeItem: readStateProcedure
    .meta(bodyCap(REMIND_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: INBOX_PROCEDURE_PATH.ITEM_SNOOZE,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(pathIdSchema, inboxRemindRequestSchema))
    .output(EffectSchema.flip(inboxReadStateSchema)),
  markAllRead: readAllProcedure
    .meta(bodyCap(READ_ALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.INBOX_READ }))
    .input(exactInput(inboxReadAllRequestSchema))
    .output(EffectSchema.flip(inboxReadAllSchema)),
};
