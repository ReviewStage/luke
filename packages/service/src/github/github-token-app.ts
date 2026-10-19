import type { DatabaseServices } from "@luke/database/core/query";
import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  type GitHubTokenRow,
  linkedGitHubUserIds,
  readGitHubTokenRow,
  removeGitHubToken,
  saveGitHubToken,
} from "@luke/database/models/github-token-store";
import {
  type KeyRing,
  openGitHubToken,
  parseKeyRing,
  sealGitHubToken,
} from "@luke/database/models/provider-key-seal";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
  githubTokenSaveRequestSchema,
} from "@luke/features/github-token-wire";
import { EXPERIMENT } from "@luke/settings";
import { readEither } from "@luke/wire/effect";
import { DateTime, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HttpClient, HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HostedEnvironment } from "../environment.js";
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
import { makeRateBrake, type RateBrake } from "../http/rate-brake.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { githubRead } from "./github-app.js";

/**
 * github-token-app.ts -- the member's own classic GitHub personal access token: read what it is, save one, remove it.
 *
 * `GET /api/github/token` answers the member's token as its login, hint,
 * status, and expiry; `PUT` saves one, first asking GitHub whose it is with
 * one `GET /user` on it, and keeps it sealed
 * (`@luke/database/models/provider-key-seal`) only where GitHub accepts it,
 * it carries the `repo` scope, and it is the member's own linked GitHub
 * account's; `DELETE` removes it. A fine-grained token is refused before it
 * is sent anywhere. Every answer is the token as it then stands and none
 * carries it: the one body that holds a token is the `PUT`'s own, it is
 * sealed the moment it is checked, and neither it nor what GitHub said of it
 * is logged.
 *
 * The path answers only while the member has the GitHub token experiment on
 * (`EXPERIMENT.GITHUB_TOKEN`), and as a path that names nothing otherwise.
 * A deployment holding no ring, or one it cannot parse, answers every
 * request unavailable. A save is braked per member, ten an hour, as the
 * provider keys' is, so the endpoint is no oracle for tokens that are not
 * the caller's.
 */

const HTTP_METHOD = { GET: "GET", PUT: "PUT", DELETE: "DELETE" } as const;

/** A save is one token bounded at 255 characters, so a body past this is not one. */
const MAXIMUM_SAVE_BODY_BYTES = 1_024;

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

/** How long GitHub is given to answer before the save is answered unreachable. */
const CHECK_TIMEOUT = Duration.seconds(10);

/** Every fine-grained token's own prefix. */
const FINE_GRAINED_PREFIX = "github_pat_";

/** The scope a token is not kept without. */
const REQUIRED_SCOPE = "repo";

/** The headers GitHub answers a classic token's read with: the scopes it grants, and when it expires where it does. */
const GITHUB_TOKEN_HEADER = {
  SCOPES: "x-oauth-scopes",
  EXPIRATION: "github-authentication-token-expiration",
} as const;

const HINT_PREFIX = /^[a-z]+_/u;
const HINT_TAIL_CHARS = 4;

const GitHubUserSchema = Schema.Struct({ id: Schema.Number, login: Schema.String });

export interface GitHubTokenAppSeams {
  resolveUserId: UserIdResolver;
}

type GitHubTokenRequirements =
  | HttpServerRequest.HttpServerRequest
  | DatabaseServices
  | HostedEnvironment
  | HttpClient.HttpClient;

/** What GitHub said of a token it accepted. */
interface CheckedToken {
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly expiresAt: Date | null;
}

/** The hint a member is shown of a token: its prefix and its last four characters, as `ghp_…abcd`. */
function tokenHint(token: Redacted.Redacted<string>): string {
  const revealed = Redacted.value(token);
  const prefix = HINT_PREFIX.exec(revealed)?.[0] ?? "";
  return `${prefix}…${revealed.slice(-HINT_TAIL_CHARS)}`;
}

/** GitHub's expiry header as an instant, or null where it sent none it spells as one. */
function expiryOf(header: string | undefined): Date | null {
  const parsed = header === undefined ? Number.NaN : Date.parse(header);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * Asks GitHub whose the token is, over the ambient client: what it said of
 * a token it accepted, or why it is not kept. Never fails, since every
 * outcome is an answer; the body is read only on a 200, and nothing of the
 * exchange is logged.
 */
const checkGitHubToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted<string>,
  linked: readonly string[],
): Effect.fn.Return<
  Result.Result<CheckedToken, GitHubTokenRejection>,
  never,
  HttpClient.HttpClient
