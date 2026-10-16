import type { DatabaseServices } from "@luke/database/core/query";
import { changeIssue, createIssue, listIssues, readIssue } from "@luke/database/models/issue-store";
import { wireUuidSchema } from "@luke/features";
import {
  ISSUE_BOUNDS,
  ISSUE_LIST_QUERY,
  issueChangeRequestSchema,
  issueCreateRequestSchema,
} from "@luke/features/issue-wire";
import { unparsedWire } from "@luke/wire";
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
 * issues-app.ts -- a workspace's issues, read and written by its members: list and file them, and read and change one.
 *
 * `GET /api/issues?workspaceId=` answers the workspace's issues, the most
 * recently changed first, or its archived ones where `archived=true`;
 * `POST` files one and answers it as kept. `GET /api/issues/:id` reads one
 * issue and `PATCH` changes it, archiving it among the rest, and answers it
 * as kept, so the window draws the service's word rather than its own
 * guess. Every request resolves the bearer before it touches a row, and the
 * store gates every row on the account's membership of the issue's
 * workspace, so a workspace the account is not in, or an issue of one,
 * answers exactly as one that does not exist.
 */

const PATH = {
  /** GET lists a workspace's issues; POST files one. */
  ISSUES: "/api/issues",
  /** GET reads one, PATCH changes it; the rewrite moves the path's id into the `id` query. */
  ISSUE: "/api/issues/issue",
} as const;

const HTTP_METHOD = { GET: "GET", POST: "POST", PATCH: "PATCH" } as const;

const QUERY = { ID: "id" } as const;

/** How `archived` reads on a list's query: absent or false lists the issues standing, true the archived ones. */
const ARCHIVED_QUERY = { TRUE: "true", FALSE: "false" } as const;

/**
 * A body past this is no issue: the description's and the title's bounds
 * at six bytes a character, the most JSON spends on one (`\u0000`), and the
 * rest of the frame with room, so every issue the schema takes fits.
 */
const MAXIMUM_BODY_BYTES =
  (ISSUE_BOUNDS.MAX_DESCRIPTION_CHARS + ISSUE_BOUNDS.MAX_TITLE_CHARS) * 6 + 4_096;

export interface IssuesAppSeams {
  resolveUserId: UserIdResolver;
}

type RouteServices = DatabaseServices | HttpServerRequest.HttpServerRequest;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: IssuesAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The one id the path put under `id`; two is refused, and one that is no UUID names no issue. */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(QUERY.ID);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
});

/** GET: the workspace's issues, standing or archived; refused where the query names no one workspace. */
const listEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  request: Request,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const query = new URL(request.url).searchParams;
  const workspaces = query.getAll(ISSUE_LIST_QUERY.WORKSPACE_ID);
  const archives = query.getAll(ISSUE_LIST_QUERY.ARCHIVED);
  const [organizationId] = workspaces;
  const [archived = ARCHIVED_QUERY.FALSE] = archives;
  if (
    organizationId === undefined ||
    organizationId === "" ||
    workspaces.length !== 1 ||
    archives.length > 1 ||
    (archived !== ARCHIVED_QUERY.TRUE && archived !== ARCHIVED_QUERY.FALSE)
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const issues = yield* hostedStoreOrUnavailable(
    listIssues(userId, organizationId, { archived: archived === ARCHIVED_QUERY.TRUE }),
  );
  if (Option.isNone(issues)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { issues: issues.value });
});

/** POST: an issue filed in a workspace of the account's, answered as kept. */
const createEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const asked = readEither(issueCreateRequestSchema)(yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES));
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { workspaceId, ...made } = asked.success;
  const created = yield* hostedStoreOrUnavailable(
    createIssue(userId, { ...made, organizationId: workspaceId }),
  );
  if (Option.isNone(created)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { issue: created.value });
});

/** The issues list path: GET lists, POST files. */
const issuesEndpoint = /* @__PURE__ */ Effect.fn("web/issuesEndpoint")(function* (
  seams: IssuesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  return incoming.method === HTTP_METHOD.GET
    ? yield* listEndpoint(userId, request)
    : yield* createEndpoint(userId);
});

/** The one issue path: GET reads it, PATCH changes it. */
const issueEndpoint = /* @__PURE__ */ Effect.fn("web/issueEndpoint")(function* (
  seams: IssuesAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, RouteServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.PATCH) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  const id = yield* idOf(request);
  if (incoming.method === HTTP_METHOD.GET) {
    const issue = yield* hostedStoreOrUnavailable(readIssue(userId, id));
    if (Option.isNone(issue)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { issue: issue.value });
  }
  const asked = readEither(issueChangeRequestSchema)(yield* readJsonBodyEffect(MAXIMUM_BODY_BYTES));
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const changed = yield* hostedStoreOrUnavailable(changeIssue(userId, id, asked.success));
  if (Option.isNone(changed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { issue: changed.value });
});

/** The group: the two issue paths, and the hosted vocabulary's own refusal for any other. */
export function issuesApp(seams: IssuesAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PATH.ISSUES, hostedRefusing(issuesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PATH.ISSUE, hostedRefusing(issueEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
