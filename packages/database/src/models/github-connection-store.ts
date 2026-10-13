import { randomBytes } from "node:crypto";
import {
  GITHUB_CONNECT_CLAIM,
  type GitHubConnectClaim,
  type GitHubConnection,
} from "@sidecar/hosted/github-connection-wire";
import { and, eq, gt, lte } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";
import { db } from "../core/query.js";
import { account } from "../schemas/auth.js";
import { githubConnectIntent } from "../schemas/github-connect-intent.js";
import type { PlanStoreEffect } from "./plan-store.js";

/**
 * github-connection-store.ts -- whether an account has linked its GitHub, and the connect intents that carry a Mac's request to the browser that links it.
 *
 * An intent is minted for the bearer's account and claimed on a browser
 * session, so the one thing this file holds is that a claim spends the
 * intent only for its own account, once, and inside its ten minutes: the
 * claim is a single `delete ... returning` keyed on all three, so two
 * claims racing cannot both spend it, and a claim from another account's
 * session leaves it standing for its own. Every function is an effect over
 * the ambient `SqlClient`.
 */

/** How long a Mac's request to connect GitHub stands before the browser must have claimed it. */
export const GITHUB_CONNECT_INTENT_LIFETIME = Duration.minutes(10);

/** Better Auth's provider id for GitHub on an account row. */
const GITHUB_PROVIDER_ID = "github";

/** An intent's id is a secret the page carries; 32 random bytes is past guessing within its ten minutes. */
const INTENT_ID_BYTES = 32;

const IntentKeySchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  now: Schema.Date,
});

const insertIntent = SqlSchema.void({
  Request: Schema.Struct({
    id: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
    expiresAt: Schema.Date,
  }),
  execute: (intent) =>
    db.insert(githubConnectIntent).values({
      id: intent.id,
      userId: intent.userId,
      expiresAt: intent.expiresAt,
      createdAt: intent.now,
    }),
});

/** The account's intents already past their ten minutes, which a new one sweeps so they do not pile up. */
const deleteExpiredIntents = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: (key) =>
    db
      .delete(githubConnectIntent)
      .where(
        and(
          eq(githubConnectIntent.userId, key.userId),
          lte(githubConnectIntent.expiresAt, key.now),
        ),
      ),
});

const spendIntent = SqlSchema.findOneOption({
  Request: IntentKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    db
      .delete(githubConnectIntent)
      .where(
        and(
          eq(githubConnectIntent.id, key.id),
          eq(githubConnectIntent.userId, key.userId),
          gt(githubConnectIntent.expiresAt, key.now),
        ),
      )
      .returning({ id: githubConnectIntent.id }),
});

const findStandingIntent = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (key) =>
    db
      .select({ id: githubConnectIntent.id })
      .from(githubConnectIntent)
      .where(and(eq(githubConnectIntent.id, key.id), gt(githubConnectIntent.expiresAt, key.now))),
});

const findGitHubAccount = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ id: Schema.String }),
  execute: (userId) =>
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, GITHUB_PROVIDER_ID)))
      .limit(1),
});

/** A new connect intent for the account, answering its opaque id; it stands for ten minutes from now. */
export function openGitHubConnectIntent(userId: string): PlanStoreEffect<string> {
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
 * Claims the intent for the account the browser is signed in as: spent where
 * it is that account's own and still inside its ten minutes; left standing
 * where it is another account's; and expired where no such intent stands.
 */
export function claimGitHubConnectIntent(
  intentId: string,
  userId: string,
): PlanStoreEffect<GitHubConnectClaim> {
  return Effect.gen(function* () {
    const now = DateTime.toDate(yield* DateTime.now);
    const spent = yield* spendIntent({ id: intentId, userId, now });
    if (Option.isSome(spent)) return GITHUB_CONNECT_CLAIM.CLAIMED;
    const standing = yield* findStandingIntent({ id: intentId, now });
    return Option.isSome(standing)
      ? GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT
      : GITHUB_CONNECT_CLAIM.EXPIRED;
  });
}

/**
 * Whether the account has a GitHub account row. The row keeps GitHub's
 * numeric id and sealed tokens but not the login, so the login is null: the
 * service holds none to answer with, and no token leaves it to read one.
 */
export function githubConnection(userId: string): PlanStoreEffect<GitHubConnection> {
  return Effect.map(findGitHubAccount(userId), (row) => ({
    connected: Option.isSome(row),
    login: null,
  }));
}
