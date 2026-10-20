import { LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Cause, Data, Duration, Effect, Queue, Stream } from "effect";

/**
 * live-follow.ts -- a read the host follows over Neon Realtime, as Neon's guide says to: sealed statements subscribed to at the address the service names, and renewed before they expire.
 *
 * Each read is one or more parts, one sealed statement each, and every read
 * following one address shares one client and its one socket ("Create one
 * client for the whole app, because every subscription shares its
 * connection"). Once every part has its first
 * result, every change of any part is the parts' rows whole, undecoded, for
 * the caller to decode at this boundary. Every seal is renewed ten seconds
 * before the earliest expires, a fetch that failed asked again a second
 * later, as Neon's own bindings renew ("Renew the sealed query"). The sealed
 * statements stay here, where the account's own bearer is; only what the
 * caller builds from the rows leaves.
 */

/** How long before a sealed statement expires it is renewed, as Neon's own bindings renew it. */
const RENEW_EARLY = Duration.seconds(10);
/** How soon a renewal whose fetch failed is asked again, as Neon's own bindings ask. */
const RENEW_RETRY = Duration.seconds(1);

/** A subscription that stopped for good: Realtime's client did not load, Realtime said so, a renewal was refused, or a row did not decode. */
export class LiveBroken extends Data.TaggedError("LiveBroken")<{
  readonly reason: string;
  /** Realtime's own code for why a subscription stopped, where it said one; never the sealed statement. */
  readonly code?: string;
}> {}

/**
 * A renewal the service refused as signed out: the session is no longer the
 * account's the read started for. Never asked again, as Neon's guide says
 * ("When the session changes"): the follow is left, not retried.
 */
export class LiveSignedOut extends Data.TaggedError("LiveSignedOut") {}

/** One part's subscription, the slice of Realtime's client this reads. */
interface LiveSubscription {
  onChange(
    listener: (snapshot: {
      readonly status: string;
      readonly data: readonly unknown[] | undefined;
      readonly error?: { readonly code: string } | undefined;
    }) => void,
  ): () => void;
  renew(query: SealedLiveQueryWire): Promise<void>;
  unsubscribe(): void;
}

/** One socket to Realtime, every part's subscription on it. */
export interface LiveClient {
  subscribe(query: SealedLiveQueryWire): LiveSubscription;
  close(): void;
}

/**
 * One client per address, shared by every read following there: each open
 * takes a handle, and the client's socket closes once the last handle is
 * let go. Neon's client multiplexes every subscription over its one socket,
 * so the host holds one socket however many reads it follows, rather than
 * one per read. The client is opened once per address, however many reads
 * wait on it while it loads; one that failed to open is forgotten, so the
 * next read opens it afresh. So is one any of whose subscriptions moved to
 * `error`: Neon's guide says a client whose connection failed cannot
 * reconnect ("Create a new client with `createRealtimeClient()` before you
 * subscribe again"), so the next read opens a new one, and the old one
 * closes once its last holder lets go.
 */
export function shareLiveClients(
  open: (url: string) => LiveClient | PromiseLike<LiveClient>,
): (url: string) => Promise<LiveClient> {
  const standing = new Map<string, { readonly client: Promise<LiveClient>; holders: number }>();
  const forget = (url: string, shared: { readonly client: Promise<LiveClient> }) => {
    if (standing.get(url) === shared) standing.delete(url);
  };
  return async (url) => {
    let shared = standing.get(url);
    if (shared === undefined) {
      const opening = { client: Promise.resolve(url).then(open), holders: 0 };
      opening.client.catch(() => forget(url, opening));
      standing.set(url, opening);
      shared = opening;
    }
    const held = shared;
    held.holders += 1;
    let client: LiveClient;
    try {
      client = await held.client;
    } catch (error) {
      held.holders -= 1;
      throw error;
    }
    let holding = true;
    return {
      subscribe: (query) => {
        const subscription = client.subscribe(query);
        // A subscription in error may be its connection's, which Neon's guide says never recovers: the client is replaced for the next read rather than shared on.
        subscription.onChange((snapshot) => {
          if (snapshot.status === "error") forget(url, held);
        });
        return subscription;
      },
      close: () => {
        if (!holding) return;
        holding = false;
        held.holders -= 1;
        if (held.holders > 0) return;
        forget(url, held);
        client.close();
      },
    };
  };
}

/**
 * Realtime's own client at the address the service named, shared by every
 * read following there, and loaded only when a read is first followed, so
 * its protocol's validators stay out of the web app's first load.
 */
export const openRealtimeClient = shareLiveClients((url) =>
  import("@neon/realtime/client").then(({ createRealtimeClient }) => createRealtimeClient({ url })),
);

