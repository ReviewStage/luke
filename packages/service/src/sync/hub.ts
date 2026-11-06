import { randomUUID } from "node:crypto";
import {
  SyncListener,
  type SyncListenerShape,
  type SyncListening,
  syncListenerOverUrl,
} from "@repo/database/sync/listener";
import {
  type SyncChange,
  SyncNotificationSchema,
  type SyncTopic,
  type TopicKind,
} from "@repo/database/sync/notification";
import {
  Clock,
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
import { ConnectionError, SqlError } from "effect/sql/SqlError";
import { databaseUnpooledUrl } from "../db/index.js";
import { clockWatch, Sync, type SyncShape, type SyncWatch } from "./watch.js";

const LISTENER = {
  IDLE: Duration.seconds(30),
  HEARTBEAT: Duration.seconds(15),
  CONFIRM: Duration.seconds(2),
  REAPED: Duration.seconds(45),
} as const;

const COALESCE = Duration.millis(100);

const REOPEN = Schedule.min([
  Schedule.exponential(Duration.millis(500)),
  Schedule.spaced(LISTENER.HEARTBEAT),
]);

const LISTENER_STATE = { OPENING: "opening", UP: "up", DOWN: "down" } as const;

type ListenerState = (typeof LISTENER_STATE)[keyof typeof LISTENER_STATE];

const LOSS = {
  DROPPED: "dropped",
  SILENT: "heartbeat missed",
  UNCONFIRMED: "unconfirmed after idle",
} as const;

type Loss = (typeof LOSS)[keyof typeof LOSS];

const SYNC_METRIC = {
  NOTIFICATIONS: Metric.counter("app.sync.notifications", {
    description: "Changes the instance's listener heard on the sync channel",
    incremental: true,
  }),
  WAKES: Metric.counter("app.sync.wakes", {
    description: "Watches a notification or a reconnect woke",
    incremental: true,
  }),
  FALLBACK_WAKES: Metric.counter("app.sync.fallback_wakes", {
    description: "Watches on topics that woke on their clock because no listener stood",
    incremental: true,
  }),
  RECONNECTS: Metric.counter("app.sync.reconnects", {
    description: "Connections the listener stood up after losing one or failing to open",
    incremental: true,
  }),
  DOWN_MILLIS: Metric.counter("app.sync.listener_down_ms", {
    description: "Milliseconds the listener stood with no connection while a watch held it",
    incremental: true,
  }),
  QUEUE_USAGE: Metric.gauge("app.sync.queue_usage", {
    description: "The share of Postgres's notification queue in use, as the last heartbeat read it",
  }),
} as const;

const UNPOOLED_URL_MISSING = new SqlError({
  reason: new ConnectionError({
    cause: new Error("DATABASE_URL_UNPOOLED is not set"),
    message: "Sync has no unpooled URL to listen on",
    operation: "connect",
  }),
});

class ListenerUnopened extends Data.TaggedError("ListenerUnopened")<{
  readonly cause: SqlError;
}> {}

class ListenerLost extends Data.TaggedError("ListenerLost")<{ readonly loss: Loss }> {}

interface Watcher {
  txids: Set<string>;
  woken: Deferred.Deferred<void>;
  heardAt: number | undefined;
  answeredHeardAt: number | undefined;
}

interface Watchers {
  readonly byTopic: Map<TopicKind, Map<string, Set<Watcher>>>;
  readonly all: Set<Watcher>;
}

interface Connection {
  readonly beat: (within: Duration.Duration) => Effect.Effect<boolean>;
  readonly drop: Effect.Effect<void>;
}

interface Listening {
  state: ListenerState;
  readonly settled: Latch.Latch;
  connection: Connection | undefined;
  lost: boolean;
  idle: boolean;
  downSince: number | undefined;
}

interface Hub {
  readonly listener: SyncListenerShape;
  readonly watchers: Watchers;
}

const decodeNotification = Schema.decodeEffect(SyncNotificationSchema);
const encodeNotification = Schema.encodeEffect(SyncNotificationSchema);

function wake(watcher: Watcher, heard?: { readonly txid: string; readonly at: number }): void {
  if (heard !== undefined) {
    watcher.txids.add(heard.txid);
    watcher.heardAt ??= heard.at;
  }
  Deferred.doneUnsafe(watcher.woken, Effect.void);
}

function wakeAll(watchers: Watchers): void {
  for (const watcher of [...watchers.all]) wake(watcher);
}

function dispatch(watchers: Watchers, change: SyncChange, at: number): void {
  for (const [kind, id] of change.t) {
    for (const watcher of [...(watchers.byTopic.get(kind)?.get(id) ?? [])]) {
      wake(watcher, { txid: change.x, at });
    }
  }
}

function taken(watcher: Watcher): readonly string[] {
  const txids = [...watcher.txids];
  watcher.txids = new Set();
  watcher.woken = Deferred.makeUnsafe();
  watcher.answeredHeardAt = watcher.heardAt;
  watcher.heardAt = undefined;
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

const countDown = (listening: Listening) =>
  Effect.gen(function* () {
    if (listening.downSince === undefined) return;
    const now = yield* Clock.currentTimeMillis;
    yield* Metric.update(SYNC_METRIC.DOWN_MILLIS, now - listening.downSince);
    listening.downSince = listening.state === LISTENER_STATE.UP ? undefined : now;
  });

const stood = (hub: Hub, listening: Listening, connection: Connection) =>
  Effect.gen(function* () {
    const reconnected = listening.lost;
    listening.state = LISTENER_STATE.UP;
    listening.connection = connection;
    listening.lost = false;
    wakeAll(hub.watchers);
    Latch.openUnsafe(listening.settled);
    yield* countDown(listening);
    if (reconnected) yield* Metric.update(SYNC_METRIC.RECONNECTS, 1);
  });

const lost = (hub: Hub, listening: Listening, loss: Loss) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const watched = hub.watchers.all.size > 0;
    listening.state = LISTENER_STATE.OPENING;
    listening.connection = undefined;
    listening.lost = true;
    if (watched) listening.downSince ??= now;
    Latch.closeUnsafe(listening.settled);
    wakeAll(hub.watchers);
    const message = `sync: the listener's connection was given up (${loss}); reopening it`;
    yield* watched ? Effect.logWarning(message) : Effect.logDebug(message);
  });

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

