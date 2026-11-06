import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { MAXIMUM_ATTACHMENTS_BODY_BYTES } from "../agent-wire.js";
import {
  DESCRIPTION_COMMENT_BOUNDS,
  descriptionCommentActionRequestSchema,
  descriptionCommentStartRequestSchema,
  descriptionCommentsAnswerSchema,
  descriptionCommentsCursorSchema,
  descriptionCommentThreadAnswerSchema,
} from "../description-comment-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { TASK_BOUNDS } from "../task-wire.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

const START_BODY_BYTES =
  (TASK_BOUNDS.MAX_BODY_CHARS +
    DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS +
    DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS) *
    6 +
  MAXIMUM_ATTACHMENTS_BODY_BYTES +
  1_024;

const ACTION_BODY_BYTES =
  DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS * 6 + MAXIMUM_ATTACHMENTS_BODY_BYTES + 1_024;

const COMMENTS_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}/comments` as const;

const taskIdField = { id: EffectSchema.String };

const threadParamsSchema = EffectSchema.Struct({ ...taskIdField, thread: EffectSchema.String });

const START_STATUSES = [201, 200] as const;

const descriptionCommentStartAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(START_STATUSES),
  body: descriptionCommentThreadAnswerSchema,
});

export const descriptionCommentsContract = {
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: COMMENTS_PATH }))
    .input(
      EffectSchema.Struct({
        ...taskIdField,
        page: EffectSchema.optionalKey(EffectSchema.String),
        after: EffectSchema.optionalKey(descriptionCommentsCursorSchema),
      }),
    )
    .output(EffectSchema.flip(descriptionCommentsAnswerSchema)),
  start: hostedProcedure
    .meta(bodyCap(START_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: COMMENTS_PATH,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(taskIdField), descriptionCommentStartRequestSchema))
    .output(EffectSchema.flip(descriptionCommentStartAnswerSchema)),
  act: hostedProcedure
    .meta(bodyCap(ACTION_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${COMMENTS_PATH}/{thread}`,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(threadParamsSchema, descriptionCommentActionRequestSchema))
    .output(EffectSchema.flip(descriptionCommentThreadAnswerSchema)),
};