> {
  if (Redacted.value(token).startsWith(FINE_GRAINED_PREFIX)) {
    return Result.fail(GITHUB_TOKEN_REJECTION.FINE_GRAINED);
  }
  if (linked.length === 0) return Result.fail(GITHUB_TOKEN_REJECTION.NO_GITHUB_ACCOUNT);
  const client = yield* HttpClient.HttpClient;
  const answered = yield* client.execute(githubRead("/user", token)).pipe(
    Effect.flatMap((response) =>
      response.status === 200
        ? Effect.map(response.json, (body) => ({
            status: response.status,
            headers: response.headers,
            user: Schema.decodeUnknownOption(GitHubUserSchema)(body),
          }))
        : Effect.succeed({
            status: response.status,
            headers: response.headers,
            user: Option.none(),
          }),
    ),
    Effect.scoped,
    Effect.timeout(CHECK_TIMEOUT),
    Effect.option,
  );
  if (Option.isNone(answered)) return Result.fail(GITHUB_TOKEN_REJECTION.UNREACHABLE);
  const { status, headers, user } = answered.value;
  if (status === 401) return Result.fail(GITHUB_TOKEN_REJECTION.INVALID);
  if (Option.isNone(user)) return Result.fail(GITHUB_TOKEN_REJECTION.UNREACHABLE);
  const scopes = (headers[GITHUB_TOKEN_HEADER.SCOPES] ?? "")
    .split(",")
    .map((scope) => scope.trim());
  if (!scopes.includes(REQUIRED_SCOPE)) return Result.fail(GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE);
  const githubUserId = String(user.value.id);
  if (!linked.includes(githubUserId)) return Result.fail(GITHUB_TOKEN_REJECTION.OTHER_USER);
  return Result.succeed({
    githubUserId,
    githubLogin: user.value.login,
    expiresAt: expiryOf(headers[GITHUB_TOKEN_HEADER.EXPIRATION]),
  });
});

/** The deployment's ring, or the request refused as unavailable where it holds none it can parse. */
const keyRingOrUnavailable = Effect.gen(function* () {
  const configured = (yield* HostedEnvironment).providerKeyEncryptionKeys;
  if (configured === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const ring = parseKeyRing(configured);
  if (Result.isFailure(ring)) {
    // The fault names the shape that is wrong and never a value.
    yield* Effect.logError(`The provider key encryption keys cannot be read: ${ring.failure}`);
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return ring.success;
});

/** The token as the member is shown it, answered unreadable where the ring cannot open it. */
function summaryOf(userId: string, ring: KeyRing, row: GitHubTokenRow): GitHubTokenSummary {
  const readable = Result.isSuccess(openGitHubToken(ring, userId, row));
  return {
    login: row.githubLogin,
    hint: row.hint,
    status: readable ? row.status : GITHUB_TOKEN_STATUS.UNREADABLE,
    statusAt: row.statusAt.getTime(),
    addedAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt?.getTime() ?? null,
  };
}

const tokenResponse = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  rejected?: GitHubTokenRejection,
) {
  const row = yield* hostedStoreOrUnavailable(readGitHubTokenRow(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    token: row === undefined ? null : summaryOf(userId, ring, row),
    ...(rejected === undefined ? undefined : { rejected }),
  });
});

/** A save: braked, checked with GitHub, and kept sealed only where GitHub accepts it as the member's own. */
const saveEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  brake: RateBrake,
) {
  const body = yield* readJsonBodyEffect(MAXIMUM_SAVE_BODY_BYTES);
  // Note that a refusal's wording is never logged or answered, because it may quote the token.
  const asked = readEither(githubTokenSaveRequestSchema)(body);
  if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const token = Redacted.make(asked.success.token);
  if (!(yield* brake.check(userId))) {
    return yield* tokenResponse(userId, ring, GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES);
  }
  const linked = yield* hostedStoreOrUnavailable(linkedGitHubUserIds(userId));
  const checked = yield* checkGitHubToken(token, linked);
  if (Result.isFailure(checked)) return yield* tokenResponse(userId, ring, checked.failure);
  const now = yield* DateTime.nowAsDate;
  const facts = { hint: tokenHint(token), ...checked.success };
  yield* hostedStoreOrUnavailable(
    saveGitHubToken(userId, sealGitHubToken(ring, userId, token), facts, now),
  );
  return yield* tokenResponse(userId, ring);
});

const githubTokenEndpoint = /* @__PURE__ */ Effect.fn("web/githubTokenEndpoint")(function* (
  seams: GitHubTokenAppSeams,
  brake: RateBrake,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, GitHubTokenRequirements> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (!Object.values(HTTP_METHOD).some((method) => method === incoming.method)) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const userId = account.value;
  const on = yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.GITHUB_TOKEN));
  if (!on) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const ring = yield* keyRingOrUnavailable;
  switch (incoming.method) {
    case HTTP_METHOD.PUT:
      return yield* saveEndpoint(userId, ring, brake);
    case HTTP_METHOD.DELETE:
      yield* hostedStoreOrUnavailable(removeGitHubToken(userId));
      return yield* tokenResponse(userId, ring);
    default:
      return yield* tokenResponse(userId, ring);
  }
});

/** The group: the one token path, braked per instance, and the hosted vocabulary's own refusal for any other. */
export function githubTokenApp(
  seams: GitHubTokenAppSeams,
): WebRoutes<DatabaseServices | HostedEnvironment | HttpClient.HttpClient> {
  const brake = makeRateBrake(SAVE_BRAKE);
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_TOKEN,
      hostedRefusing(githubTokenEndpoint(seams, brake)),
    ),
    hostedNotFoundRoute,
  );
}
