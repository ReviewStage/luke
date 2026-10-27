/**
 * hub.ts -- Luke Sync's hub: one instance's `LISTEN` on the sync channel, and the watches it wakes.
 *
 * Each function instance holds one listener while anyone watches. It is kept
 * in an `RcRef`: the first watch opens it, and it closes `LISTENER.IDLE`
 * after the last watch closes, so back-to-back held reads share one
 * connection rather than reconnecting for each. The watches are kept by
 * topic, kind first and then id (`Watchers`), and a change heard on the
 * channel wakes exactly the watches on its topics, carrying its transaction's
 * id.
 *
 * A connection can die without a word, as one does while Vercel holds an
 * instance paused, so the listener proves its own: every `LISTENER.HEARTBEAT`
 * it notifies the channel through the pool, reading the notification queue's
 * usage in the same round trip, and reconnects where that notification has
 * not come back within the same span. A watch opened on a listener nobody
 * was watching proves it the same way before it answers, so a connection
 * that died while the instance slept is replaced before the read. Losing a
 * connection, and opening its replacement, each wake every watch: the tables
 * are the truth, so a reader that reads again has all of it, and nothing
 * heard while no connection stood needs replaying. While none stands, a
 * watch's `next` waits its fallback, so a wait is never worse than its clock.
 *
 * Metrics carry counts and durations only, never a topic, an id, or a txid.
 */
