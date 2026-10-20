import type { LiveStatement } from "@luke/database/core/live-statement";
import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { drizzleAdapter } from "@neon/realtime-drizzle";
import { Clock, Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { databaseUrl } from "../db/index.js";

/**
 * realtime.ts -- the deployment's Neon Realtime: the secret a live read is sealed under, and the address the desktop subscribes at.
 *
 * A live read is sealed here, for the account the request's bearer names,
 * as Neon's own guide does it ("Sealing authorized queries"): the statement
 * is built on the server with the account's id in it and its Drizzle select
 * sealed through Neon's Drizzle adapter (`drizzleAdapter()`), which refuses
 * one whose selected key is not the name Postgres answers it under, so the
 * desktop can subscribe to it and can neither read nor change it. The
 * secret never leaves this service. A sealed read is itself a short-lived
 * bearer, so it travels in an answer body alone, never a URL or a log.
 *
 * A deployment without Realtime (a Preview, or local dev) seals by reading
 * instead (`pollSealer`): the statement is run now and its rows answered
 * inline at `LIVE_POLL_URL`, behind the same bearer, and the desktop polls
 * by sealing again.
 */

/** The variables a deployment turns Realtime on with, both from its branch's Realtime page in Neon's console. */
export const REALTIME_ENVIRONMENT = {
  URL: "NEON_REALTIME_URL",
  SECRET: "NEON_REALTIME_SECRET",
} as const;

/** What Vercel names the deployment a function runs in, production being the one that should never poll. */
const VERCEL_DEPLOYMENT = { VARIABLE: "VERCEL_ENV", PRODUCTION: "production" } as const;

/** Why a statement could not be sealed: the secret refused it. */
export class SealRefused extends Data.TaggedError("SealRefused")<{ readonly reason: string }> {}

/** The deployment's Realtime: where the desktop subscribes, and how a statement is sealed for it. */
export interface LiveSealer {
  /** The Realtime socket address the desktop subscribes at, which is no secret. */
  readonly url: string;
  readonly seal: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
}

/**
 * The deployment's Realtime, or its poll sealer where Realtime is not
 * configured, or none where Realtime refused its secret, which every live
 * endpoint answers as unavailable. None by default, so a test that follows
 * nothing live need provide nothing.
 */
export const LiveSealing = Context.Reference<Option.Option<LiveSealer>>(
  "@luke/service/LiveSealing",
  { defaultValue: () => Option.none() },
);

/** The database a connection string names, which Realtime binds each sealed read to. */
export function databaseNameOf(url: Redacted.Redacted): Option.Option<string> {
  try {
    const name = decodeURIComponent(new URL(Redacted.value(url)).pathname.slice(1));
    return name === "" ? Option.none() : Option.some(name);
  } catch {
    return Option.none();
  }
}

/** A sealer over the secret, for the database and address named. */
function liveSealer(options: {
  readonly url: string;
  readonly secret: Redacted.Redacted;
  readonly database: string;
}): Effect.Effect<LiveSealer, SealRefused> {
  return Effect.map(
    Effect.try({
      try: () =>
        createRealtime({
          secret: Redacted.value(options.secret),
          db: options.database,
          adapter: drizzleAdapter(),
        }),
      catch: () => new SealRefused({ reason: "Realtime refused its secret" }),
    }),
    (realtime) => ({
      url: options.url,
      seal: (statement) =>
        Effect.tryPromise({
          try: () =>
            realtime.seal({
              query: statement.query ?? rawSql(statement.sql, statement.params),
            }),
          catch: () => new SealRefused({ reason: "Realtime refused to seal a statement" }),
        }).pipe(
          Effect.map(({ capability, queryFingerprint, expiresAt }) => ({
            capability,
            queryFingerprint,
            expiresAt,
          })),
        ),
    }),
  );
}

/**
 * The sealer where Realtime is not configured: each statement is run on the
 * service's own database client and answered with its rows, already
 * expired, since nothing renews it but a fresh read. Note that no secret
 * stands here, so the capability and fingerprint say only where to poll.
 */
export function pollSealer(sql: SqlClient.SqlClient): LiveSealer {
  return {
    url: LIVE_POLL_URL,
    seal: (statement) =>
      Effect.all({
        rows: sql.unsafe<object>(statement.sql, statement.params),
        now: Clock.currentTimeMillis,
      }).pipe(
        Effect.map(({ rows, now }) => ({
          capability: LIVE_POLL_URL,
          queryFingerprint: LIVE_POLL_URL,
          expiresAt: now,
          rows,
        })),
        Effect.mapError(() => new SealRefused({ reason: "the statement could not be read" })),
      ),
  };
}

/**
 * Realtime as the deployment's environment configures it: on where both of
 * its variables and the database name stand, polled where any is missing or
 * blank (said once in the log as an error in production, which should never
 * poll), so a deployment turns it on by setting them and back to polling by
 * removing them. A secret Realtime refuses leaves it off, said once in the log.
 */
export const liveSealingFromEnvironment = Layer.effect(
  LiveSealing,
  Effect.gen(function* () {
    const read = yield* Config.all({
      url: Config.option(Config.String(REALTIME_ENVIRONMENT.URL)),
      secret: Config.option(Config.Redacted(REALTIME_ENVIRONMENT.SECRET)),
      database: Config.option(databaseUrl),
      deployment: Config.option(Config.String(VERCEL_DEPLOYMENT.VARIABLE)),
    });
    const url = Option.getOrUndefined(read.url)?.trim();
    const secret = Option.getOrUndefined(read.secret);
    const database = Option.flatMap(read.database, databaseNameOf);
    const secretText = secret === undefined ? "" : Redacted.value(secret).trim();
    if (!url || secretText === "" || Option.isNone(database)) {
      if (Option.getOrUndefined(read.deployment)?.trim() === VERCEL_DEPLOYMENT.PRODUCTION) {
        yield* Effect.logError(
          "realtime: production has no Neon Realtime configured; live reads poll instead",
        );
      }
      return Option.some(pollSealer(yield* SqlClient.SqlClient));
    }
    const sealer = yield* Effect.option(
      liveSealer({ url, secret: Redacted.make(secretText), database: database.value }),
    );
    if (Option.isNone(sealer))
      yield* Effect.logWarning("realtime: the secret was refused; live reads answer unavailable");
    return sealer;
  }),
);
