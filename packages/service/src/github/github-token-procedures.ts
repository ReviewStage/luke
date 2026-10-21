/**
 * github-token-procedures.ts -- the member's own classic GitHub personal access token: read what it is, save one, remove it.
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
 * is logged. A save whose body its schema refuses is answered as the bare
 * `invalid-request` slug (`orpc/errors.ts`), so what the schema said of the
 * token never leaves the function.
 *
 * A deployment holding no ring, or one it cannot parse, answers every
 * request unavailable. The caller, the ring, and the save's
 * body bound are each checked on the resource's implementer, in that order,
 * so they run before oRPC reads the save's body, as the old group checked
 * them before it read one. A save is braked per member, ten an hour, as the
 * provider keys' is, so the endpoint is no oracle for tokens that are not
 * the caller's.
 */

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
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenAnswer,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@luke/features/github-token-wire";
import { middlewareGen } from "@orpc/experimental-effect";
import { DateTime, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { HttpClient } from "effect/http";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { makeRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, type HostedContext, hosted } from "../orpc/base.js";
import { githubRead } from "./github-app.js";

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

/** How long GitHub is given to answer before the save is answered unreachable. */
const CHECK_TIMEOUT = Duration.seconds(10);

/**
 * The prefixes GitHub documents for a personal access token, classic and
 * fine-grained: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#githubs-token-formats
 */
const TOKEN_PREFIX = { CLASSIC: "ghp_", FINE_GRAINED: "github_pat_" } as const;

/** The scope a token is not kept without. */
const REQUIRED_SCOPE = "repo";

/**
 * The headers GitHub answers a classic token's read with. `X-OAuth-Scopes`
 * lists the scopes the token grants, comma-separated:
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
 * `GitHub-Authentication-Token-Expiration` is the token's expiry, sent only
 * for a token that has one:
 * https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/
 * Headers are read by their lowercase names, as the HTTP client keys them.
 */
const GITHUB_TOKEN_HEADER = {
  SCOPES: "x-oauth-scopes",
  EXPIRATION: "github-authentication-token-expiration",
} as const;

const HINT_TAIL_CHARS = 4;

const GitHubUserSchema = Schema.Struct({ id: Schema.Number, login: Schema.String });

export interface GitHubTokenProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** What GitHub said of a token it accepted. */
interface CheckedToken {
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly expiresAt: Date | null;
}

/** The hint a member is shown of a token: the classic prefix where it has it and its last four characters, as `ghp_…abcd`. */
function tokenHint(token: Redacted.Redacted<string>): string {
  const revealed = Redacted.value(token);
  const prefix = revealed.startsWith(TOKEN_PREFIX.CLASSIC) ? TOKEN_PREFIX.CLASSIC : "";
  return `${prefix}…${revealed.slice(-HINT_TAIL_CHARS)}`;
}

/** GitHub's expiry header as an instant, as `2021-03-31 21:46:14 UTC`, or null where it sent none or one that spells no instant. */
function expiryOf(header: string | undefined): Date | null {
  const parsed = header === undefined ? Number.NaN : Date.parse(header);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * Asks GitHub whose the token is, over the ambient client: what it said of
 * a token it accepted, or why it is not kept. Never fails, since every
 * outcome is an answer; the body is read only on a 200, and nothing of the
 * exchange is logged.
 *
 * The one read is GitHub's "Get the authenticated user", `GET /user` under
 * `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
 * and `X-GitHub-Api-Version: 2022-11-28` (`githubRead`), which answers 401
 * for a token GitHub does not accept:
 * https://docs.github.com/en/rest/users/users#get-the-authenticated-user
 * https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
 */
const checkGitHubToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted<string>,
  linked: readonly string[],
): Effect.fn.Return<
  Result.Result<CheckedToken, GitHubTokenRejection>,
  never,
  HttpClient.HttpClient
> {
  if (Redacted.value(token).startsWith(TOKEN_PREFIX.FINE_GRAINED)) {
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

/** The deployment's ring, handed on as the procedure's, or the request refused as unavailable where it holds none it can parse. */
const keyRingMiddleware = middlewareGen<HostedContext, { readonly ring: KeyRing }>(function* ({
  next,
}) {
  const configured = (yield* HostedEnvironment).providerKeyEncryptionKeys;
  if (configured === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const ring = parseKeyRing(configured);
  if (Result.isFailure(ring)) {
    // The fault names the shape that is wrong and never a value.
    yield* Effect.logError(`The provider key encryption keys cannot be read: ${ring.failure}`);
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  return yield* next({ context: { ring: ring.success } });
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

const tokenAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  rejected?: GitHubTokenRejection,
) {
  const row = yield* hostedStoreOrUnavailable(readGitHubTokenRow(userId));
  return {
    token: row === undefined ? null : summaryOf(userId, ring, row),
    ...(rejected === undefined ? undefined : { rejected }),
  } satisfies GitHubTokenAnswer;
});

/** The token's three procedures, braked per instance, each to a signed-in member, on a deployment that holds a ring. */
export function githubTokenProcedures(seams: GitHubTokenProcedureSeams) {
  const brake = makeRateBrake(SAVE_BRAKE);
  const held = hosted.githubToken
    .use(accountMiddleware(seams.resolveUserId))
    .use(keyRingMiddleware);
  return {
    read: held.read.effect(function* ({ context }) {
      return yield* tokenAnswer(context.userId, context.ring);
    }),

    /** A save: braked, checked with GitHub, and kept sealed only where GitHub accepts it as the member's own. */
    save: held.save.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      const token = Redacted.make(input.token);
      if (!(yield* brake.check(userId))) {
        return yield* tokenAnswer(userId, ring, GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES);
      }
      const linked = yield* hostedStoreOrUnavailable(linkedGitHubUserIds(userId));
      const checked = yield* checkGitHubToken(token, linked);
      if (Result.isFailure(checked)) return yield* tokenAnswer(userId, ring, checked.failure);
      const now = yield* DateTime.nowAsDate;
      const facts = { hint: tokenHint(token), ...checked.success };
      yield* hostedStoreOrUnavailable(
        saveGitHubToken(userId, sealGitHubToken(ring, userId, token), facts, now),
      );
      return yield* tokenAnswer(userId, ring);
    }),

    remove: held.remove.effect(function* ({ context }) {
      yield* hostedStoreOrUnavailable(removeGitHubToken(context.userId));
      return yield* tokenAnswer(context.userId, context.ring);
    }),
  };
}
