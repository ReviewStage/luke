import { randomBytes } from "node:crypto";
import {
  GITHUB_CONNECT_CLAIM,
  type GitHubConnectClaim,
  type GitHubConnection,
} from "@luke/features/github-connection-wire";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { account } from "../schemas/auth.js";
import { githubConnectIntent } from "../schemas/github-connect-intent.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * github-connection-store.ts -- whether an account has linked its GitHub, and the connect intents that carry a Mac's request to the browser that links it.
 *
 * An intent is minted for the bearer's account and claimed on a browser
 * session, so the one thing this file holds is that a claim answers claimed
 * only for its own account and inside its ten minutes. A claim spends
 * nothing, so the page can claim again after a failed or canceled link, and
 * another account's claim leaves the intent standing for its own; expired
 * intents are swept when the account mints a new one. Every function is an
 * effect over the ambient `SqlClient`.
 */

/** How long a Mac's request to connect GitHub stands before the browser must have claimed it. */
export const GITHUB_CONNECT_INTENT_LIFETIME = Duration.minutes(10);

/** Better Auth's provider id for GitHub on an account row. */
const GITHUB_PROVIDER_ID = "github";

/** An intent's id is a secret the page carries; 32 random bytes is past guessing within its ten minutes. */
const INTENT_ID_BYTES = 32;

const insertIntent = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
    expiresAt: Schema.Date,
  }),
  execute: (intent) =>
    Database.use((db) =>
      db.insert(githubConnectIntent).values({
        id: intent.id,
        userId: intent.userId,
        expiresAt: intent.expiresAt,
        createdAt: intent.now,
      }),
    ),
});

/** The account's intents already past their ten minutes, which a new one sweeps so they do not pile up. */
const deleteExpiredIntents = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(githubConnectIntent)
        .where(
          and(
            eq(githubConnectIntent.userId, key.userId),
            lte(githubConnectIntent.expiresAt, key.now),
          ),
        ),
    ),
});

/** The intent where it still stands, with the account it was minted for. */
const findStandingIntent = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({ userId: githubConnectIntent.userId })
        .from(githubConnectIntent)
        .where(and(eq(githubConnectIntent.id, key.id), gt(githubConnectIntent.expiresAt, key.now))),
    ),
});

/** A GitHub row's tokens, as far as whether they can be used; an expiry reads as either driver answers it (`columns.ts`). */
const GitHubAccountTokensSchema = Schema.Struct({
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
  refreshTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
});

type GitHubAccountTokens = typeof GitHubAccountTokensSchema.Type;

/**
 * The account's newest GitHub row, the one the service's user-token read
 * takes where a user somehow has two (`packages/service/src/github/github-app.ts`'s
 * `lockGithubAccount`), so the connection is judged on the row the service
 * would use.
 */
const findNewestGitHubAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: GitHubAccountTokensSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt,
          refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, GITHUB_PROVIDER_ID)))
        .orderBy(desc(account.updatedAt))
        .limit(1),
    ),
});

/**
 * Whether a GitHub row's tokens can still be used at `now`, on the rule the
 * service's user-token read holds (`tokenOfRow`): an access token, a refresh
 * token, and an expiry, and either the access token still inside its expiry
 * or the refresh token not past its own. A row whose tokens were nulled when
 * the user revoked the GitHub App stands but connects nothing.
 */
function usableAt(row: GitHubAccountTokens, now: Date): boolean {
  if (row.accessToken === null || row.refreshToken === null) return false;
  if (row.accessTokenExpiresAt === null) return false;
  if (row.accessTokenExpiresAt > now) return true;
  return row.refreshTokenExpiresAt === null || row.refreshTokenExpiresAt > now;
}

/** A new connect intent for the account, answering its opaque id; it stands for ten minutes from now. */
export function openGitHubConnectIntent(userId: string): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now;
    const id = randomBytes(INTENT_ID_BYTES).toString("base64url");
    const expiresAt = DateTime.toDate(DateTime.addDuration(now, GITHUB_CONNECT_INTENT_LIFETIME));
    yield* deleteExpiredIntents({ userId, now: DateTime.toDate(now) });
    yield* insertIntent({ id, userId, now: DateTime.toDate(now), expiresAt });
    return id;
  });
}

/**
 * Claims the intent for the account the browser is signed in as: claimed
 * where it is that account's own and still inside its ten minutes, as often
 * as the page asks, so a link that failed or was canceled is tried again from
 * the same address; another account's where it is not; and expired where no
 * such intent stands. Nothing is spent, so the one read decides it.
 */
export function claimGitHubConnectIntent(
  intentId: string,
  userId: string,
): TaskStoreEffect<GitHubConnectClaim> {
  return Effect.gen(function* () {
    const now = DateTime.toDate(yield* DateTime.now);
    const standing = yield* findStandingIntent({ id: intentId, now });
    if (Option.isNone(standing)) return GITHUB_CONNECT_CLAIM.EXPIRED;
    return standing.value.userId === userId
      ? GITHUB_CONNECT_CLAIM.CLAIMED
      : GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT;
  });
}

/**
 * Whether the account has a GitHub account row with a usable token. The row
 * keeps GitHub's numeric id and sealed tokens but not the login, so the login
 * is null: the service holds none to answer with, and no token leaves it to
 * read one.
 */
export function githubConnection(userId: string): TaskStoreEffect<GitHubConnection> {
  return Effect.gen(function* () {
    const now = DateTime.toDate(yield* DateTime.now);
    const row = yield* findNewestGitHubAccount(userId);
    return { connected: Option.exists(row, (tokens) => usableAt(tokens, now)), login: null };
  });
}
