/**
 * plan-comments.ts -- a plan's comment threads (`plan-comment-wire.ts`): read them as they change, start one, and do one thing to one.
 *
 * The read is held by the service while nothing moved past the reader's
 * cursor (`packages/service/src/http/held-read.ts`), a long-held JSON answer
 * rather than an event stream, so the wire is the one released desktops
 * read. A start answers 201 where it posted a thread and 200 where it
 * answers in band (a key another thread holds, say), so its output is
 * detailed: the status beside the body. The ids travel in the path, and the
 * body of each write is exactly its wire request, read apart from them.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  PLAN_COMMENT_BOUNDS,
  planCommentActionRequestSchema,
  planCommentStartRequestSchema,
  planCommentsAnswerSchema,
  planCommentsCursorSchema,
  planCommentThreadAnswerSchema,
} from "../plan-comment-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { TASK_BOUNDS } from "../task-wire.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

/** A start carries the plan's text its anchor is measured in, every character escaped, beside a comment and a quote at their bounds. */
const START_BODY_BYTES =
  (TASK_BOUNDS.MAX_BODY_CHARS +
    PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS +
    PLAN_COMMENT_BOUNDS.MAX_QUOTE_CHARS) *
    6 +
  1_024;

/** An action is a comment at its bound and an id or a key, every character escaped. */
const ACTION_BODY_BYTES = PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS * 6 + 1_024;

const COMMENTS_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}/comments` as const;

/** The task a path names; the service reads an id that is no UUID as naming no task, as it always has. */
const taskIdField = { id: EffectSchema.String };

/** The plan and the thread a thread's path names, read as the plan's id is. */
const threadParamsSchema = EffectSchema.Struct({ ...taskIdField, thread: EffectSchema.String });

/** The statuses a start answers with: a thread posted (201), or an answer in band (200). */
const START_STATUSES = [201, 200] as const;

/** What a start answers: its status beside the thread answer the wire carries. */
const planCommentStartAnswerSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(START_STATUSES),
  body: planCommentThreadAnswerSchema,
});

export const planCommentsContract = {
  /** The plan's threads past the cursor `after` names, held while nothing moved; the start where it names none. */
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: COMMENTS_PATH }))
    .input(
      EffectSchema.Struct({
        ...taskIdField,
        after: EffectSchema.optionalKey(planCommentsCursorSchema),
      }),
    )
    .output(EffectSchema.flip(planCommentsAnswerSchema)),
  /** A thread started with its first comment. */
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
    .input(exactBodyInput(EffectSchema.Struct(taskIdField), planCommentStartRequestSchema))
    .output(EffectSchema.flip(planCommentStartAnswerSchema)),
  /** One thing done to one thread of the plan. */
  act: hostedProcedure
    .meta(bodyCap(ACTION_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${COMMENTS_PATH}/{thread}`,
        inputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(threadParamsSchema, planCommentActionRequestSchema))
    .output(EffectSchema.flip(planCommentThreadAnswerSchema)),
};