import { randomUUID } from "node:crypto";
import {
  SyncListener,
  type SyncListenerShape,
  syncListenerOverUrl,
} from "@luke/database/sync/listener";
import {
  SYNC_CHANNEL,
  type SyncChange,
  SyncNotificationSchema,
  type SyncTopic,
  type TopicKind,
} from "@luke/database/sync/notification";
import {
  Clock,
  Config,
  Data,
  Deferred,
  Duration,
  Effect,
  Latch,
  Layer,
  Metric,
  Option,
  RcRef,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { SqlClient } from "effect/sql";
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { databaseUnpooledUrl } from "../db/index.js";
import { CLOCK_SYNC, clockWatch, Sync, type SyncShape, type SyncWatch } from "./watch.js";

/** The deployment's switch for Luke Sync: on only where it reads `on`, off where it is unset or reads anything else. */
const LUKE_SYNC = { OFF: "off", ON: "on" } as const;

const SYNC_ENVIRONMENT = { SWITCH: "LUKE_SYNC" } as const;

/** How the listener is held and proved. */
const LISTENER = {
  /** How long it stays open after its last watch closes. */
  IDLE: Duration.seconds(30),
  /** How often it notifies itself, and how long that notification may take to come back before it reconnects. */
  HEARTBEAT: Duration.seconds(15),
  /** How long a watch on a listener nobody watched waits for its round trip before replacing it. */
  CONFIRM: Duration.seconds(2),
} as const;

/** How long a `next` gathers what arrives once a notification woke it, so a burst of writes wakes a reader once. */
const COALESCE = Duration.millis(100);

/** Opening a listener that would not open again: half a second, doubling, to at most a heartbeat apart. */
const REOPEN = Schedule.min([
  Schedule.exponential(Duration.millis(500)),
  Schedule.spaced(LISTENER.HEARTBEAT),
]);

/** Where the listener stands: opening, or proving the connection it holds; up; or down, with no connection standing. */
const LISTENER_STATE = { OPENING: "opening", UP: "up", DOWN: "down" } as const;

type ListenerState = (typeof LISTENER_STATE)[keyof typeof LISTENER_STATE];

/** Why a standing connection was given up. */
const LOSS = {
  /** Its stream failed or ended, as a closed socket's does. */
  DROPPED: "dropped",
  /** Its heartbeat did not come back. */
  SILENT: "heartbeat missed",
  /** A watch on the idle listener could not prove it. */
  UNCONFIRMED: "unconfirmed after idle",
} as const;

type Loss = (typeof LOSS)[keyof typeof LOSS];

const SYNC_METRIC = {
  NOTIFICATIONS: Metric.counter("luke.sync.notifications", {
    description: "Changes the instance's listener heard on the sync channel",
    incremental: true,
  }),
  WAKES: Metric.counter("luke.sync.wakes", {
    description: "Watches a notification or a reconnect woke",
    incremental: true,
  }),
  FALLBACK_WAKES: Metric.counter("luke.sync.fallback_wakes", {
    description: "Watches on topics that woke on their clock because no listener stood",
    incremental: true,
  }),
  RECONNECTS: Metric.counter("luke.sync.reconnects", {
    description: "Connections the listener stood up after losing one or failing to open",
    incremental: true,
  }),
  DOWN_MILLIS: Metric.counter("luke.sync.listener_down_ms", {
    description: "Milliseconds the listener stood with no connection while a watch held it",
    incremental: true,
  }),
  QUEUE_USAGE: Metric.gauge("luke.sync.queue_usage", {
    description: "The share of Postgres's notification queue in use, as the last heartbeat read it",
  }),
} as const;

/** What a listener whose URL the deployment does not see fails every open with. */
const UNPOOLED_URL_MISSING = new SqlError({
  reason: new ConnectionError({
    cause: new Error("DATABASE_URL_UNPOOLED is not set"),
    message: "Luke Sync has no unpooled URL to listen on",
    operation: "connect",
  }),
});

/** The listener could not open a connection. */
class ListenerUnopened extends Data.TaggedError("ListenerUnopened")<{
  readonly cause: SqlError;
}> {}

/** A connection that stood was given up. */
class ListenerLost extends Data.TaggedError("ListenerLost")<{ readonly loss: Loss }> {}

/** One open watch's place on the hub, between two of its `next`s. */
interface Watcher {
  /** The transactions heard on its topics since its last `next` returned. */
  txids: Set<string>;
  /** Completed by the first wake since then, and replaced as `next` returns. */
  woken: Deferred.Deferred<void>;
}

/** Every open watch on topics: by topic kind, then id, and all of them, for a wake that reaches every one. */
interface Watchers {
  readonly byTopic: Map<TopicKind, Map<string, Set<Watcher>>>;
  readonly all: Set<Watcher>;
}

/** One standing connection's own doors. */
interface Connection {
  /** Notifies the channel through the pool, answering whether this connection heard it within the bound. */
  readonly beat: (within: Duration.Duration) => Effect.Effect<boolean>;
  /** Gives the connection up, so the listener opens another. */
  readonly drop: Effect.Effect<void>;
}

/**
 * The listener the `RcRef` holds, from its first watch until it is let go.
 * `settled` is open whenever the listener is not opening, and is what a
 * watch waits on before it answers: up, the watch hears its topics; down,
 * it waits on its clock. `lost` says that a connection was lost or failed
 * to open since one last stood, so the next one to stand is a reconnect.
 * `idle` says that every watch closed since a connection last proved itself,
 * so the next watch proves it before it answers.
 */
interface Listening {
  state: ListenerState;
  readonly settled: Latch.Latch;
  connection: Connection | undefined;
  lost: boolean;
  idle: boolean;
  /** When the listener went down, as it was last counted, while it is down. */
  downSince: number | undefined;
}

/** What every connection of the instance's listener shares. */
interface Hub {
  readonly listener: SyncListenerShape;
  readonly sql: SqlClient.SqlClient;
  readonly watchers: Watchers;
}

const decodeNotification = Schema.decodeEffect(SyncNotificationSchema);
const encodeNotification = Schema.encodeEffect(SyncNotificationSchema);

/**
 * Wakes the watcher, adding the transaction that woke it where a change did.
 * Note that completing a deferred may run the fiber waiting on it at once,
 * so the callers below wake from a copy of the set they walk.
 */
function wake(watcher: Watcher, txid?: string): void {
  if (txid !== undefined) watcher.txids.add(txid);
  Deferred.doneUnsafe(watcher.woken, Effect.void);
}

function wakeAll(watchers: Watchers): void {
  for (const watcher of [...watchers.all]) wake(watcher);
}

/** Wakes the watches on any of the change's topics, each with the change's transaction. */
function dispatch(watchers: Watchers, change: SyncChange): void {
  for (const [kind, id] of change.t) {
    for (const watcher of [...(watchers.byTopic.get(kind)?.get(id) ?? [])]) wake(watcher, change.x);
  }
}

/** The transactions the watcher heard since its last `next`, with the watcher reset to hear the next ones. */
function taken(watcher: Watcher): readonly string[] {
  const txids = [...watcher.txids];
  watcher.txids = new Set();
  watcher.woken = Deferred.makeUnsafe();
  return txids;
}

function register(watchers: Watchers, watcher: Watcher, topics: readonly SyncTopic[]): void {
  watchers.all.add(watcher);
  for (const [kind, id] of topics) {
    const ofKind = watchers.byTopic.get(kind) ?? new Map<string, Set<Watcher>>();
    watchers.byTopic.set(kind, ofKind.set(id, (ofKind.get(id) ?? new Set()).add(watcher)));
  }
}

function unregister(watchers: Watchers, watcher: Watcher, topics: readonly SyncTopic[]): void {
  watchers.all.delete(watcher);
  for (const [kind, id] of topics) {
    const ofKind = watchers.byTopic.get(kind);
    const ofId = ofKind?.get(id);
    ofId?.delete(watcher);
    if (ofId?.size === 0) ofKind?.delete(id);
    if (ofKind?.size === 0) watchers.byTopic.delete(kind);
  }
}

/** Counts the time the listener has been down since it was last counted, still counting on where it stays down. */
const countDown = (listening: Listening) =>
  Effect.gen(function* () {
    if (listening.downSince === undefined) return;
    const now = yield* Clock.currentTimeMillis;
    yield* Metric.update(SYNC_METRIC.DOWN_MILLIS, now - listening.downSince);
    listening.downSince = listening.state === LISTENER_STATE.UP ? undefined : now;
  });

/**
 * A connection stands: the listener is up, and every watch already open
 * reads again, since what committed before this `LISTEN` reached none of
 * them. Those are the watches open across a lost connection, and any that
 * answered while the first one was still opening.
 */
const stood = (hub: Hub, listening: Listening, connection: Connection) =>
  Effect.gen(function* () {
    const reconnected = listening.lost;
    listening.state = LISTENER_STATE.UP;
    listening.connection = connection;
    listening.lost = false;
    // Note that we wake first, because opening the latch runs the watches it holds at once.
    wakeAll(hub.watchers);
    Latch.openUnsafe(listening.settled);
    yield* countDown(listening);
    if (reconnected) yield* Metric.update(SYNC_METRIC.RECONNECTS, 1);
  });

/** A standing connection was given up: every watch reads again, and waits on its clock until another stands. */
const lost = (hub: Hub, listening: Listening, loss: Loss) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    listening.state = LISTENER_STATE.OPENING;
    listening.connection = undefined;
    listening.lost = true;
    listening.downSince ??= now;
    Latch.closeUnsafe(listening.settled);
    wakeAll(hub.watchers);
    yield* Effect.logWarning(
      `sync: the listener's connection was given up (${loss}); reopening it`,
    );
  });

