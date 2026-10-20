import { createHash } from "node:crypto";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { drizzleAdapter } from "@neon/realtime-drizzle";
import { Clock, Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import type { SqlClient } from "effect/sql";
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
 */

/** The variables a deployment turns Realtime on with, both from its branch's Realtime page in Neon's console. */
export const REALTIME_ENVIRONMENT = {
  URL: "NEON_REALTIME_URL",
  SECRET: "NEON_REALTIME_SECRET",
  /** Luke's own switch: Realtime is used only where this reads `on`, so a deployment keeps Neon's variables while it is off. */
  SWITCH: "LUKE_REALTIME",
} as const;

/** The value of `LUKE_REALTIME` that turns Realtime on; anything else, or none, leaves it off. */
const REALTIME_ON = "on";

/** Why a statement could not be sealed: the secret refused it. */
export class SealRefused extends Data.TaggedError("SealRefused")<{ readonly reason: string }> {}

/** The deployment's Realtime: where the desktop subscribes, and how a statement is sealed for it. */
export interface LiveSealer {
  /** The Realtime socket address the desktop subscribes at, which is no secret. */
  readonly url: string;
  readonly seal: (statement: LiveStatement) => Effect.Effect<SealedLiveQueryWire, SealRefused>;
}

/**
 * The deployment's Realtime, or none where it is misconfigured, which every
 * live endpoint answers as unavailable. None by default, so a test that
 * follows nothing live need provide nothing.
 */
export const LiveSealing = Context.Reference<Option.Option<LiveSealer>>(
  "@luke/service/LiveSealing",
  { defaultValue: () => Option.none() },
);

/**
 * The sealer that reads rather than seals: each statement run now on the
 * service's own database client and answered with its rows, already
 * expired, at `LIVE_POLL_URL`. It is what a reader polling while Realtime
 * fails it is answered with, and what a read is answered with where
 * Realtime could not seal it. No secret stands here, so the capability and
 * fingerprint say only where to poll.
 */
/** How many characters of a polled statement's digest it carries: far more than two readings of its rows could share by chance. */
const DIGEST_CHARS = 32;

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
          digest: createHash("sha256")
            .update(JSON.stringify(rows))
            .digest("hex")
            .slice(0, DIGEST_CHARS),
        })),
        Effect.mapError(() => new SealRefused({ reason: "the statement could not be read" })),
      ),
  };
}

/** The database a connection string names, which Realtime binds each sealed read to. */
function databaseNameOf(url: Redacted.Redacted): Option.Option<string> {
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
 * Realtime as the deployment's environment configures it: on only where
 * `LUKE_REALTIME` is `on` and both of Neon's variables and the database name
 * stand, off otherwise, when every live read is answered polled. So a
 * deployment keeps Neon's variables and turns Realtime on or off with the
 * switch alone. A secret Realtime refuses leaves it off, said once in the log.
 */
export const liveSealingFromEnvironment = Layer.effect(
  LiveSealing,
  Effect.gen(function* () {
    const read = yield* Config.all({
      switch: Config.option(Config.String(REALTIME_ENVIRONMENT.SWITCH)),
      url: Config.option(Config.String(REALTIME_ENVIRONMENT.URL)),
      secret: Config.option(Config.Redacted(REALTIME_ENVIRONMENT.SECRET)),
      database: Config.option(databaseUrl),
    });
    // Off by choice: every live read is answered polled, said nowhere, since nothing is wrong.
    if (Option.getOrUndefined(read.switch)?.trim() !== REALTIME_ON) return Option.none();
    const url = Option.getOrUndefined(read.url)?.trim();
    const secret = Option.getOrUndefined(read.secret);
    const database = Option.flatMap(read.database, databaseNameOf);
    const secretText = secret === undefined ? "" : Redacted.value(secret).trim();
    if (!url || secretText === "" || Option.isNone(database)) return Option.none();
    const sealer = yield* Effect.option(
      liveSealer({ url, secret: Redacted.make(secretText), database: database.value }),
    );
    if (Option.isNone(sealer))
      yield* Effect.logWarning("realtime: the secret was refused; live reads answer unavailable");
    return sealer;
  }),
);
