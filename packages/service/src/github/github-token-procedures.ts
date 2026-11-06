import {
  type GitHubTokenRow,
  readGitHubTokenRow,
  removeGitHubToken,
  saveGitHubToken,
} from "@repo/database/models/github-token-store";
import {
  type KeyRing,
  openGitHubToken,
  sealGitHubToken,
} from "@repo/database/models/provider-key-seal";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenAnswer,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@repo/features/github-token-wire";
import { DateTime, Duration, Effect, Option, Redacted, Result, Schema } from "effect";
import { HttpClient } from "effect/http";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import { hostedStoreOrUnavailable, type UserIdResolver } from "../http/http-effect.js";
import { makeRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";
import { githubRead } from "./github-app.js";

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

const CHECK_TIMEOUT = Duration.seconds(10);

const TOKEN_PREFIX = { CLASSIC: "ghp_", FINE_GRAINED: "github_pat_" } as const;

const REQUIRED_SCOPE = "repo";

const GITHUB_TOKEN_HEADER = {
  SCOPES: "x-oauth-scopes",
  EXPIRATION: "github-authentication-token-expiration",
} as const;

const HINT_TAIL_CHARS = 4;

const GitHubUserSchema = Schema.Struct({ id: Schema.Number, login: Schema.String });

export interface GitHubTokenProcedureSeams {
  resolveUserId: UserIdResolver;
}

interface CheckedToken {
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly expiresAt: Date | null;
}

function tokenHint(token: Redacted.Redacted<string>): string {
  const revealed = Redacted.value(token);
  const prefix = revealed.startsWith(TOKEN_PREFIX.CLASSIC) ? TOKEN_PREFIX.CLASSIC : "";
  return `${prefix}…${revealed.slice(-HINT_TAIL_CHARS)}`;
}

function expiryOf(header: string | undefined): Date | null {
  const parsed = header === undefined ? Number.NaN : Date.parse(header);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

const checkGitHubToken = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted<string>,
): Effect.fn.Return<
  Result.Result<CheckedToken, GitHubTokenRejection>,
  never,
  HttpClient.HttpClient
> {
  if (Redacted.value(token).startsWith(TOKEN_PREFIX.FINE_GRAINED)) {
    return Result.fail(GITHUB_TOKEN_REJECTION.FINE_GRAINED);
  }
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
  return Result.succeed({
    githubUserId,
    githubLogin: user.value.login,
    expiresAt: expiryOf(headers[GITHUB_TOKEN_HEADER.EXPIRATION]),
  });
});

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

export function githubTokenProcedures(seams: GitHubTokenProcedureSeams) {
  const brake = makeRateBrake(SAVE_BRAKE);
  const held = hosted.githubToken
    .use(accountMiddleware(seams.resolveUserId))
    .use(keyRingMiddleware);
  return {
    read: held.read.effect(function* ({ context }) {
      return yield* tokenAnswer(context.userId, context.ring);
    }),

    save: held.save.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      const token = Redacted.make(input.token);
      if (!(yield* brake.check(userId))) {
        return yield* tokenAnswer(userId, ring, GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES);
      }
      const checked = yield* checkGitHubToken(token);
      if (Result.isFailure(checked)) return yield* tokenAnswer(userId, ring, checked.failure);
      const now = yield* DateTime.nowAsDate;
      const facts = { hint: tokenHint(token), ...checked.success };
      yield* hostedStoreOrUnavailable(
        saveGitHubToken(userId, sealGitHubToken(ring, userId, token), facts, now),
      );
      yield* recordServerEvent(SERVER_EVENT.GITHUB_TOKEN_SAVE, { userId }, {});
      return yield* tokenAnswer(userId, ring);
    }),

    remove: held.remove.effect(function* ({ context }) {
      yield* hostedStoreOrUnavailable(removeGitHubToken(context.userId));
      return yield* tokenAnswer(context.userId, context.ring);
    }),
  };
}