/** A connection would not open: the listener is down, so a watch answers at once and waits on its clock. */
const unopened = (listening: Listening, error: ListenerUnopened) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const wasDown = listening.state === LISTENER_STATE.DOWN;
    listening.state = LISTENER_STATE.DOWN;
    listening.connection = undefined;
    listening.lost = true;
    listening.downSince ??= now;
    Latch.openUnsafe(listening.settled);
    yield* countDown(listening);
    if (!wasDown)
      yield* Effect.logWarning("sync: the listener could not open; waits run on their clock", {
        reason: error.cause.reason._tag,
      });
  });

/**
 * Notifies the channel with a nonce of its own through the pool, reading the
 * notification queue's usage in the same round trip, and answers whether
 * the connection heard the nonce within the bound. A notification that
 * could not be sent proves nothing, so it answers no.
 */
const beat = (hub: Hub, beats: Map<string, Deferred.Deferred<void>>, within: Duration.Duration) =>
  Effect.suspend(() => {
    const nonce = randomUUID();
    const arrived = Deferred.makeUnsafe<void>();
    beats.set(nonce, arrived);
    return Effect.gen(function* () {
      const payload = yield* encodeNotification({ h: nonce });
      const [standing] = yield* hub.sql<{ readonly usage: number }>`
        select pg_notify(${SYNC_CHANNEL}, ${payload}), pg_notification_queue_usage() as usage
      `;
      if (standing !== undefined) yield* Metric.update(SYNC_METRIC.QUEUE_USAGE, standing.usage);
      yield* Deferred.await(arrived);
    }).pipe(
      Effect.timeoutOption(within),
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
      Effect.ensuring(Effect.sync(() => beats.delete(nonce))),
    );
  });

