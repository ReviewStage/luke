/**
 * tasks.ts -- the account's plans and each one's own reads and writes: the list, a start, one plan opened, changed, or deleted, its edit, and its history.
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
import { MAXIMUM_START_BODY_BYTES } from "../agent-wire.js";
import { planEditAnswerSchema, planEditRequestSchema } from "../plan-edit.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  planRevisionAnswerSchema,
  planRevisionSeqSchema,
  planRevisionsAnswerSchema,
  TASK_BOUNDS,
  TASK_LIST_QUERY,
  taskAnswerSchema,
  taskCreateRequestSchema,
  taskDeleteAnswerSchema,
  taskListAnswerSchema,
  taskRestoreAnswerSchema,
  taskStartAnswerSchema,
  taskUpdateRequestSchema,
} from "../task-wire.js";
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

/** A change is a name and a repository's name at most, so a body past this is none. */
const NAME_BODY_BYTES = 8_192;

/** A brief at its bound with every character escaped. */
const BRIEF_BYTES = TASK_BOUNDS.MAX_BRIEF_CHARS * 6;

/** A start is a change's few fields, a brief where it names one, and an agent's Start beside them where it names one. */
const START_BODY_BYTES = NAME_BODY_BYTES + BRIEF_BYTES + MAXIMUM_START_BODY_BYTES;

/** An edit is the plan's text twice, its base and its value, each at its bound with every character escaped. */
const EDIT_BODY_BYTES = TASK_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 1_024;

const PLAN = `${HOSTED_SERVICE_PATH.TASKS}/{id}` as const;
const REVISIONS = `${PLAN}/revisions` as const;
const REVISION = `${REVISIONS}/{seq}` as const;

/** The plan a path names, as text: the handler reads it as a UUID, so one that is none answers as no plan rather than as a request that does not read. */
const taskParams = { id: EffectSchema.String };

/** A revision's number as a path or a query carries it, read as the whole number from one it must be. */
const revisionSeqText = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(planRevisionSeqSchema),
);

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
    .meta(bodyCap(START_BODY_BYTES))
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
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: PLAN, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskUpdateRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskDeleteAnswerSchema)),
  /** The developer's edit of the document. */
  edit: hostedProcedure
    .meta(bodyCap(EDIT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/edit`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), planEditRequestSchema))
    .output(EffectSchema.flip(planEditAnswerSchema)),
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
    .output(EffectSchema.flip(taskRestoreAnswerSchema)),
};
