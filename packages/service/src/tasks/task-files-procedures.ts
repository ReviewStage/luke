import {
  keepDescriptionAttachment,
  DESCRIPTION_ATTACHMENT_KEEP,
} from "@repo/database/models/description-attachments";
import { listPages, readPageVersion } from "@repo/database/models/task-pages";
import { readTaskWorkspace } from "@repo/database/models/task-store";
import { pageVersionNumberSchema, taskPageOwner } from "@repo/features/page-wire";
import { pictureOfDataUrl } from "@repo/features/picture-wire";
import {
  DESCRIPTION_ATTACHMENT_REFUSAL,
  DESCRIPTION_ATTACHMENT_STATUS,
} from "@repo/features/description-attachment-wire";
import {
  type TaskFileRequest,
  type TaskTreeRequest,
  taskFileRequestSchema,
  taskTreeRequestSchema,
} from "@repo/features/task-wire";
import { unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Result } from "effect";
import { recordServerEventIn, SERVER_AGENT_TOOL, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { pageFrameAnswer } from "../pages/page-frame.js";
import { readTaskFile } from "./task-file.js";
import { readTaskSkills } from "./task-skills.js";
import { readTaskTree } from "./task-tree.js";

export interface TaskFilesProcedureSeams {
  resolveUserId: UserIdResolver;
}

const found = <A>(read: Option.Option<A>): Effect.Effect<A, HostedRefusal> =>
  Option.match(read, {
    onNone: () => Effect.fail(HOSTED_REFUSAL.NOT_FOUND),
    onSome: Effect.succeed,
  });

export function fileWindowOf(query: {
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

function pageVersionOf(version: string): Effect.Effect<number, HostedRefusal> {
  const read = readEither(pageVersionNumberSchema)(unparsedWire(Number(version)));
  return Result.isFailure(read)
    ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)
    : Effect.succeed(read.success);
}

export function taskFilesProcedures(seams: TaskFilesProcedureSeams) {
  const taskFiles = hosted.taskFiles.use(accountMiddleware(seams.resolveUserId));
  return {
    file: taskFiles.file.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const window = yield* fileWindowOf(input);
      return yield* found(
        yield* hostedStoreOrUnavailable(readTaskFile(context.userId, taskId, window)),
      );
    }),
    tree: taskFiles.tree.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const folder = yield* folderOf(input);
      return yield* found(
        yield* hostedStoreOrUnavailable(readTaskTree(context.userId, taskId, folder)),
      );
    }),
    skills: taskFiles.skills.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      return yield* found(
        yield* hostedStoreOrUnavailable(
          readTaskSkills(context.userId, taskId, input.installed !== undefined),
        ),
      );
    }),
    keepPicture: taskFiles.keepPicture.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.params.id);
      const picture = pictureOfDataUrl(input.body.picture);
      if (picture === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      const kept = yield* hostedStoreOrUnavailable(
        keepDescriptionAttachment(context.userId, taskId, picture),
      );
      switch (kept.status) {
        case DESCRIPTION_ATTACHMENT_KEEP.KEPT:
          yield* recordServerEventIn(
            SERVER_EVENT.AGENT_TOOL_OPEN,
            context.userId,
            readTaskWorkspace(context.userId, taskId),
            { tool: SERVER_AGENT_TOOL.ADD_TO_DESCRIPTION },
          );
          return { status: DESCRIPTION_ATTACHMENT_STATUS.KEPT, body: { id: kept.id } };
        case DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY:
          return {
            status: DESCRIPTION_ATTACHMENT_STATUS.REFUSED,
            body: { refused: DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY },
          };
        case DESCRIPTION_ATTACHMENT_KEEP.TOO_MANY_VIDEOS:
          return {
            status: DESCRIPTION_ATTACHMENT_STATUS.REFUSED,
            body: { refused: DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY_VIDEOS },
          };
        case DESCRIPTION_ATTACHMENT_KEEP.NO_TASK:
          return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
    }),
    pages: taskFiles.pages.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      return {
        pages: yield* hostedStoreOrUnavailable(listPages(context.userId, taskPageOwner(taskId))),
      };
    }),
    page: taskFiles.page.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const pageId = yield* pathUuid(input.page);
      const version = yield* pageVersionOf(input.version);
      const page = yield* hostedStoreOrUnavailable(
        readPageVersion(context.userId, taskPageOwner(taskId), pageId, version),
      );
      return { page: yield* found(page) };
    }),
    pageFrame: taskFiles.pageFrame.effect(function* ({ input, context }) {
      const taskId = yield* pathUuid(input.id);
      const pageId = yield* pathUuid(input.page);
      const version = yield* pageVersionOf(input.version);
      const owner = taskPageOwner(taskId);
      return yield* pageFrameAnswer(context.request, context.userId, owner, pageId, version);
    }),
  };
}