/** Hands what the connection hears on: a change to the watches on its topics, a nonce to the beat that sent it. Fails once the stream does, or ends. */
const heard = (
  hub: Hub,
  payloads: Stream.Stream<string, SqlError>,
  beats: Map<string, Deferred.Deferred<void>>,
) =>
  Stream.runForEach(payloads, (payload) =>
    decodeNotification(payload).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.logWarning("sync: a notification on the channel did not decode"),
        onSuccess: (notification) =>
          "h" in notification
            ? Effect.sync(() => {
                const arrived = beats.get(notification.h);
                if (arrived !== undefined) Deferred.doneUnsafe(arrived, Effect.void);
              })
            : Effect.andThen(
                Metric.update(SYNC_METRIC.NOTIFICATIONS, 1),
                Effect.sync(() => dispatch(hub.watchers, notification)),
              ),
      }),
    ),
  ).pipe(Effect.ignore, Effect.andThen(Effect.fail(new ListenerLost({ loss: LOSS.DROPPED }))));

/** Proves the connection every heartbeat, giving it up the first time it does not hear itself. */
const heartbeat = (connection: Connection) =>
  Effect.schedule(
    Effect.flatMap(connection.beat(LISTENER.HEARTBEAT), (proved) =>
      proved ? Effect.void : Effect.fail(new ListenerLost({ loss: LOSS.SILENT })),
    ),
    Schedule.spaced(LISTENER.HEARTBEAT),
  );

/**
 * One connection, from its open to its loss: it stands once Postgres has
 * acknowledged the `LISTEN`, and is given up when its stream fails, when its
 * heartbeat does not come back, or when a watch could not prove it.
 */
const connected = (hub: Hub, listening: Listening) =>
  Effect.scoped(
    Effect.gen(function* () {
      const payloads = yield* hub.listener.listen.pipe(
        Effect.mapError((cause) => new ListenerUnopened({ cause })),
      );
      const beats = new Map<string, Deferred.Deferred<void>>();
      const dropped = Deferred.makeUnsafe<void>();
      const connection: Connection = {
        beat: (within) => beat(hub, beats, within),
        drop: Effect.asVoid(Deferred.succeed(dropped, undefined)),
      };
      yield* stood(hub, listening, connection);
      return yield* Effect.raceFirst(
        heard(hub, payloads, beats),
        Effect.raceFirst(
          Effect.andThen(heartbeat(connection), Effect.never),
          Effect.andThen(
            Deferred.await(dropped),
            Effect.fail(new ListenerLost({ loss: LOSS.UNCONFIRMED })),
          ),
        ),
      );
    }),
  );

/**
 * The listener's life while the `RcRef` holds it: a connection, then
 * another once that one is lost, for as long as it is held. A lost
 * connection is reopened at once, and one that will not open is tried again
 * on `REOPEN`, its backoff starting afresh after each connection that stood.
 */
const listened = (hub: Hub, listening: Listening) =>
  connected(hub, listening).pipe(
    Effect.tapError((error) =>
      error._tag === "ListenerUnopened" ? unopened(listening, error) : Effect.void,
    ),
    Effect.retry({ schedule: REOPEN, while: (error) => error._tag === "ListenerUnopened" }),
    Effect.catchTag("ListenerLost", (error) => lost(hub, listening, error.loss)),
    Effect.forever,
  );

/** The listener as the first watch opens it: opening, with its life forked in the `RcRef`'s scope. */
const opened = (hub: Hub) =>
  Effect.gen(function* () {
    const listening: Listening = {
      state: LISTENER_STATE.OPENING,
      settled: Latch.makeUnsafe(false),
      connection: undefined,
      lost: false,
      idle: false,
      downSince: undefined,
    };
    yield* Effect.forkScoped(listened(hub, listening));
    yield* Effect.addFinalizer(() => countDown(listening));
    return listening;
  });

/**
 * Proves the listener a watch found idle with one round trip, replacing the
 * connection where it does not hear itself. The listener reads as opening
 * meanwhile, so a watch opened beside this one waits for it too. A watch
 * given up during the round trip gives the connection up with it, since
 * nothing else would end the opening.
 */
const confirmed = (listening: Listening) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      if (!listening.idle) return;
      listening.idle = false;
      const standing = listening.connection;
      if (listening.state !== LISTENER_STATE.UP || standing === undefined) return;
      listening.state = LISTENER_STATE.OPENING;
      Latch.closeUnsafe(listening.settled);
      const proved = yield* restore(standing.beat(LISTENER.CONFIRM)).pipe(
        Effect.onInterrupt(() => standing.drop),
      );
      if (!proved) return yield* standing.drop;
      // Note that a connection lost meanwhile is the listener's own to settle.
      if (listening.connection !== standing) return;
      listening.state = LISTENER_STATE.UP;
      Latch.openUnsafe(listening.settled);
    }),
  );

