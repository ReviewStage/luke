import type { LiveStatement } from "@luke/database/core/live-statement";
import { createRealtime, type RawSqlQuery, rawSql } from "@neon/realtime/server";
import { Config, Context, Effect, Layer, Option, Redacted, type Scope } from "effect";
import { databaseUrl } from "../db/index.js";
import { databaseNameOf, REALTIME_ENVIRONMENT } from "./realtime.js";

/**
 * live-wake.ts -- what a held read, or any wait of the service's on a row, waits on between its looks: a Neon Realtime subscription to its own statements where the deployment has one, its own poll where it has none.
 *
 * Realtime never answers a read. It only says that the rows a held read's
 * statements cover changed, and the read then looks again with its own
 * statement, so what the desktop is answered is what the store says and
 * nothing the subscription carried. A watch that misses a change costs the
 * read a look on its safety beat; a watch that breaks hands the read back to
 * its own poll for the rest of the hold.
 */

/** What a held read waits on, for the length of one hold. */
export interface LiveWatch {
  /** Whether the statements are watched now: false where nothing watches them, or once the watch broke. */
  readonly live: Effect.Effect<boolean>;
  /** Completes at the first change since it last completed, or as the watch breaks; never while nothing changes. */
  readonly changed: Effect.Effect<void>;
}

export interface LiveWakeShape {
  /** A watch on the statements, for as long as the scope stands. */
  readonly watch: (
    statements: readonly LiveStatement[],
  ) => Effect.Effect<LiveWatch, never, Scope.Scope>;
}

/** The watch where nothing watches: a read looks on its own poll. */
export const UNWATCHED: LiveWatch = { live: Effect.succeed(false), changed: Effect.never };

/** The wake that watches nothing, which a deployment without Realtime, and every test, runs on. */
const POLLING: LiveWakeShape = { watch: () => Effect.succeed(UNWATCHED) };

/**
 * The wake a held read waits on: polling by default, so a deployment or a
 * test that provides none behaves as before, and Realtime where the web
 * runtime provides `liveWakeFromEnvironment`.
 */
export const LiveWake = Context.Reference<LiveWakeShape>("@luke/service/LiveWake", {
  defaultValue: () => POLLING,
});

/** The subscription calls a watch makes, the slice of Realtime's direct server it uses. */
export interface LiveSubscriber {
  subscribe(
    query: RawSqlQuery<unknown>,
    options: { readonly materialize: false },
  ): Promise<{
    onUpdate(listener: () => void): () => void;
    onStateChange(listener: (state: { readonly status: string }) => void): () => void;
    unsubscribe(): void;
  }>;
}

/**
 * Where one watch stands, as Realtime's listeners reach it: whether a change
 * landed that no wait has taken yet, whether the watch broke, and the one
 * wait parked on it, if any. Plain state rather than an Effect primitive,
 * because a listener runs on Realtime's own callbacks, outside any fiber.
 */
function changeSignal() {
  let pending = false;
  let broken = false;
  let waiter: (() => void) | undefined;
  const wake = () => {
    const parked = waiter;
    waiter = undefined;
    if (parked === undefined) pending = true;
    else parked();
  };
  return {
    fire: wake,
    break: () => {
      broken = true;
      wake();
    },
    watch: {
      live: Effect.sync(() => !broken),
      changed: Effect.callback<void>((resume) => {
        if (pending || broken) {
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
 * statements as raw updates, every update of any of them is a change, and
 * a subscription that errors breaks the watch. Note that the first update
 * of each is its whole result, which reads as a change too, so a change that
 * landed between the subscription and the read's first look is looked for
 * once more rather than missed. A subscription refused outright leaves the
 * read on its own poll.
 */
export function realtimeWake(subscriber: LiveSubscriber): LiveWakeShape {
  return {
    watch: (statements) =>
      Effect.gen(function* () {
        if (statements.length === 0) return UNWATCHED;
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
            Effect.tap((subscription) =>
              Effect.sync(() => {
                subscription.onUpdate(signal.fire);
                subscription.onStateChange((state) => {
                  if (state.status === "error") signal.break();
                });
              }),
            ),
          ),
        ).pipe(Effect.option);
        if (Option.isNone(subscribed)) {
          yield* Effect.logWarning("live-wake: a watch was refused; the read polls");
          return UNWATCHED;
        }
        return signal.watch;
      }),
  };
}

/**
 * The wake as the deployment's environment configures it: Realtime, over one
 * direct server and one socket the instance's every held read shares, closed
 * with the runtime, where both Realtime variables and the database name
 * stand; polling where any is missing, so a deployment turns Realtime on by
 * setting its variables and off by removing them.
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
    if (!url || secret === undefined || Option.isNone(database)) return POLLING;
    const server = yield* Effect.acquireRelease(
      Effect.try(() =>
        createRealtime({ url, secret: Redacted.value(secret).trim(), db: database.value }),
      ),
      (standing) => Effect.sync(() => standing.close()),
    ).pipe(Effect.option);
    if (Option.isNone(server)) {
      yield* Effect.logWarning("live-wake: Realtime refused its configuration; reads poll");
      return POLLING;
    }
    return realtimeWake(server.value);
  }),
);
