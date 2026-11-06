import { Data, Duration, Effect, Schedule } from "effect";
import { rendererFork } from "./renderer-runtime.js";

const STREAM_REOPEN = {
  FIRST: Duration.seconds(1),
  LONGEST: Duration.seconds(30),
} as const;

const REOPEN_BACKOFF = Schedule.exponential(STREAM_REOPEN.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, STREAM_REOPEN.LONGEST)),
  ),
);

class StreamUnheard extends Data.TaggedError("StreamUnheard") {}

type OpenedStream<View> = AsyncIteratorObject<View, unknown, unknown>;

function letGo<View>(stream: OpenedStream<View>): Effect.Effect<void> {
  return Effect.sync(() => {
    stream.return?.(undefined).catch(() => undefined);
  });
}

function readOnce<View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
): Effect.Effect<void, StreamUnheard> {
  return Effect.scoped(
    Effect.gen(function* () {
      const stream = yield* Effect.acquireRelease(
        Effect.tryPromise({ try: open, catch: () => new StreamUnheard() }),
        letGo,
      );
      let heard = false;
      const next = Effect.tryPromise({
        try: () => stream.next(),
        catch: () => new StreamUnheard(),
      }).pipe(
        Effect.flatMap((word) => {
          if (word.done === true) return Effect.fail(new StreamUnheard());
          return Effect.sync(() => {
            heard = true;
            take(word.value);
          });
        }),
      );
      yield* Effect.forever(next).pipe(
        Effect.catch((unheard) => (heard ? Effect.void : Effect.fail(unheard))),
      );
    }),
  );
}

export function followStream<View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
): Effect.Effect<void> {
  return readOnce(open, take).pipe(
    Effect.retry({ schedule: REOPEN_BACKOFF }),
    Effect.repeat({ schedule: Schedule.spaced(STREAM_REOPEN.FIRST) }),
    Effect.ignore,
  );
}

export function streamFrom<View>(
  open: () => Promise<OpenedStream<View>>,
  take: (view: View) => void,
): () => void {
  return rendererFork(followStream(open, take));
}
