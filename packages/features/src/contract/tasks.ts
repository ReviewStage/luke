import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { MAXIMUM_START_BODY_BYTES } from "../agent-wire.js";
import { descriptionEditAnswerSchema, descriptionEditRequestSchema } from "../description-edit.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  descriptionRevisionAnswerSchema,
  descriptionRevisionSeqSchema,
  descriptionRevisionsAnswerSchema,
  TASK_BOUNDS,
  TASK_LIST_QUERY,
  taskAnswerSchema,
  taskBlockRequestSchema,
  taskCreateRequestSchema,
  taskDeleteAnswerSchema,
  taskFoundAnswerSchema,
  taskListAnswerSchema,
  taskNumberSchema,
  taskParentRequestSchema,
  taskRelationChangeRequestSchema,
  taskRestoreAnswerSchema,
  taskStartAnswerSchema,
  taskUpdateRequestSchema,
} from "../task-wire.js";
import { bodyCap, exactBodyInput, exactInput, hostedProcedure } from "./base.js";

const NAME_BODY_BYTES = 8_192;

const BRIEF_BYTES = TASK_BOUNDS.MAX_BRIEF_CHARS * 6;

const START_BODY_BYTES = NAME_BODY_BYTES + BRIEF_BYTES + MAXIMUM_START_BODY_BYTES;

const EDIT_BODY_BYTES = TASK_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 1_024;

const PLAN = `${HOSTED_SERVICE_PATH.TASKS}/{id}` as const;
const DESCRIPTION = `${PLAN}/description` as const;
const REVISIONS = `${DESCRIPTION}/revisions` as const;
const REVISION = `${REVISIONS}/{seq}` as const;

export const RETIRED_TASK_PATHS: readonly RegExp[] = [
  /^\/api\/plans\/[^/]+\/edit\/?$/u,
  /^\/api\/plans\/[^/]+\/revisions(?:\/[^/]+(?:\/restore)?)?\/?$/u,
];

const taskParams = { id: EffectSchema.String };

const revisionSeqText = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(descriptionRevisionSeqSchema),
);

const MAX_TASK_NUMBER = 2_147_483_647;

const taskNumberText = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(taskNumberSchema.check(EffectSchema.isLessThanOrEqualTo(MAX_TASK_NUMBER))),
);

export const TASK_START_STATUS = {
  RETRIED: 200,
  CREATED: 201,
} as const;

const startedSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(TASK_START_STATUS)),
  body: taskStartAnswerSchema,
});

export const tasksContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.TASKS }))
    .input(
      EffectSchema.Struct({
        [TASK_LIST_QUERY.ARCHIVED]: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(taskListAnswerSchema)),
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
  find: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.WORKSPACES}/{workspace}/tasks/{number}`,
      }),
    )
    .input(EffectSchema.Struct({ workspace: EffectSchema.String, number: taskNumberText }))
    .output(EffectSchema.flip(taskFoundAnswerSchema)),
  open: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskAnswerSchema)),
  update: hostedProcedure
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: PLAN, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskUpdateRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  block: hostedProcedure
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/blocks`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskBlockRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  parent: hostedProcedure
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/parent`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskParentRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  relation: hostedProcedure
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/relation`, inputStructure: "detailed" }),
    )
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskRelationChangeRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskDeleteAnswerSchema)),
  editDescription: hostedProcedure
    .meta(bodyCap(EDIT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: DESCRIPTION, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), descriptionEditRequestSchema))
    .output(EffectSchema.flip(descriptionEditAnswerSchema)),
  descriptionRevisions: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: REVISIONS }))
    .input(
      EffectSchema.Struct({ ...taskParams, before: EffectSchema.optionalKey(revisionSeqText) }),
    )
    .output(EffectSchema.flip(descriptionRevisionsAnswerSchema)),
  descriptionRevision: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: REVISION }))
    .input(EffectSchema.Struct({ ...taskParams, seq: revisionSeqText }))
    .output(EffectSchema.flip(descriptionRevisionAnswerSchema)),
  restoreDescription: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${REVISION}/restore` }))
    .input(EffectSchema.Struct({ ...taskParams, seq: revisionSeqText }))
    .output(EffectSchema.flip(taskRestoreAnswerSchema)),
};
