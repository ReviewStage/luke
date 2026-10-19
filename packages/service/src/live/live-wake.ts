import type { LiveStatement } from "@luke/database/core/live-statement";
import { createRealtime, type RawSqlQuery, rawSql } from "@neon/realtime/server";
import { Config, Context, Duration, Effect, Layer, Option, Redacted, type Scope } from "effect";
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
 * Where Realtime is not configured, every watch wakes on a short clock
 * instead, so a held read polls.
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

/** How often a wait looks where Realtime is not configured: each hold's own look, about once a second. */
const LIVE_WAKE_POLL = Duration.seconds(1);

/**
 * The wake where Realtime is not configured (a Preview, or local dev): every
 * watch says the rows changed once a second, so a held read polls its own
 * statement rather than hearing nothing.
 */
const pollingWake: LiveWakeShape = {
  watch: () => Effect.succeed({ changed: Effect.sleep(LIVE_WAKE_POLL) }),
};

/**
 * The wake a held read waits on: Realtime, where the web runtime provides
 * `liveWakeFromEnvironment` and the deployment configures it, and a scripted
 * one in a test. With none provided, every watch polls.
 */
export const LiveWake = Context.Reference<LiveWakeShape>("@luke/service/LiveWake", {
  defaultValue: () => pollingWake,
});

/** One statement's subscription, the slice of Realtime's raw subscription a watch reads. */
interface LiveSubscription {
  onUpdate(listener: () => void): () => void;
  onStateChange(listener: (state: { readonly status: string }) => void): () => void;
  getState(): { readonly status: string };
  unsubscribe(): void;
}

/** The subscription calls a watch makes, the slice of Realtime's direct server it uses. */
export interface LiveSubscriber {
  subscribe(
    query: RawSqlQuery<unknown>,
    options: { readonly materialize: false },
  ): Promise<LiveSubscription>;
  close(): void;
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
 * The direct server every watch subscribes on, replaced once its connection
 * failed: Neon's docs say a client whose connection failed cannot reconnect,
 * so a new one is made before subscribing again. `failed` is the server a
 * watch saw fail, so the first watch to see it replaces it and the rest
 * subscribe on the replacement.
 */
export interface StandingServer {
  readonly current: () => LiveSubscriber;
  readonly replace: (failed: LiveSubscriber) => LiveSubscriber;
  readonly close: () => void;
}

function standingServer(open: () => LiveSubscriber): StandingServer {
  let server = open();
  return {
    current: () => server,
    replace: (failed) => {
      if (server !== failed) return server;
      failed.close();
      server = open();
      return server;
    },
    close: () => server.close(),
  };
}

/**
 * One statement followed for a watch, as Neon's docs say a long-running
 * worker follows one: an error is final, so the watch watches for it with
 * `onStateChange` and subscribes again, and wakes the read, which may have
 * missed a change while the subscription stood in error. A subscription
 * that is in error the moment it is made is one on a connection that
 * failed, so it is made again on a new server. Answers the way to let go
 * once the first subscription stands; refused where the first is.
 */
async function followed(
  servers: StandingServer,
  statement: LiveStatement,
  fire: () => void,
): Promise<() => void> {
  let stopped = false;
  let current: LiveSubscription | undefined;
  const subscribe = async (on: LiveSubscriber, mayReplace: boolean): Promise<void> => {
    const subscription = await on.subscribe(rawSql(statement.sql, statement.params), {
      materialize: false,
    });
    if (stopped) {
      subscription.unsubscribe();
      return;
    }
    if (subscription.getState().status === "error") {
      subscription.unsubscribe();
      if (mayReplace) await subscribe(servers.replace(on), false);
      return;
    }
    current = subscription;
    subscription.onUpdate(fire);
    subscription.onStateChange((state) => {
      if (state.status !== "error" || current !== subscription) return;
      current = undefined;
      subscription.unsubscribe();
      fire();
      void subscribe(servers.current(), true).catch(() => undefined);
    });
  };
  await subscribe(servers.current(), true);
  return () => {
    stopped = true;
    current?.unsubscribe();
    current = undefined;
  };
}

/**
 * The wake over a Realtime direct server: each watch subscribes to its
 * statements as raw updates, and every update of any of them is a change.
 * Note that the first update of each is its whole result, which reads as a
 * change too, so a change that landed between the subscription and the
 * read's first look is looked for once more rather than missed. A
 * subscription that moves to `error` is made again (`followed`); one
 * refused outright, or one that could not be made again, leaves the read on
 * its safety beat (`LIVE_SAFETY_POLL` in `http/held-read.ts`), which is
 * the backstop for every way a watch can go quiet, so that beat stays.
 */
export function realtimeWake(servers: StandingServer): LiveWakeShape {
  return {
    watch: (statements) =>
      Effect.gen(function* () {
        if (statements.length === 0) return QUIET;
        const signal = changeSignal();
        const subscribed = yield* Effect.forEach(statements, (statement) =>
          Effect.acquireRelease(
            Effect.tryPromise(() => followed(servers, statement, signal.fire)),
            (letGo) => Effect.sync(letGo),
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

/** The servers a wake subscribes on, each one `open` makes, the standing one closed with the scope. */
export const realtimeServers = (
  open: () => LiveSubscriber,
): Effect.Effect<StandingServer, unknown, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try(() => standingServer(open)),
    (servers) => Effect.sync(() => servers.close()),
  );

/**
 * The wake as the deployment's environment configures it: Realtime, over one
 * direct server and one socket the instance's every held read shares, closed
 * with the runtime and replaced where its connection failed. Where a variable or the database name is missing, or
 * Realtime refuses its configuration, every watch polls instead, said once in
 * the log where Realtime refused.
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
    if (!url || secret === undefined || Option.isNone(database)) return pollingWake;
    const servers = yield* realtimeServers(() =>
      createRealtime({ url, secret: Redacted.value(secret).trim(), db: database.value }),
    ).pipe(Effect.option);
    if (Option.isNone(servers)) {
      yield* Effect.logError("live-wake: Realtime refused its configuration; held reads poll");
      return pollingWake;
    }
    return realtimeWake(servers.value);
  }),
);
