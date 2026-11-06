import type { DatabaseServices } from "@repo/database/core/query";
import type { WorkspaceSeams } from "@repo/database/models/workspace-seams";
import { ensurePersonalWorkspace } from "@repo/database/models/workspace-store";
import { catchAllButInterrupt, causeKind } from "@repo/runtime/effect";
import { Effect, Layer, Option } from "effect";
import { type HttpMethod, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { readAccountPerson } from "../accounts/account-person.js";
import { WelcomeMail } from "../accounts/welcome-mail.js";
import { SERVER_EVENT } from "../events/server-events.js";
import { hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { type AuthCount, recordAuthCount, withAuthCounts } from "./auth-counts.js";
import { AUTH_BASE_PATH } from "./auth-policy.js";

export const AUTH_PATH_PREFIX = `${AUTH_BASE_PATH}/`;

const AUTH_PATH_SET = `${AUTH_PATH_PREFIX}*`;

const WELL_KNOWN_METADATA = {
  AUTHORIZATION_SERVER: "oauth-authorization-server",
  OPENID_CONFIGURATION: "openid-configuration",
} as const;

export interface AuthMetadataPath {
  readonly path: string;
  readonly carried: string;
}

export const AUTH_SERVER_METADATA_PATHS: readonly AuthMetadataPath[] = Object.values(
  WELL_KNOWN_METADATA,
).map((name) => ({
  path: `/.well-known/${name}${AUTH_BASE_PATH}`,
  carried: `${AUTH_BASE_PATH}/.well-known/${name}`,
}));

const BODYLESS_METHOD = { HEAD: "HEAD" } as const satisfies Record<string, HttpMethod.HttpMethod>;

const RESPONSE_HEADER = { SET_COOKIE: "set-cookie" } as const;

export type WebRequestHandler = (request: Request) => Promise<Response>;

function bodylessAnswer(answer: Response): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.empty({
    status: answer.status,
    statusText: answer.statusText,
    headers: [...answer.headers].filter(([name]) => name !== RESPONSE_HEADER.SET_COOKIE),
  });
}

function workspaceOfSignUp(
  count: AuthCount,
  workspaces: WorkspaceSeams,
): Effect.Effect<void, never, DatabaseServices> {
  if (count.name !== SERVER_EVENT.ACCOUNT_SIGN_UP) return Effect.void;
  return catchAllButInterrupt(
    Effect.asVoid(ensurePersonalWorkspace(count.actor.userId, workspaces)),
    (cause) => Effect.logWarning(`Workspace not made at sign-up: ${causeKind(cause)}`),
  );
}

function welcomeOfSignUp(count: AuthCount): Effect.Effect<void, never, DatabaseServices> {
  if (count.name !== SERVER_EVENT.ACCOUNT_SIGN_UP) return Effect.void;
  return Effect.gen(function* () {
    const mail = yield* Effect.serviceOption(WelcomeMail);
    if (Option.isNone(mail)) return;
    const person = yield* catchAllButInterrupt(readAccountPerson(count.actor.userId), (cause) =>
      Effect.as(Effect.logWarning(`Welcome email not sent: ${causeKind(cause)}`), undefined),
    );
    if (person === undefined) return;
    yield* mail.value.send(person);
  });
}

const authPassthrough = /* @__PURE__ */ Effect.fn("web/authPassthrough")(function* (
  handle: WebRequestHandler,
  workspaces: WorkspaceSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { answer, counts } = yield* Effect.promise(() => withAuthCounts(() => handle(request)));
  yield* Effect.forEach(counts, (count) => workspaceOfSignUp(count, workspaces), {
    discard: true,
  });
  yield* Effect.forEach(counts, welcomeOfSignUp, { discard: true });
  yield* Effect.forEach(counts, recordAuthCount, { discard: true });
  return incoming.method === BODYLESS_METHOD.HEAD
    ? bodylessAnswer(answer)
    : HttpServerResponse.raw(answer);
});

export function authApp(
  handle: WebRequestHandler,
  workspaces: WorkspaceSeams,
): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, AUTH_PATH_SET, authPassthrough(handle, workspaces)),
    hostedNotFoundRoute,
  );
}
