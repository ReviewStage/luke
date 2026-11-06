/**
 * task-files.ts -- what a plan's tabs read beside its text: its repository's files, folders and skills, the pages agents wrote, and a picture kept on it.
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
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/tasks/task-files-procedures.ts`) beyond those any
 * procedure may (`declaredProcedure`): a plan, a page, or a version out of
 * the account's reach, or an id that is no UUID, as not found.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  DESCRIPTION_ATTACHMENT_STATUS,
  descriptionAttachmentAnswerSchema,
  descriptionAttachmentRequestSchema,
} from "../description-attachment-wire.js";
import { pageFrameAnswerSchema } from "../page-frame.js";
import { taskPagesAnswerSchema, taskPageVersionAnswerSchema } from "../page-wire.js";
import { PICTURE_BOUNDS } from "../picture-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  taskFileAnswerSchema,
  taskSkillsAnswerSchema,
  taskSkillsQueryFields,
  taskTreeAnswerSchema,
} from "../task-wire.js";
import { bodyCap, declaredProcedure, exactBodyInput, refuses } from "./base.js";

/** An upload is one picture or video as a `data:` URL at the larger of their byte bounds, base64 being four characters for every three bytes, with room for its type and key. */
const PICTURE_BODY_BYTES =
  Math.ceil(Math.max(PICTURE_BOUNDS.MAX_BYTES, PICTURE_BOUNDS.MAX_SENT_VIDEO_BYTES) / 3) * 4 +
  1_024;

/** The value a query flag is set to, as a File tab's `raw` and a tree's `recursive` are; any other is refused. */
export const TASK_FILE_QUERY_FLAG = "1";

const QUERY_FLAG = EffectSchema.Literal(TASK_FILE_QUERY_FLAG);

/** The plan the path names. */
const taskInputSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** A window of one file, as the File tab queries it: the service reads it into the wire's own request. */
export const taskFileQueryFields = {
  path: EffectSchema.optionalKey(EffectSchema.String),
  first: EffectSchema.optionalKey(EffectSchema.String),
  last: EffectSchema.optionalKey(EffectSchema.String),
  raw: EffectSchema.optionalKey(QUERY_FLAG),
  ref: EffectSchema.optionalKey(EffectSchema.String),
};

/** A window of one file of the plan's repository, as the File tab queries it. */
const taskFileQuerySchema = EffectSchema.Struct({
  ...taskInputSchema.fields,
  ...taskFileQueryFields,
});

/** One folder of the plan's repository, as the File tab's tree queries it: the root where `path` is absent. */
const taskTreeQuerySchema = EffectSchema.Struct({
  ...taskInputSchema.fields,
  path: EffectSchema.optionalKey(EffectSchema.String),
  recursive: EffectSchema.optionalKey(QUERY_FLAG),
});

/** One version of one page of the plan, as the path names it. */
const taskPageVersionSchema = EffectSchema.Struct({
  ...taskInputSchema.fields,
  page: EffectSchema.String,
  version: EffectSchema.String,
});

/** What keeping a picture answers: its status beside the wire's answer. */
const pictureKeptSchema = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(DESCRIPTION_ATTACHMENT_STATUS)),
  body: descriptionAttachmentAnswerSchema,
});

const TASK_PATH = `${HOSTED_SERVICE_PATH.TASKS}/{id}` as const;

/** What a read of the plan, or of one of its rows, refuses beyond any procedure: the plan or the row out of the account's reach. */
const NOT_FOUND = refuses(HOSTED_API_ERROR.NOT_FOUND);

export const taskFilesContract = {
  file: declaredProcedure
    .errors(NOT_FOUND)
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/file` }))
    .input(taskFileQuerySchema)
    .output(EffectSchema.flip(taskFileAnswerSchema)),
  tree: declaredProcedure
    .errors(NOT_FOUND)
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/tree` }))
    .input(taskTreeQuerySchema)
    .output(EffectSchema.flip(taskTreeAnswerSchema)),
  skills: declaredProcedure
    .errors(NOT_FOUND)
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/skills` }))
    .input(EffectSchema.Struct({ ...taskInputSchema.fields, ...taskSkillsQueryFields }))
    .output(EffectSchema.flip(taskSkillsAnswerSchema)),
  keepPicture: declaredProcedure
    .errors(NOT_FOUND)
    .meta(bodyCap(PICTURE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${TASK_PATH}/attachments`,
        inputStructure: "detailed",
        outputStructure: "detailed",
      }),
    )
    .input(exactBodyInput(taskInputSchema, descriptionAttachmentRequestSchema))
    .output(EffectSchema.flip(pictureKeptSchema)),
  pages: declaredProcedure
    .errors(NOT_FOUND)
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${TASK_PATH}/pages` }))
    .input(taskInputSchema)
    .output(EffectSchema.flip(taskPagesAnswerSchema)),
  page: declaredProcedure
    .errors(NOT_FOUND)
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${TASK_PATH}/pages/{page}/versions/{version}`,
      }),
    )
    .input(taskPageVersionSchema)
    .output(EffectSchema.flip(taskPageVersionAnswerSchema)),
  /** One version of one page as a browser's frame loads it: sent on to its short-lived link on the sandbox's own site, or to the page saying pages open in the Mac app where the deployment has no sandbox. */
  pageFrame: declaredProcedure
    .errors(NOT_FOUND)
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${TASK_PATH}/pages/{page}/versions/{version}/frame`,
        outputStructure: "detailed",
      }),
    )
    .input(taskPageVersionSchema)
    .output(EffectSchema.flip(pageFrameAnswerSchema)),
};
