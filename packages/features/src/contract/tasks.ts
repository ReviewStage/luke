/**
 * tasks.ts -- the account's plans and each one's own reads and writes: the list, a start, one plan found by its number, opened, changed, or deleted, its blocks, its parent, a relation moved, its edit, and its history.
 *
 * Every path names the plan by its id (`{id}`), which the handler reads as
 * the old routes read it: an id that is no UUID names no plan, and answers
 * as none. Each output is its wire schema flipped, so oRPC's output check
 * encodes the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`); a JSON body is read strictly, its
 * params apart from it (`exactBodyInput`).
 *
 * Each procedure declares the refusals its handler answers
 * (`packages/service/src/tasks/tasks-procedures.ts`) beyond those any
 * procedure may (`declaredProcedure`): a plan, a workspace, a related task,
 * or a revision out of reach as not found, a repository the workspace does
 * not reach as not reachable or GitHub unanswered, the tree's own rules by
 * name, a write sent again under its key as already written, and a delete's
 * Stop of the plan's agents as an agent's Stop refuses (`STOP_REFUSALS`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { MAXIMUM_START_BODY_BYTES } from "../agent-wire.js";
import { descriptionEditAnswerSchema, descriptionEditRequestSchema } from "../description-edit.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  descriptionRevisionAnswerSchema,
  descriptionRevisionSeqSchema,
  descriptionRevisionsAnswerSchema,
  heldTaskListAnswerSchema,
  TASK_BOUNDS,
  TASK_LIST_QUERY,
  taskAnswerSchema,
  taskBlockRequestSchema,
  taskCreateRequestSchema,
  taskDeleteAnswerSchema,
  taskFoundAnswerSchema,
  taskNumberSchema,
  taskParentRequestSchema,
  taskRelationChangeRequestSchema,
  taskRestoreAnswerSchema,
  taskStartAnswerSchema,
  taskUpdateRequestSchema,
} from "../task-wire.js";
import { STOP_REFUSALS } from "./agents.js";
import { bodyCap, declaredProcedure, exactBodyInput, exactInput, refuses } from "./base.js";

/** A change is a name and a repository's name at most, so a body past this is none. */
const NAME_BODY_BYTES = 8_192;

/** A brief at its bound with every character escaped. */
const BRIEF_BYTES = TASK_BOUNDS.MAX_BRIEF_CHARS * 6;

/** A start is a change's few fields, a brief where it names one, and an agent's Start beside them where it names one. */
const START_BODY_BYTES = NAME_BODY_BYTES + BRIEF_BYTES + MAXIMUM_START_BODY_BYTES;

/** An edit is the plan's text twice, its base and its value, each at its bound with every character escaped. */
const EDIT_BODY_BYTES = TASK_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 1_024;

const PLAN = `${HOSTED_SERVICE_PATH.TASKS}/{id}` as const;
const DESCRIPTION = `${PLAN}/description` as const;
const REVISIONS = `${DESCRIPTION}/revisions` as const;
const REVISION = `${REVISIONS}/{seq}` as const;

/**
 * The paths the task's description was edited and read back at before it
 * was named the description, under the task's own path rather than its
 * description's, which a released desktop or the published CLI still asks:
 * each is answered as needing an update (`HOSTED_API_ERROR.HOST_UPGRADE_NEEDED`)
 * rather than as a path the service never served.
 */
export const RETIRED_TASK_PATHS: readonly RegExp[] = [
  /^\/api\/plans\/[^/]+\/edit\/?$/u,
  /^\/api\/plans\/[^/]+\/revisions(?:\/[^/]+(?:\/restore)?)?\/?$/u,
];

/** The plan a path names, as text: the handler reads it as a UUID, so one that is none answers as no plan rather than as a request that does not read. */
const taskParams = { id: EffectSchema.String };

/** A revision's number as a path or a query carries it, read as the whole number from one it must be. */
const revisionSeqText = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(descriptionRevisionSeqSchema),
);

/** The most a task's number may be, Postgres's integer, so a number past it names no task rather than failing its read. */
const MAX_TASK_NUMBER = 2_147_483_647;

