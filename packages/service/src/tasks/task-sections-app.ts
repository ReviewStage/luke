import type { DatabaseServices } from "@luke/database/core/query";
import { listTaskSections, writeTaskSections } from "@luke/database/models/task-section-store";
import { taskSectionWriteSchema } from "@luke/features/task-section-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * task-sections-app.ts -- the sections the account made in the Mac's sidebars and the tasks it keeps in them: read them, and write one change.
 *
 * `GET /api/task-sections` answers the account's sections and its entries;
 * `PUT` makes, edits, moves, or deletes one section, or puts one task in a
 * section or in none, and answers them all as they then stand, so the
 * window draws the service's word rather than its own guess. Every request
 * resolves the bearer before it touches a row, and every row it touches is
 * the bearer's account's own (`task-section-store.ts`). It stands apart
 * from `/api/plans/*` because that path's rewrite reads its next segment
 * as a plan's id.
 */

const TASK_SECTIONS_PATH = "/api/task-sections";

const HTTP_METHOD = { GET: "GET", PUT: "PUT" } as const;

/** A write is two ids, a title, and an emoji at most, so a body past this is not one. */
const MAXIMUM_WRITE_BODY_BYTES = 2_048;

export interface TaskSectionsAppSeams {
  resolveUserId: UserIdResolver;
}

const taskSectionsEndpoint = /* @__PURE__ */ Effect.fn("web/taskSectionsEndpoint")(function* (
  seams: TaskSectionsAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.PUT) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  if (incoming.method === HTTP_METHOD.GET) {
    const sections = yield* hostedStoreOrUnavailable(listTaskSections(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, sections);
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_WRITE_BODY_BYTES);
  const asked = readEither(taskSectionWriteSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const sections = yield* hostedStoreOrUnavailable(writeTaskSections(userId, asked.success));
  // A section that is not the account's, a task it does not reach there, or one past the bound is a request the service will not keep.
  if (Option.isNone(sections)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, sections.value);
});

/** The group: the one sections path, and the hosted vocabulary's own refusal for any other. */
export function taskSectionsApp(seams: TaskSectionsAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, TASK_SECTIONS_PATH, hostedRefusing(taskSectionsEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
