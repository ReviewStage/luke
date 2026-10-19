import type { LiveStatement } from "@luke/database/core/live-statement";
import { createRealtime, type RawSqlQuery, rawSql } from "@neon/realtime/server";
import { Config, Context, Effect, Layer, Option, Redacted, type Scope } from "effect";
import { databaseUrl } from "../db/index.js";
import { databaseNameOf, REALTIME_ENVIRONMENT } from "./realtime.js";

/**
 * live-wake.ts -- what a held read, or any wait of the service's on a row, waits on between its looks: a Neon Realtime subscription to its own statements.
 *
 * Realtime never answers a read. It only says that the rows a held read's
 * statements cover changed, and the read then looks again with its own
 * statement, so what the desktop is answered is what the store says and
 * nothing the subscription carried. A watch that misses a change, or one
 * Realtime refused or stopped, costs the read a look on its safety beat.
 */

/** What a held read waits on, for the length of one hold. */
export interface LiveWatch {
  /** Completes at the first change since it last completed; never while nothing changes. */
  readonly changed: Effect.Effect<void>;
}

export interface LiveWakeShape {
  /** A watch on the statements, for as long as the scope stands. */
  readonly watch: (
    statements: readonly LiveStatement[],
  ) => Effect.Effect<LiveWatch, never, Scope.Scope>;
}

/** The watch that hears nothing: a wait on no statements, or one Realtime refused, looks on its safety beat alone. */
const QUIET: LiveWatch = { changed: Effect.never };

/** The wake where Realtime is not configured, which refuses every watch loudly rather than looking on a clock. */
const UNCONFIGURED: LiveWakeShape = {
  watch: () => Effect.die(new Error("live-wake: Neon Realtime is not configured")),
};

/**
 * The wake a held read waits on: Realtime, where the web runtime provides
 * `liveWakeFromEnvironment`, and a scripted one in a test. With none
 * provided, every watch dies, so a missing wake is heard rather than
 * polled around.
 */
export const LiveWake = Context.Reference<LiveWakeShape>("@luke/service/LiveWake", {
  defaultValue: () => UNCONFIGURED,
});

/** The subscription calls a watch makes, the slice of Realtime's direct server it uses. */
export interface LiveSubscriber {
  subscribe(
    query: RawSqlQuery<unknown>,
    options: { readonly materialize: false },
  ): Promise<{
    onUpdate(listener: () => void): () => void;
    unsubscribe(): void;
  }>;
}

/**
 * Where one watch stands, as Realtime's listeners reach it: whether a change
 * landed that no wait has taken yet, and the one wait parked on it, if any.
 * Plain state rather than an Effect primitive, because a listener runs on
 * Realtime's own callbacks, outside any fiber.
 */
function changeSignal() {
  let pending = false;
  let waiter: (() => void) | undefined;
  return {
    fire: () => {
      const parked = waiter;
      waiter = undefined;
      if (parked === undefined) pending = true;
      else parked();
    },
    watch: {
      changed: Effect.callback<void>((resume) => {
        if (pending) {
          pending = false;
          resume(Effect.void);
          return;
        }
        waiter = () => resume(Effect.void);
        return Effect.sync(() => {
          waiter = undefined;
        });
      }),
    } satisfies LiveWatch,
  };
}

/**
 * The wake over a Realtime direct server: each watch subscribes to its
 * statements as raw updates, and every update of any of them is a change.
 * Note that the first update of each is its whole result, which reads as a
 * change too, so a change that landed between the subscription and the
 * read's first look is looked for once more rather than missed. A
 * subscription refused outright leaves the read on its safety beat.
 */
export function realtimeWake(subscriber: LiveSubscriber): LiveWakeShape {
  return {
    watch: (statements) =>
      Effect.gen(function* () {
        if (statements.length === 0) return QUIET;
        const signal = changeSignal();
        const subscribed = yield* Effect.forEach(statements, (statement) =>
          Effect.acquireRelease(
            Effect.tryPromise(() =>
              subscriber.subscribe(rawSql(statement.sql, statement.params), {
                materialize: false,
              }),
            ),
            (subscription) => Effect.sync(() => subscription.unsubscribe()),
          ).pipe(
            Effect.tap((subscription) => Effect.sync(() => subscription.onUpdate(signal.fire))),
          ),
        ).pipe(Effect.option);
        if (Option.isNone(subscribed)) {
          yield* Effect.logWarning("live-wake: a watch was refused; the read looks on its beat");
          return QUIET;
        }
        return signal.watch;
      }),
  };
}

/**
 * The wake as the deployment's environment configures it: Realtime, over one
 * direct server and one socket the instance's every held read shares, closed
 * with the runtime. Where a variable or the database name is missing, or
 * Realtime refuses its configuration, it is said in the log and every watch
 * dies, since a held read has nothing else to wait on.
 */
export const liveWakeFromEnvironment = Layer.effect(
  LiveWake,
  Effect.gen(function* () {
    const read = yield* Config.all({
      url: Config.option(Config.String(REALTIME_ENVIRONMENT.URL)),
      secret: Config.option(Config.Redacted(REALTIME_ENVIRONMENT.SECRET)),
      database: Config.option(databaseUrl),
    });
    const url = Option.getOrUndefined(read.url)?.trim();
    const secret = Option.getOrUndefined(read.secret);
    const database = Option.flatMap(read.database, databaseNameOf);
    if (!url || secret === undefined || Option.isNone(database)) {
      yield* Effect.logError("live-wake: Neon Realtime is not configured; held reads fail");
      return UNCONFIGURED;
    }
    const server = yield* Effect.acquireRelease(
      Effect.try(() =>
        createRealtime({ url, secret: Redacted.value(secret).trim(), db: database.value }),
      ),
      (standing) => Effect.sync(() => standing.close()),
    ).pipe(Effect.option);
    if (Option.isNone(server)) {
      yield* Effect.logError("live-wake: Realtime refused its configuration; held reads fail");
      return UNCONFIGURED;
    }
    return realtimeWake(server.value);
  }),
);
