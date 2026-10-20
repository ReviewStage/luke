/**
 * task-files-procedures.ts -- what a plan's tabs read beside its text, and a picture kept on it, as the hosted oRPC router answers them.
 *
 * `GET /api/plans/{id}/code` is every code Luke showed on the task, read
 * back from its conversation (`tasks/task-work-store.ts`).
 * `/api/plans/{id}/file` is a window of one file of the task's repository
 * for the File tab, read from GitHub as it stands now, or at the commit an
 * inbox item's code reference pins, through the App, under the rule
 * `show_code` is held to (`tasks/task-file.ts`); `/api/plans/{id}/tree` one
 * folder of it for the tree beside that tab, listed where and as the file is
 * read (`tasks/task-tree.ts`); and `/api/plans/{id}/skills` the skills a
 * developer may choose of that repository, read where and as the file is
 * (`tasks/task-skills.ts`). `/api/plans/{id}/pages` is the pages agents
 * wrote for the task, each by its newest version, and
 * `/api/plans/{id}/pages/{page}/versions/{version}` one version's HTML,
 * answered inside JSON so no page is ever a document of this origin
 * (`@luke/database/models/plan-pages`). `POST /api/plans/{id}/attachments`
 * keeps one picture on the plan, pasted, dropped, or chosen into its text by
 * any member of its workspace, and answers the id the text then names it by
 * (201), or refuses in band where the plan holds its bound of pictures
 * (200). Its bytes are served by `tasks-app.ts`, which answers bytes rather
 * than JSON.
 *
 * Every read resolves the caller before it touches a row, and every row it
 * touches is one the caller's account reaches: a task id another account
 * holds answers exactly as one that names nothing, not found, so nothing is
 * learned about tasks the caller does not reach. An id that is not a UUID
 * names no row, and answers as none. A plan the account does not reach, or
 * an archived one, which no editor is drawn on, keeps no picture and
 * answers as not found.
 */

import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import { pageVersionNumberSchema } from "@luke/features/page-wire";
import { pictureOfDataUrl } from "@luke/features/picture-wire";
import {
  PLAN_ATTACHMENT_REFUSAL,
  PLAN_ATTACHMENT_STATUS,
} from "@luke/features/plan-attachment-wire";
import {
  type TaskFileRequest,
  type TaskTreeRequest,
  taskFileRequestSchema,
  taskTreeRequestSchema,
} from "@luke/features/task-wire";
import { unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Result } from "effect";
import { wireUuidSchema } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { readTaskFile } from "./task-file.js";
import { readTaskSkills } from "./task-skills.js";
import { readTaskTree } from "./task-tree.js";
import { readTaskCode } from "./task-work-store.js";

export interface TaskFilesProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The row an id names, where it is a UUID; one that is not names no row, and answers as none. */
const namedRow = /* @__PURE__ */ Effect.fnUntraced(function* (
  id: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** The answer a read found, or not found where it found none. */
const found = <A>(read: Option.Option<A>): Effect.Effect<A, HostedRefusal> =>
  Option.match(read, {
    onNone: () => Effect.fail(HOSTED_REFUSAL.NOT_FOUND),
    onSome: Effect.succeed,
  });

/** The window a File tab's query names, or the invalid-request refusal where it does not read as one. */
function fileWindowOf(query: {
  readonly path?: string;
  readonly first?: string;
  readonly last?: string;
  readonly raw?: string;
  readonly ref?: string;
}): Effect.Effect<TaskFileRequest, HostedRefusal> {
  const read = readEither(taskFileRequestSchema)(
    unparsedWire({
      path: query.path,
      firstLine: Number(query.first),
      lastLine: Number(query.last),
      ...(query.raw === undefined ? undefined : { raw: true }),
      ...(query.ref === undefined ? undefined : { ref: query.ref }),
    }),
  );
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

/** The folder a tree's query names, the root where it names none, or the invalid-request refusal. */
function folderOf(query: {
  readonly path?: string;
  readonly recursive?: string;
}): Effect.Effect<TaskTreeRequest, HostedRefusal> {
  const read = readEither(taskTreeRequestSchema)(
    unparsedWire({
      path: query.path ?? "",
      ...(query.recursive === undefined ? undefined : { recursive: true }),
    }),
  );
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

/** The version number the path names; one that is not a whole number from one is refused as a request that does not read. */
function pageVersionOf(version: string): Effect.Effect<number, HostedRefusal> {
  const read = readEither(pageVersionNumberSchema)(unparsedWire(Number(version)));
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

/** The plan files resource: each read and the picture kept, to a signed-in caller resolved before its input is read. */
export function taskFilesProcedures(seams: TaskFilesProcedureSeams) {
  const taskFiles = hosted.taskFiles.use(accountMiddleware(seams.resolveUserId));
  return {
    code: taskFiles.code.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.id);
      return yield* found(yield* hostedStoreOrUnavailable(readTaskCode(context.userId, taskId)));
    }),
    file: taskFiles.file.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.id);
      const window = yield* fileWindowOf(input);
      return yield* found(
        yield* hostedStoreOrUnavailable(readTaskFile(context.userId, taskId, window)),
      );
    }),
    tree: taskFiles.tree.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.id);
      const folder = yield* folderOf(input);
      return yield* found(
        yield* hostedStoreOrUnavailable(readTaskTree(context.userId, taskId, folder)),
      );
    }),
    skills: taskFiles.skills.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.id);
      return yield* found(yield* hostedStoreOrUnavailable(readTaskSkills(context.userId, taskId)));
    }),
    keepPicture: taskFiles.keepPicture.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.params.id);
      const picture = pictureOfDataUrl(input.body.picture);
      if (picture === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const kept = yield* hostedStoreOrUnavailable(
        keepPlanAttachment(context.userId, taskId, picture),
      );
      switch (kept.status) {
        case PLAN_ATTACHMENT_KEEP.KEPT:
          return { status: PLAN_ATTACHMENT_STATUS.KEPT, body: { id: kept.id } };
        case PLAN_ATTACHMENT_KEEP.TOO_MANY:
          return {
            status: PLAN_ATTACHMENT_STATUS.REFUSED,
            body: { refused: PLAN_ATTACHMENT_REFUSAL.TOO_MANY },
          };
        case PLAN_ATTACHMENT_KEEP.NO_TASK:
          return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
    }),
    pages: taskFiles.pages.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.id);
      return { pages: yield* hostedStoreOrUnavailable(listPages(context.userId, taskId)) };
    }),
    page: taskFiles.page.effect(function* ({ input, context }) {
      const taskId = yield* namedRow(input.id);
      const pageId = yield* namedRow(input.page);
      const version = yield* pageVersionOf(input.version);
      const page = yield* hostedStoreOrUnavailable(
        readPageVersion(context.userId, taskId, pageId, version),
      );
      return { page: yield* found(page) };
    }),
  };
}
