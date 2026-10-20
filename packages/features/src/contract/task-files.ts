/**
 * task-files.ts -- what a plan's tabs read beside its text: the code Luke showed, its repository's files, folders and skills, the pages agents wrote, and a picture kept on it.
 *
 * Every procedure names its plan by the path's `{id}`. A File tab's window
 * and a tree's folder are queries, as the desktops already released send
 * them: the file's path is the `path` query and never a path segment, its
 * lines `first` and `last`, `raw=1` for its whole text, and `ref` for the
 * commit it is read at; a folder is `path` and `recursive=1`. The service
 * reads each into the wire's own request (`task-wire.ts`) and refuses one
 * that does not read as the invalid request it always did.
 *
 * Each output is its wire schema flipped (`packages/service/src/orpc/base.ts`).
 * A picture kept answers 201 with its id and one refused in band answers 200
 * with why, so that procedure answers its status beside its body.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { planPageVersionAnswerSchema, taskPagesAnswerSchema } from "../page-wire.js";
import { PICTURE_BOUNDS } from "../picture-wire.js";
import {
  PLAN_ATTACHMENT_STATUS,
  planAttachmentAnswerSchema,
  planAttachmentRequestSchema,
} from "../plan-attachment-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import {
  taskFileAnswerSchema,
  taskSkillsAnswerSchema,
  taskTreeAnswerSchema,
} from "../task-wire.js";
import { taskCodeAnswerSchema } from "../tasks-view.js";
import { bodyCap, exactBodyInput, hostedProcedure } from "./base.js";

/** An upload is one picture as a `data:` URL at its byte bound, base64 being four characters for every three bytes, with room for its type and key. */
const PICTURE_BODY_BYTES = Math.ceil(PICTURE_BOUNDS.MAX_BYTES / 3) * 4 + 1_024;

/** The value a query flag is set to, as a File tab's `raw` and a tree's `recursive` are; any other is refused. */
export const TASK_FILE_QUERY_FLAG = "1";

const QUERY_FLAG = EffectSchema.Literal(TASK_FILE_QUERY_FLAG);

/** The plan the path names. */
const taskInputSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** A window of one file of the plan's repository, as the File tab queries it. */
const taskFileQuerySchema = EffectSchema.Struct({
  ...taskInputSchema.fields,
  path: EffectSchema.optionalKey(EffectSchema.String),
  first: EffectSchema.optionalKey(EffectSchema.String),
  last: EffectSchema.optionalKey(EffectSchema.String),
  raw: EffectSchema.optionalKey(QUERY_FLAG),
  ref: EffectSchema.optionalKey(EffectSchema.String),
});

/** One folder of the plan's repository, as the File tab's tree queries it: the root where `path` is absent. */
const taskTreeQuerySchema = EffectSchema.Struct({
  ...taskInputSchema.fields,
  path: EffectSchema.optionalKey(EffectSchema.String),
  recursive: EffectSchema.optionalKey(QUERY_FLAG),
});

/** What keeping a picture answers: its status beside the wire's answer. */
const pictureKeptSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(PLAN_ATTACHMENT_STATUS)),
  body: planAttachmentAnswerSchema,
});

const TASK_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}` as const;

export const taskFilesContract = {
  code: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/code` }))
    .input(taskInputSchema)
    .output(EffectSchema.flip(taskCodeAnswerSchema)),
  file: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/file` }))
    .input(taskFileQuerySchema)
    .output(EffectSchema.flip(taskFileAnswerSchema)),
  tree: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/tree` }))
    .input(taskTreeQuerySchema)
    .output(EffectSchema.flip(taskTreeAnswerSchema)),
  skills: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/skills` }))
    .input(taskInputSchema)
    .output(EffectSchema.flip(taskSkillsAnswerSchema)),
  keepPicture: hostedProcedure
    .meta(bodyCap(PICTURE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${TASK_PATH}/attachments`,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(taskInputSchema, planAttachmentRequestSchema))
    .output(EffectSchema.flip(pictureKeptSchema)),
  pages: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/pages` }))
    .input(taskInputSchema)
    .output(EffectSchema.flip(taskPagesAnswerSchema)),
  page: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${TASK_PATH}/pages/{page}/versions/{version}`,
      }),
    )
    .input(
      EffectSchema.Struct({
        ...taskInputSchema.fields,
        page: EffectSchema.String,
        version: EffectSchema.String,
      }),
    )
    .output(EffectSchema.flip(planPageVersionAnswerSchema)),
};
