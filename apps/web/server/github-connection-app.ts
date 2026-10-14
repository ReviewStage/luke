import type { DatabaseServices } from "@luke/database/core/query";
import {
  claimGitHubConnectIntent,
  githubConnection,
  openGitHubConnectIntent,
} from "@luke/database/models/github-connection-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  GITHUB_CONNECT_PAGE,
  githubConnectClaimRequestSchema,
} from "@luke/features/github-connection-wire";
import { HTTP_METHOD } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import type { GitHubUnlink } from "./hosted/github-unlink.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * github-connection-app.ts -- connecting the account's GitHub: the Mac's connect intent, the page's claim of it, and whether GitHub is connected.
 *
 * The Mac holds an OAuth access token, not the browser session Better Auth's
 * `linkSocial` needs, so it asks `POST /api/github/connect` on its bearer for
 * an intent and opens the web page the answer names, on the host it asked
 * through, where the browser's session cookie lives. The page claims the
 * intent at `POST /api/github/connect/claim` on that session rather than a
 * bearer: the claim answers claimed only for the account it was made for,
 * and only then does the page ask Better Auth to link GitHub.
 * `GET /api/github/connection` answers whether the account has a GitHub
 * account row with a usable token, and never a token.
 *
 * `POST /api/github/disconnect` removes the account's GitHub link through
 * Better Auth's own `unlinkAccount` (`hosted/github-unlink.ts`), under the
 * Mac's Better Auth session, which the bearer plugin reads off the
 * `Authorization` header: an OAuth token alone is no session, so it is
 * refused as unauthenticated, and only the session's own link can go,
 * whichever account a browser happens to be signed in to.
 */

/**
 * Better Auth's codes for an unlink it refused that Luke reads: a session
 * older than its freshness bound, which `unlinkAccount` asks of a session,
 * and GitHub as the account's last way to sign in.
 */
const UNLINK_REFUSAL = {
  SESSION_NOT_FRESH: "SESSION_NOT_FRESH",
  LAST_ACCOUNT: "FAILED_TO_UNLINK_LAST_ACCOUNT",
} as const;

/** An intent's id is 43 base64url characters, so a claim past this carries no intent. */
const MAXIMUM_CLAIM_BODY_BYTES = 1_024;

export interface GitHubConnectionAppSeams {
  resolveUserId: UserIdResolver;
  resolveSessionUserId: SessionUserIdResolver;
  /** Removes the GitHub link of the session the headers carry. */
  unlinkGitHub: GitHubUnlink;
}

/** The bearer's account, or the request refused as unauthenticated. */
const bearerAccount = /* @__PURE__ */ Effect.fn("web/githubConnectionBearer")(function* (
  seams: GitHubConnectionAppSeams,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** POST: a new intent for the bearer's account, answered with the page that carries it out. */
const connectEndpoint = /* @__PURE__ */ Effect.fn("web/githubConnectEndpoint")(function* (
  seams: GitHubConnectionAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const userId = yield* bearerAccount(seams);
  const intent = yield* hostedStoreOrUnavailable(openGitHubConnectIntent(userId));
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  // Note that the page is on the host the Mac asked through, because the session cookie is that host's.
  const url = new URL(GITHUB_CONNECT_PAGE.PATH, request.url);
  url.searchParams.set(GITHUB_CONNECT_PAGE.INTENT_PARAM, intent);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url: url.toString() });
});

/** POST: the page claims an intent on the browser's own session; another account's intent is left standing. */
const claimEndpoint = /* @__PURE__ */ Effect.fn("web/githubConnectClaimEndpoint")(function* (
  seams: GitHubConnectionAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const session = yield* seams.resolveSessionUserId(request).pipe(
    Effect.tapError((failure) => Effect.logWarning("the auth service read no session", failure)),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  if (Option.isNone(session)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const body = yield* readJsonBodyEffect(MAXIMUM_CLAIM_BODY_BYTES);
  const asked = readEither(githubConnectClaimRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const claim = yield* hostedStoreOrUnavailable(
    claimGitHubConnectIntent(asked.success.intent, session.value),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { claim });
});

/** GET: whether the bearer's account has connected its GitHub. */
const connectionEndpoint = /* @__PURE__ */ Effect.fn("web/githubConnectionEndpoint")(function* (
  seams: GitHubConnectionAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const userId = yield* bearerAccount(seams);
  const connection = yield* hostedStoreOrUnavailable(githubConnection(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, connection);
});

/**
 * POST: the session's own GitHub link removed, answering the connection as it
 * then stands. A session Better Auth refuses, or holds too old to unlink
 * with, is unauthenticated, which the Mac answers with a fresh session from
 * the hand-off; GitHub as the account's last way to sign in is not
 * permitted; anything else is the outage the Mac may retry.
 */
const disconnectEndpoint = /* @__PURE__ */ Effect.fn("web/githubDisconnectEndpoint")(function* (
  seams: GitHubConnectionAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const session = yield* seams.resolveSessionUserId(request).pipe(
    Effect.tapError((failure) => Effect.logWarning("the auth service read no session", failure)),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  if (Option.isNone(session)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  yield* seams.unlinkGitHub(request.headers).pipe(
    Effect.catch((failure): Effect.Effect<never, HostedRefusal> => {
      // A failure that is not a refusal is logged by its kind alone, since what it threw may quote a request.
      if (failure._tag === "UnknownError") {
        return Effect.andThen(
          Effect.logWarning("GitHub unlink failed: UnknownError"),
          Effect.fail(HOSTED_REFUSAL.UNAVAILABLE),
        );
      }
      if (
        failure.status === HOSTED_HTTP_STATUS.UNAUTHORIZED ||
        failure.code === UNLINK_REFUSAL.SESSION_NOT_FRESH
      ) {
        return Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
      }
      return Effect.fail(
        failure.code === UNLINK_REFUSAL.LAST_ACCOUNT
          ? HOSTED_REFUSAL.NOT_PERMITTED
          : HOSTED_REFUSAL.UNAVAILABLE,
      );
    }),
  );
  const connection = yield* hostedStoreOrUnavailable(githubConnection(session.value));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, connection);
});

/** The group: the four paths, and the hosted vocabulary's own refusal for any other. */
export function githubConnectionApp(seams: GitHubConnectionAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_CONNECT,
      hostedRefusing(connectEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_CONNECT_CLAIM,
      hostedRefusing(claimEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_CONNECTION,
      hostedRefusing(connectionEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_DISCONNECT,
      hostedRefusing(disconnectEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