/** A read sealed for following: where to subscribe, and each part's sealed statement. */
export interface SealedRead<Part extends string> {
  readonly url: string;
  readonly queries: Readonly<Record<Part, SealedLiveQueryWire>>;
}

export interface LiveFollowDependencies<Part extends string> {
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** The read sealed again, for renewing; a failure where the service answered none. */
  readonly reseal: () => Effect.Effect<SealedRead<Part> | { readonly failure: string }>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
}

/** The earliest any of the read's sealed statements expires, in epoch milliseconds. */
function earliestExpiry<Part extends string>(read: SealedRead<Part>): number {
  return Math.min(
    ...Object.values<SealedLiveQueryWire>(read.queries).map((query) => query.expiresAt),
  );
}

/**
 * Every part's rows, whole and undecoded, each time any part changes once
 * every part has its first result, for as long as the subscriptions stand.
 * It fails where a subscription stops for good or a renewal is refused, and
 * as signed out, renewing no more, where the service refused the session.
 */
export function liveRows<Part extends string>(
  dependencies: LiveFollowDependencies<Part>,
  first: SealedRead<Part>,
): Stream.Stream<Readonly<Record<Part, readonly unknown[]>>, LiveBroken | LiveSignedOut> {
  const parts = Object.keys(first.queries).filter((part): part is Part => part in first.queries);
  return Stream.callback<Readonly<Record<Part, readonly unknown[]>>, LiveBroken | LiveSignedOut>(
    (queue) =>
      Effect.gen(function* () {
        const client = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => dependencies.openLive(first.url),
            catch: () => new LiveBroken({ reason: "Realtime's client did not load" }),
          }),
          (opened) => Effect.sync(() => opened.close()),
        );
        const rows = new Map<Part, readonly unknown[]>();
        const broken = (failure: LiveBroken | LiveSignedOut) =>
          Queue.failCauseUnsafe(queue, Cause.fail(failure));
        const subscriptions = yield* Effect.acquireRelease(
          Effect.sync(() =>
            parts.map((part) => {
              const subscription = client.subscribe(first.queries[part]);
              subscription.onChange((snapshot) => {
                if (snapshot.status === "error") {
                  const code = snapshot.error?.code;
                  broken(
                    new LiveBroken({
                      reason: "the subscription stopped",
                      ...(code === undefined ? undefined : { code }),
                    }),
                  );
                  return;
                }
                if (snapshot.data === undefined) return;
                rows.set(part, snapshot.data);
                if (rows.size < parts.length) return;
                const whole = Object.fromEntries(rows);
                // SAFETY: `rows` holds every part once its size is the parts', and only parts.
                Queue.offerUnsafe(queue, whole as Readonly<Record<Part, readonly unknown[]>>);
              });
              return [part, subscription] as const;
            }),
          ),
          (standing) =>
            Effect.sync(() => {
              for (const [, subscription] of standing) subscription.unsubscribe();
            }),
        );
        let expiresAt = earliestExpiry(first);
        const renewal = Effect.gen(function* () {
          const wait = expiresAt - Duration.toMillis(RENEW_EARLY) - dependencies.now();
          yield* Effect.sleep(Duration.millis(Math.max(0, wait)));
          let next = yield* dependencies.reseal();
          while ("failure" in next) {
            if (next.failure === LIVE_SIGNED_OUT.failure) return yield* new LiveSignedOut();
            yield* Effect.sleep(RENEW_RETRY);
            next = yield* dependencies.reseal();
          }
          const renewed = next;
          yield* Effect.forEach(
            subscriptions,
            ([part, subscription]) =>
              Effect.tryPromise({
                try: () => subscription.renew(renewed.queries[part]),
                catch: () => new LiveBroken({ reason: "a renewal was refused" }),
              }),
            { discard: true },
          );
          expiresAt = earliestExpiry(renewed);
        });
        yield* Effect.forkScoped(
          Effect.forever(renewal).pipe(
            Effect.catch((failure) => Effect.sync(() => broken(failure))),
          ),
        );
      }),
  );
}

/**
 * Says in the log why a follow broke, by its reason and Realtime's code,
 * so a follow that stopped is heard rather than silent. Never the sealed
 * statement, which is a bearer, nor a row.
 */
export const logLiveBroken = (follow: string, broken: LiveBroken): Effect.Effect<void> =>
  Effect.logWarning(`live-follow: ${follow} broke: ${broken.reason}`).pipe(
    Effect.annotateLogs(broken.code === undefined ? {} : { code: broken.code }),
  );
