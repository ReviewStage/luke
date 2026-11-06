import { Duration, Effect, Option, Stream } from "effect";
import {
  FOLLOW_RESEAL,
  LiveBroken,
  liveRows,
  type SealedRead,
  type TxWait,
  waitOrRegained,
} from "./live-follow.js";

/**
 * live-push.ts -- a read followed over the service's held poll for the windows that draw it, each change published for the host to push to them.
 *
 * The read is fetched from the service and followed (`live-follow.ts`); the
 * rows are decoded where they arrive, and the value they stand for is
 * published each time they move. A read the service did not answer is
 * published as a failure and asked for again, and a follow that stops for
 * good is read again, each after a wait that doubles from `FOLLOW_RESEAL`'s
 * first to its longest while each read again publishes nothing, so a read
 * that keeps failing, or whose rows never decode, is not read whole every
 * two seconds for as long as it is held; a wait ends at once where the
 * service answers again (`waitOrRegained`). A read the service refused
 * for good, one naming nothing the account reaches, is published as a
 * failure and ends there, so a read held of a plan or an agent the reader
 * cannot reach is not asked again for as long as it is held. Only the value
 * is published.
 */

/** A read the service did not answer, `gone` where the read names nothing the account reaches. */
type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface LivePushDependencies<Part extends string, Value> {
  /** The read with its rows inline at the poll address, held past `after` where it names one. */
  readonly seal: (poll: boolean, after?: string) => Effect.Effect<SealedRead<Part> | SealFailure>;
  /** The value a delivery's rows stand for, none where they do not decode. */
  readonly decode: (rows: Readonly<Record<Part, readonly unknown[]>>) => Option.Option<Value>;
  /** Takes the value as it now stands each time it moves, or that it could not be followed. */
  readonly publish: (value: Value | undefined) => Effect.Effect<void>;
  /** Handed how to wait for a write's transaction on the read where it has one, and none once it is let go (`liveRows`). */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** How long to wait before reading again after `fruitless` reads in a row that published nothing: the first wait, doubled for each after the first, never past the longest. */
function resealWait(fruitless: number): Duration.Duration {
  const doubled = Duration.times(FOLLOW_RESEAL.FIRST, 2 ** Math.max(0, fruitless - 1));
  return Duration.min(doubled, FOLLOW_RESEAL.LONGEST);
}

/** The read followed until interrupted, each change published, or until the service refuses it for good. */
export function pushLive<Part extends string, Value>(
  dependencies: LivePushDependencies<Part, Value>,
): Effect.Effect<void> {
  // Note that a read that published counts the next wait from the first again.
  let fruitless = 0;
  // Each attempt answers whether the read is to be sealed again.
  const attempt = Effect.gen(function* () {
    const sealed = yield* dependencies.seal(false);
    if ("failure" in sealed) {
      yield* dependencies.publish(undefined);
      if (sealed.gone === true) return false;
      fruitless += 1;
      yield* waitOrRegained(resealWait(fruitless));
      return true;
    }
    let published = false;
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
        onSome: (value) => {
          published = true;
          return dependencies.publish(value);
        },
      }),
    ).pipe(Effect.catch(() => Effect.void));
    fruitless = published ? 0 : fruitless + 1;
    yield* waitOrRegained(resealWait(fruitless));
    return true;
  });
  return Effect.asVoid(Effect.repeat(attempt, { while: (again) => again }));
}
