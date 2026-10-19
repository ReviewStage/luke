/**
 * plans.ts -- the account's plans and each one's own reads and writes: the list, a start, one plan opened, changed, or deleted, its board, its edit, its history, its transcript and work, and Luke's Stop.
 *
 * Every path names the plan by its id (`{id}`), which the handler reads as
 * the old routes read it: an id that is no UUID names no plan, and answers
 * as none. Each output is its wire schema flipped, so oRPC's output check
 * encodes the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`); a JSON body is read strictly, its
 * params apart from it (`exactBodyInput`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { boardAnswerSchema, boardSaveRequestSchema } from "../board-wire.js";
import { planEditAnswerSchema, planEditRequestSchema } from "../plan-edit.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { wireUuidSchema } from "../service-wire.js";
import {
  planRevisionAnswerSchema,
  planRevisionSeqSchema,
  planRevisionsAnswerSchema,
  TASK_LIST_QUERY,
  taskAnswerSchema,
  taskCreateRequestSchema,
  taskDeleteAnswerSchema,
  taskListAnswerSchema,
  taskStartAnswerSchema,
  taskUpdateRequestSchema,
} from "../task-wire.js";
import { taskWorkAnswerSchema } from "../tasks-view.js";
import { taskTranscriptAnswerSchema } from "../transcript-wire.js";
import { exactBodyInput, exactInput, hostedProcedure } from "./base.js";

const PLAN = `${HOSTED_SERVICE_PATH.TASKS}/{id}` as const;
const REVISIONS = `${PLAN}/revisions` as const;
const REVISION = `${REVISIONS}/{seq}` as const;

/** The plan a path names, as text: the handler reads it as a UUID, so one that is none answers as no plan rather than as a request that does not read. */
const taskParams = { id: EffectSchema.String };

/** A revision's number as a path or a query carries it, read as the whole number from one it must be. */
const revisionSeqText = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(planRevisionSeqSchema),
);

/** What Luke's Stop answers: nothing beyond that it was asked. */
const stopAnswerSchema = EffectSchema.Struct({});

/** The statuses a start answers: created, or a retry answered with what its first request made. */
export const TASK_START_STATUS = {
  RETRIED: 200,
  CREATED: 201,
} as const;

/** A start's answer with its status, since a retry under its agent's key answers 200 where a new plan answers 201. */
const startedSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(TASK_START_STATUS)),
  body: taskStartAnswerSchema,
});

export const tasksContract = {
  /** The plans, and beside them the agents with no plan; the archived ones too where `archived=include` asks. */
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.TASKS }))
    .input(
      EffectSchema.Struct({
        [TASK_LIST_QUERY.ARCHIVED]: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(taskListAnswerSchema)),
  /** A plan started, and the agent it names started on it where it names one. */
  create: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.TASKS,
        successStatus: TASK_START_STATUS.CREATED,
        outputStructure: "detailed",
      }),
    )
    .input(exactInput(taskCreateRequestSchema))
    .output(EffectSchema.flip(startedSchema)),
  open: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskAnswerSchema)),
  /** Its name, repository, pin, archive, or workspace changed. */
  update: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: PLAN, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskUpdateRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskDeleteAnswerSchema)),
  readBoard: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${PLAN}/board` }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(boardAnswerSchema)),
  /** The board's scene written whole. */
  saveBoard: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: `${PLAN}/board`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), boardSaveRequestSchema))
    .output(EffectSchema.flip(boardAnswerSchema)),
  /** The developer's edit of the document. */
  edit: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/edit`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), planEditRequestSchema))
    .output(EffectSchema.flip(planEditAnswerSchema)),
  transcript: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${PLAN}/transcript` }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskTranscriptAnswerSchema)),
  /** A page of the plan's work, before the turn `before` names where it names one. */
  work: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${PLAN}/work` }))
    .input(EffectSchema.Struct({ ...taskParams, before: EffectSchema.optionalKey(wireUuidSchema) }))
    .output(EffectSchema.flip(taskWorkAnswerSchema)),
  /** A page of the plan's history, before the revision `before` names where it names one. */
  revisions: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: REVISIONS }))
    .input(
      EffectSchema.Struct({ ...taskParams, before: EffectSchema.optionalKey(revisionSeqText) }),
    )
    .output(EffectSchema.flip(planRevisionsAnswerSchema)),
  revision: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: REVISION }))
    .input(EffectSchema.Struct({ ...taskParams, seq: revisionSeqText }))
    .output(EffectSchema.flip(planRevisionAnswerSchema)),
  /** One revision put back as the plan's content. */
  restore: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${REVISION}/restore` }))
    .input(EffectSchema.Struct({ ...taskParams, seq: revisionSeqText }))
    .output(EffectSchema.flip(taskAnswerSchema)),
  /** Luke's turn on the plan stopped. */
  stop: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/stop` }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(stopAnswerSchema)),
};
