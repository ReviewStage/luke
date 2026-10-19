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
  planCommentActionRequestSchema,
  planCommentStartRequestSchema,
  planCommentsAnswerSchema,
  planCommentsCursorSchema,
  planCommentThreadAnswerSchema,
} from "../plan-comment-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { exactBodyInput, hostedProcedure } from "./base.js";

const COMMENTS_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}/comments` as const;

/** The plan a path names; the service reads an id that is no UUID as naming no plan, as it always has. */
const planIdField = { id: EffectSchema.String };

/** The plan and the thread a thread's path names, read as the plan's id is. */
const threadParamsSchema = EffectSchema.Struct({ ...planIdField, thread: EffectSchema.String });

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
        ...planIdField,
        after: EffectSchema.optionalKey(planCommentsCursorSchema),
      }),
    )
    .output(EffectSchema.flip(planCommentsAnswerSchema)),
  /** A thread started with its first comment. */
  start: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: COMMENTS_PATH,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(EffectSchema.Struct(planIdField), planCommentStartRequestSchema))
    .output(EffectSchema.flip(planCommentStartAnswerSchema)),
  /** One thing done to one thread of the plan. */
  act: hostedProcedure
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
