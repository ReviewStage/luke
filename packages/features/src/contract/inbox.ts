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
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

const NOD_BODY_BYTES = 1_024;

const CLOSE_BODY_BYTES =
  6 * INBOX_BOUNDS.MAX_MESSAGE_CHARS + MAXIMUM_ATTACHMENTS_BODY_BYTES + 2_048;

const MESSAGE_BODY_BYTES =
  6 *
    (INBOX_BOUNDS.MAX_MESSAGE_CHARS +
      INBOX_BOUNDS.MAX_FIELDS *
        (INBOX_BOUNDS.MAX_LABEL_CHARS + INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS) +
      INBOX_BOUNDS.MAX_OPTIONS * INBOX_BOUNDS.MAX_LABEL_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

const START_BODY_BYTES =
  6 * (INBOX_BOUNDS.MAX_TITLE_CHARS + INBOX_BOUNDS.MAX_MESSAGE_CHARS) +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  2_048;

const READ_ALL_BODY_BYTES = 1_024;

const REMIND_BODY_BYTES = 1_024;

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

const pathIdSchema = EffectSchema.Struct({ id: EffectSchema.String });

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
  home: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: INBOX_PROCEDURE_PATH.ITEM }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxItemHomeSchema)),
  answer: hostedProcedure
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
  start: hostedProcedure
    .meta(bodyCap(START_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.INBOX }))
    .input(exactInput(inboxStartRequestSchema))
    .output(EffectSchema.flip(inboxMessagedSchema)),
  markItemRead: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: INBOX_PROCEDURE_PATH.ITEM_READ }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxReadStateSchema)),
  markItemUnread: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: INBOX_PROCEDURE_PATH.ITEM_READ }))
    .input(pathIdSchema)
    .output(EffectSchema.flip(inboxReadStateSchema)),
  remindItem: hostedProcedure
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
  snoozeItem: hostedProcedure
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
  markAllRead: hostedProcedure
    .meta(bodyCap(READ_ALL_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.INBOX_READ }))
    .input(exactInput(inboxReadAllRequestSchema))
    .output(EffectSchema.flip(inboxReadAllSchema)),
};
