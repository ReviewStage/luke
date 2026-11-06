import type { DatabaseServices } from "@repo/database/core/query";
import { readDescriptionAttachment } from "@repo/database/models/description-attachments";
import { readDescriptionCommentFile } from "@repo/database/models/description-comments";
import { HTTP_METHOD } from "@repo/wire";
import { Effect, Layer, Option, type Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  resolvedUserId,
  type UserIdResolver,
  uuidOf,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

const TASKS_PATH = {
  ATTACHMENT: "/api/plans/attachment",
} as const;

const TASK_ID_QUERY = "id";

const ATTACHMENT_QUERY = "attachment";

export interface TasksAppSeams {
  resolveUserId: UserIdResolver;
}

export type TasksAppServices = DatabaseServices;

type TasksServices = TasksAppServices | HttpServerRequest.HttpServerRequest | Scope.Scope;

const attachmentEndpoint = /* @__PURE__ */ Effect.fn("web/descriptionAttachmentEndpoint")(
  function* (
    seams: TasksAppSeams,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const taskId = yield* uuidOf(request, TASK_ID_QUERY);
    const attachmentId = yield* uuidOf(request, ATTACHMENT_QUERY);
    const userId = yield* resolvedUserId(seams, request);
    const picture = yield* hostedStoreOrUnavailable(
      readDescriptionAttachment(userId, taskId, attachmentId),
    );
    const found: Option.Option<{ readonly contentType: string; readonly bytes: Uint8Array }> =
      Option.isSome(picture)
        ? picture
        : yield* hostedStoreOrUnavailable(readDescriptionCommentFile(userId, taskId, attachmentId));
    if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return HttpServerResponse.uint8Array(found.value.bytes, {
      status: HOSTED_HTTP_STATUS.OK,
      contentType: found.value.contentType,
      headers: HOSTED_BYTES_HEADERS,
    });
  },
);

export function tasksApp(seams: TasksAppSeams): WebRoutes<TasksAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ATTACHMENT, hostedRefusing(attachmentEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