/** Waits for a wake, or for the fallback where no connection stands, and answers what woke it. */
const nextOf = (watcher: Watcher, listening: Listening, fallback: Duration.Duration) =>
  Effect.gen(function* () {
    const woken = Effect.as(Deferred.await(watcher.woken), true);
    const notified =
      listening.state === LISTENER_STATE.UP
        ? yield* woken
        : yield* Effect.race(woken, Effect.as(Effect.sleep(fallback), false));
    if (notified) {
      yield* Effect.sleep(COALESCE);
      yield* Metric.update(SYNC_METRIC.WAKES, 1);
    } else yield* Metric.update(SYNC_METRIC.FALLBACK_WAKES, 1);
    return taken(watcher);
  });

/**
 * Opens a watch on the hub: the listener is held for the watch's scope, the
 * watch waits for it to settle, and only then registers, so it answers once
 * the `LISTEN` that will hear its topics is acknowledged, and the caller's
 * first read follows it, as Electric's shape consumer subscribes before it
 * takes its snapshot
 * (https://github.com/electric-sql/electric/blob/3f9809fb0bd894cb74470d434749673492ad7acf/packages/sync-service/lib/electric/shapes/consumer.ex).
 * Note that registering after the listener settled loses nothing: a write
 * the listener heard before then committed before that first read, which
 * reads it. A listener still opening after the watch's own fallback is as
 * good as down, so the watch answers then and waits on its clock, and the
 * connection that stands at last wakes it.
 */
const watchOn =
  (hub: Hub, listener: RcRef.RcRef<Listening>): SyncShape["watch"] =>
  (topics, fallback) =>
    Effect.gen(function* () {
      if (topics.length === 0) return clockWatch(fallback);
      const listening = yield* RcRef.get(listener);
      yield* confirmed(listening);
      yield* Effect.timeoutOption(listening.settled.await, fallback);
      const watcher: Watcher = { txids: new Set(), woken: Deferred.makeUnsafe() };
      yield* Effect.acquireRelease(
        Effect.sync(() => register(hub.watchers, watcher, topics)),
        () =>
          Effect.sync(() => {
            unregister(hub.watchers, watcher, topics);
            if (hub.watchers.all.size === 0) listening.idle = true;
          }),
      );
      return { next: nextOf(watcher, listening, fallback) } satisfies SyncWatch;
    });

/**
 * The instance's hub over the listener and pool it is handed: the listener
 * opened with the first watch on topics and let go `LISTENER.IDLE` after
 * the last, and a watch on no topics on its clock alone.
 */
export const syncHub = Layer.effect(
  Sync,
  Effect.gen(function* () {
    const hub: Hub = {
      listener: yield* SyncListener,
      sql: yield* SqlClient.SqlClient,
      watchers: { byTopic: new Map(), all: new Set() },
    };
    const listener = yield* RcRef.make({ acquire: opened(hub), idleTimeToLive: LISTENER.IDLE });
    return { watch: watchOn(hub, listener) } satisfies SyncShape;
  }),
);

/** The listener on the deployment's unpooled URL, or, where it sees none, one that never opens, so the hub stays down. */
const unpooledListener: Layer.Layer<SyncListener> = Layer.unwrap(
  Effect.map(Effect.orElseSucceed(databaseUnpooledUrl, Option.none), (url) =>
    Option.match(url, {
      onNone: () => Layer.succeed(SyncListener, { listen: Effect.fail(UNPOOLED_URL_MISSING) }),
      onSome: (unpooled) => syncListenerOverUrl({ url: unpooled }),
    }),
  ),
);

/**
 * Luke Sync as the deployment's environment sets it: the hub over the
 * unpooled URL where `LUKE_SYNC` reads `on`, and the clock otherwise, when
 * the unpooled URL is never read and no listener is ever opened.
 */
export const syncFromEnvironment = Layer.unwrap(
  Effect.map(
    Effect.orElseSucceed(Config.option(Config.String(SYNC_ENVIRONMENT.SWITCH)), Option.none),
    (switched) =>
      Option.getOrUndefined(switched)?.trim() === LUKE_SYNC.ON
        ? syncHub.pipe(Layer.provide(unpooledListener))
        : Layer.succeed(Sync, CLOCK_SYNC),
  ),
);
