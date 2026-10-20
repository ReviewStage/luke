import type { DatabaseServices } from "@luke/database/core/query";
import { readPlanAttachment } from "@luke/database/models/plan-attachments";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { unparsedWire, wireUuidSchema } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * tasks-app.ts -- a plan's picture served as its bytes, the one plan read the hosted oRPC router does not answer, since it answers bytes rather than JSON.
 *
 * The plans themselves, and each one's board, edit, history, transcript,
 * work, and Stop, are the router's (`tasks-procedures.ts`), and so are its
 * code, its repository's files, its pages, and a picture kept on it
 * (`task-files-procedures.ts`). The read here resolves the bearer before it
 * touches a row, and every row it touches is one the bearer's account
 * reaches: a plan id another account owns answers exactly as one that names
 * nothing, so nothing is learned about plans the caller does not hold.
 */

const TASKS_PATH = {
  /** GET serves one picture of the plan as its bytes; the rewrite moves the path's ids into the `id` and `attachment` queries. */
  ATTACHMENT: "/api/plans/attachment",
} as const;

const HTTP_METHOD = {
  GET: "GET",
} as const;

const TASK_ID_QUERY = "id";

/** The query naming one picture of the plan by its id. */
const ATTACHMENT_QUERY = "attachment";

export interface TasksAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the route may require of the function that stands it: the store. */
export type TasksAppServices = DatabaseServices;

type TasksServices = TasksAppServices | HttpServerRequest.HttpServerRequest;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TasksAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/**
 * The one id the path named under `query`. Two would leave the path and the effect
 * disagreeing, so two is refused; an id that is not a UUID names no row, and
 * answers as none.
 */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  query: string,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(query);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/**
 * GET serves one picture of the plan as its bytes, under the media type the
 * service sniffed them to be as they were kept, to the members of the plan's
 * workspace alone: a picture of a plan the account does not reach, or of
 * another plan, is not found, as a plan is.
 */
const attachmentEndpoint = /* @__PURE__ */ Effect.fn("web/planAttachmentEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const attachmentId = yield* idOf(request, ATTACHMENT_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const found = yield* hostedStoreOrUnavailable(readPlanAttachment(userId, taskId, attachmentId));
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

/** The group: the task paths, and the hosted vocabulary's own refusal for any other. */
export function tasksApp(seams: TasksAppSeams): WebRoutes<TasksAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ATTACHMENT, hostedRefusing(attachmentEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