/** A task's number as a path carries it, read as the whole number from one it must be. */
const taskNumberText = EffectSchema.NumberFromString.pipe(
  EffectSchema.decodeTo(taskNumberSchema.check(EffectSchema.isLessThanOrEqualTo(MAX_TASK_NUMBER))),
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
  list: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.TASKS }))
    .input(
      EffectSchema.Struct({
        [TASK_LIST_QUERY.ARCHIVED]: EffectSchema.optionalKey(EffectSchema.String),
      }),
    )
    .output(EffectSchema.flip(heldTaskListAnswerSchema)),
  /** A plan started, and the agent it names started on it where it names one. */
  create: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.ALREADY_WRITTEN,
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
        HOSTED_API_ERROR.GITHUB_UNANSWERED,
        HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED,
        HOSTED_API_ERROR.TASK_PARENT_CYCLE,
        HOSTED_API_ERROR.TASK_PARENT_HELD,
        HOSTED_API_ERROR.TASK_BLOCK_CYCLE,
      ),
    )
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
  /**
   * The task a link names by its workspace, by the slug or the id the link
   * spells it by, and its number there (`/<slug>/task/<number>`), as its id;
   * one the caller does not reach answers as none.
   */
  find: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${HOSTED_SERVICE_PATH.WORKSPACES}/{workspace}/tasks/{number}`,
      }),
    )
    .input(EffectSchema.Struct({ workspace: EffectSchema.String, number: taskNumberText }))
    .output(EffectSchema.flip(taskFoundAnswerSchema)),
  open: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskAnswerSchema)),
  /** Its name, repository, pin, archive, or workspace changed. */
  update: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.ALREADY_WRITTEN,
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
        HOSTED_API_ERROR.GITHUB_UNANSWERED,
        HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED,
        HOSTED_API_ERROR.AGENT_NOT_READY,
      ),
    )
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: PLAN, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskUpdateRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  /** One block of it added or taken away, answered with it as it then stands. */
  block: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.TASK_BLOCK_CYCLE))
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/blocks`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskBlockRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  /** Its parent set, or cleared with null, answered with it as it then stands. */
  parent: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED,
        HOSTED_API_ERROR.TASK_PARENT_CYCLE,
      ),
    )
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/parent`, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskParentRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  /** One relation of it moved to another kind, in one transaction, answered with it as it then stands. */
  relation: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED,
        HOSTED_API_ERROR.TASK_PARENT_CYCLE,
        HOSTED_API_ERROR.TASK_BLOCK_CYCLE,
      ),
    )
    .meta(bodyCap(NAME_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: `${PLAN}/relation`, inputStructure: "detailed" }),
    )
    .input(exactBodyInput(EffectSchema.Struct(taskParams), taskRelationChangeRequestSchema))
    .output(EffectSchema.flip(taskAnswerSchema)),
  delete: declaredProcedure
    .errors(refuses(...STOP_REFUSALS))
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: PLAN }))
    .input(EffectSchema.Struct(taskParams))
    .output(EffectSchema.flip(taskDeleteAnswerSchema)),
  /** The developer's edit of the description. */
  editDescription: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(EDIT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: DESCRIPTION, inputStructure: "detailed" }))
    .input(exactBodyInput(EffectSchema.Struct(taskParams), descriptionEditRequestSchema))
    .output(EffectSchema.flip(descriptionEditAnswerSchema)),
  /** A page of the description's history, before the revision `before` names where it names one. */
  descriptionRevisions: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: REVISIONS }))
    .input(
      EffectSchema.Struct({ ...taskParams, before: EffectSchema.optionalKey(revisionSeqText) }),
    )
    .output(EffectSchema.flip(descriptionRevisionsAnswerSchema)),
  descriptionRevision: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: REVISION }))
    .input(EffectSchema.Struct({ ...taskParams, seq: revisionSeqText }))
    .output(EffectSchema.flip(descriptionRevisionAnswerSchema)),
  /** One revision put back as the description's content. */
  restoreDescription: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.POST, path: `${REVISION}/restore` }))
    .input(EffectSchema.Struct({ ...taskParams, seq: revisionSeqText }))
    .output(EffectSchema.flip(taskRestoreAnswerSchema)),
};
