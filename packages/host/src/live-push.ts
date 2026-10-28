import { Duration, Effect, Option, Stream } from "effect";
import { LiveBroken, liveRows, type SealedRead, type TxWait } from "./live-follow.js";

/**
 * live-push.ts -- a read followed over the service's held poll for the windows that draw it, each change published for the host to push to them.
 *
 * The read is fetched from the service and followed (`live-follow.ts`); the
 * rows are decoded where they arrive, and the value they stand for is
 * published each time they move. A read the service did not answer is
 * published as a failure and asked for again, and a follow that stops for
 * good is read again, each after `LIVE_RESEAL`. Only the value is published.
 */

/** How long after a read went unanswered, or a follow stopped for good, it is read again. */
const LIVE_RESEAL = Duration.seconds(2);

/** A read the service did not answer, `gone` where the read names nothing the account reaches. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface LivePushDependencies<Part extends string, Value> {
  /** The read with its rows inline at the poll address, held past `after` where it names one. */
  readonly seal: (poll: boolean, after?: string) => Effect.Effect<SealedRead<Part> | SealFailure>;
  /** The value a delivery's rows stand for, none where they do not decode. */
  readonly decode: (rows: Readonly<Record<Part, readonly unknown[]>>) => Option.Option<Value>;
  /** The value as it now stands each time it moves, or that it could not be followed. */
  readonly publish: (value: Value | undefined) => void;
  /** Handed how to wait for a write's transaction on the read where it has one, and none once it is let go (`liveRows`). */
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
        poll: (after) => dependencies.seal(true, after),
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
