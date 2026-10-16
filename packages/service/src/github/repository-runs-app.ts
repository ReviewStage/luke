import type { DatabaseServices } from "@luke/database/core/query";
import { listRepositoryRuns, setRepositoryRun } from "@luke/database/models/repository-run-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  REPOSITORY_RUNS_QUERY,
  repositoryRunSetRequestSchema,
} from "@luke/features/repository-run-wire";
import { workspaceIdSchema } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { unparsedWire } from "../core.js";
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
 * repository-runs-app.ts -- how a workspace's repositories are set up and run on a Mac, shared by every member.
 *
 * `GET /api/repository-runs?workspaceId=` answers the workspace's
 * repositories with a command set; `PUT` sets one repository's setup and
 * run commands, or forgets them where both are null, and answers them all
 * as they then stand. Any member of the workspace may read and set them; a
 * workspace the account is not in is not found. The commands are only ever
 * read by a Mac whose developer pressed Run.
 */

const HTTP_METHOD = { GET: "GET", PUT: "PUT" } as const;

/** Two commands at their bound, and room for the rest of the body. */
const MAXIMUM_RUN_BODY_BYTES = 40 * 1_024;

export interface RepositoryRunsAppSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace the account asks for, where it is a member; refused otherwise. */
const memberWorkspace = (userId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return workspaceId;
  });

const repositoryRunsEndpoint = /* @__PURE__ */ Effect.fn("web/repositoryRunsEndpoint")(function* (
  seams: RepositoryRunsAppSeams,
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
    const named = new URL(request.url).searchParams.getAll(REPOSITORY_RUNS_QUERY.WORKSPACE_ID);
    const read = readEither(workspaceIdSchema)(unparsedWire(named[0]));
    if (named.length !== 1 || Result.isFailure(read)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }
    const workspaceId = yield* memberWorkspace(userId, read.success);
    const runs = yield* hostedStoreOrUnavailable(listRepositoryRuns(workspaceId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { runs });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_RUN_BODY_BYTES);
  const asked = readEither(repositoryRunSetRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId: named, ...run } = asked.success;
  const workspaceId = yield* memberWorkspace(userId, named);
  const runs = yield* hostedStoreOrUnavailable(setRepositoryRun(workspaceId, userId, run));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { runs });
});

/** The group: the one path, and the hosted vocabulary's own refusal for any other. */
export function repositoryRunsApp(seams: RepositoryRunsAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.REPOSITORY_RUNS,
      hostedRefusing(repositoryRunsEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
