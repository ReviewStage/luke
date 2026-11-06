import { Duration, Effect, Option, Stream } from "effect";
import {
  FOLLOW_RESEAL,
  LiveBroken,
  liveRows,
  type SealedRead,
  type TxWait,
  waitOrRegained,
} from "./live-follow.js";

type SealFailure = { readonly failure: string; readonly gone?: boolean };

export interface LivePushDependencies<Part extends string, Value> {
  readonly seal: (poll: boolean, after?: string) => Effect.Effect<SealedRead<Part> | SealFailure>;
  readonly decode: (rows: Readonly<Record<Part, readonly unknown[]>>) => Option.Option<Value>;
  readonly publish: (value: Value | undefined) => Effect.Effect<void>;
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

function resealWait(fruitless: number): Duration.Duration {
  const doubled = Duration.times(FOLLOW_RESEAL.FIRST, 2 ** Math.max(0, fruitless - 1));
  return Duration.min(doubled, FOLLOW_RESEAL.LONGEST);
}

export function pushLive<Part extends string, Value>(
  dependencies: LivePushDependencies<Part, Value>,
): Effect.Effect<void> {
  let fruitless = 0;
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