const beat = (
  listening: SyncListening,
  beats: Map<string, Deferred.Deferred<void>>,
  within: Duration.Duration,
) =>
  Effect.suspend(() => {
    const nonce = randomUUID();
    const arrived = Deferred.makeUnsafe<void>();
    beats.set(nonce, arrived);
    return Effect.gen(function* () {
      const usage = yield* listening.notify(yield* encodeNotification({ h: nonce }));
      yield* Metric.update(SYNC_METRIC.QUEUE_USAGE, usage);
      yield* Deferred.await(arrived);
    }).pipe(
      Effect.timeoutOption(within),
      Effect.map(Option.isSome),
      Effect.orElseSucceed(() => false),
      Effect.ensuring(Effect.sync(() => beats.delete(nonce))),
    );
  });

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
                Effect.flatMap(Clock.currentTimeMillis, (at) =>
                  Effect.sync(() => dispatch(hub.watchers, notification, at)),
                ),
              ),
      }),
    ),
  ).pipe(Effect.ignore, Effect.andThen(Effect.fail(new ListenerLost({ loss: LOSS.DROPPED }))));

const heartbeat = (connection: Connection) =>
  Effect.schedule(
    Effect.flatMap(connection.beat(LISTENER.HEARTBEAT), (proved) =>
      proved ? Effect.void : Effect.fail(new ListenerLost({ loss: LOSS.SILENT })),
    ),
    Schedule.spaced(LISTENER.HEARTBEAT),
  );

const connected = (hub: Hub, listening: Listening) =>
  Effect.scoped(
    Effect.gen(function* () {
      const channel = yield* hub.listener.listen.pipe(
        Effect.mapError((cause) => new ListenerUnopened({ cause })),
      );
      const beats = new Map<string, Deferred.Deferred<void>>();
      const dropped = Deferred.makeUnsafe<void>();
      const connection: Connection = {
        beat: (within) => beat(channel, beats, within),
        drop: Effect.asVoid(Deferred.succeed(dropped, undefined)),
      };
      yield* stood(hub, listening, connection);
      return yield* Effect.raceFirst(
        heard(hub, channel.payloads, beats),
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

const listened = (hub: Hub, listening: Listening) =>
  connected(hub, listening).pipe(
    Effect.tapError((error) =>
      error._tag === "ListenerUnopened" ? unopened(listening, error) : Effect.void,
    ),
    Effect.retry({ schedule: REOPEN, while: (error) => error._tag === "ListenerUnopened" }),
    Effect.catchTag("ListenerLost", (error) => lost(hub, listening, error.loss)),
    Effect.forever,
  );

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
      if (listening.connection !== standing) return;
      listening.state = LISTENER_STATE.UP;
      Latch.openUnsafe(listening.settled);
    }),
  );

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

const watchOn =
  (hub: Hub, listener: RcRef.RcRef<Listening>): SyncShape["watch"] =>
  (topics, fallback) =>
    Effect.gen(function* () {
      if (topics.length === 0) return clockWatch(fallback);
      const listening = yield* RcRef.get(listener);
      yield* confirmed(listening);
      yield* Effect.timeoutOption(listening.settled.await, fallback);
      const watcher: Watcher = {
        txids: new Set(),
        woken: Deferred.makeUnsafe(),
        heardAt: undefined,
        answeredHeardAt: undefined,
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => register(hub.watchers, watcher, topics)),
        () =>
          Effect.sync(() => {
            unregister(hub.watchers, watcher, topics);
            if (hub.watchers.all.size === 0) listening.idle = true;
          }),
      );
      return {
        next: nextOf(watcher, listening, fallback),
        heardAt: Effect.sync(() => Option.fromUndefinedOr(watcher.answeredHeardAt)),
      } satisfies SyncWatch;
    });

export const syncHub = Layer.effect(
  Sync,
  Effect.gen(function* () {
    const hub: Hub = {
      listener: yield* SyncListener,
      watchers: { byTopic: new Map(), all: new Set() },
    };
    const listener = yield* RcRef.make({ acquire: opened(hub), idleTimeToLive: LISTENER.IDLE });
    return { watch: watchOn(hub, listener) } satisfies SyncShape;
  }),
);

const unpooledListener: Layer.Layer<SyncListener> = Layer.unwrap(
  Effect.map(Effect.orElseSucceed(databaseUnpooledUrl, Option.none), (url) =>
    Option.match(url, {
      onNone: () => Layer.succeed(SyncListener, { listen: Effect.fail(UNPOOLED_URL_MISSING) }),
      onSome: (unpooled) =>
        syncListenerOverUrl({ url: unpooled, idleSessionTimeout: LISTENER.REAPED }),
    }),
  ),
);

export const syncFromEnvironment = syncHub.pipe(Layer.provide(unpooledListener));
