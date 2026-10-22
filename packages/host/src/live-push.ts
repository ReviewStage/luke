import { Duration, Effect, Option, Stream } from "effect";
import {
  LiveBroken,
  type LiveClient,
  liveRows,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";

/**
 * live-push.ts -- a read followed over Neon Realtime for the windows that draw it, each change published for the host to push to them.
 *
 * The sealed statements are fetched from the service and followed
 * (`live-follow.ts`, which polls the read while Realtime fails it); the rows
 * are decoded where they arrive, and the value they stand for is published
 * each time they move. A seal the service did not answer is published as a
 * failure and asked for again, and a follow that stops for good is sealed
 * again, each after `LIVE_RESEAL`. The sealed statements stay here, where
 * the account's own bearer is; only the value is published.
 */

/** How long after a seal went unanswered, or a follow stopped for good, it is sealed again. */
const LIVE_RESEAL = Duration.seconds(2);

/** A seal the service did not answer, `gone` where the read names nothing the account reaches. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface LivePushDependencies<Part extends string, Value> {
  /** The read sealed, or with `poll` its rows inline at the poll address, held past `after` where it names one. */
  readonly seal: (poll: boolean, after?: string) => Effect.Effect<SealedRead<Part> | SealFailure>;
  /** The value a delivery's rows stand for, none where they do not decode. */
  readonly decode: (rows: Readonly<Record<Part, readonly unknown[]>>) => Option.Option<Value>;
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /** Now, by the host's own clock, which renewals are timed by. */
  readonly now: () => number;
  /** The value as it now stands each time it moves, or that it could not be followed. */
  readonly publish: (value: Value | undefined) => void;
  /** Handed how to wait for a write's transaction on the read once it is live, and none once it is not (`liveRows`). */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The read followed until interrupted, each change published. */
export function pushLive<Part extends string, Value>(
  dependencies: LivePushDependencies<Part, Value>,
): Effect.Effect<never> {
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.seal(false);
    if ("failure" in sealed) {
      dependencies.publish(undefined);
      return yield* Effect.sleep(LIVE_RESEAL);
    }
    const rows = liveRows(
      {
        openLive: dependencies.openLive,
        reseal: () => dependencies.seal(false),
        poll: (after) => dependencies.seal(true, after),
        now: dependencies.now,
        ...(dependencies.onTxWait === undefined ? undefined : { onTxWait: dependencies.onTxWait }),
      },
      sealed,
    );
    yield* Stream.runForEach(rows, (read) =>
      Option.match(dependencies.decode(read), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: (value) => Effect.sync(() => dependencies.publish(value)),
      }),
    ).pipe(Effect.catch(() => Effect.void));
    yield* Effect.sleep(LIVE_RESEAL);
  });
  return Effect.forever(attempt);
}
