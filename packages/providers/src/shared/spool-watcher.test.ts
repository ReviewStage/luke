import assert from "node:assert/strict";
import path from "node:path";
import { type PlatformError, SystemError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  Chunk,
  Duration,
  Effect,
  Fiber,
  Layer,
  Queue,
  Ref,
  Schedule,
  type Scope,
  Stream,
  TestClock,
} from "effect";
import { HOOK_EVENT } from "./hook-merge.js";
import { type ObservedSpoolEvent, observationSpoolEvents } from "./spool-watcher.js";

type SpoolEvent = (typeof HOOK_EVENT)[keyof typeof HOOK_EVENT];

const EVENTS: readonly SpoolEvent[] = Object.values(HOOK_EVENT);
const DEBOUNCE_MS = 500;
const REARM_INTERVAL_MS = 5000;

/** How many windows a test lets pass before it gives a batch up for lost. */
const TICKS = 50;

/**
 * The spool's watch under a test's own hand, over this machine's real file
 * system for everything else: the files are written and read for real, and
 * only the platform's own watcher — whose delivery no test can time — is
 * replaced by a queue the test offers file names into. A watch asked for
 * while a refusal stands fails the way `FileSystem.watch` fails on a
 * directory hook installation has not created yet.
 */
interface FakeWatch {
  readonly layer: Layer.Layer<FileSystem.FileSystem>;
  /** The directories a watch actually stood on, in order. */
  readonly stood: Effect.Effect<readonly string[]>;
  readonly refuse: (count: number) => Effect.Effect<void>;
  readonly emit: (fileName: string) => Effect.Effect<void>;
  readonly fail: Effect.Effect<void>;
}

const watchFailure = (directory: string) =>
  new SystemError({
    module: "FileSystem",
    reason: "NotFound",
    method: "watch",
    pathOrDescriptor: directory,
  });

const fakeWatch = (): Effect.Effect<FakeWatch> =>
  Effect.gen(function* () {
    const stood = yield* Ref.make<readonly string[]>([]);
    const refusals = yield* Ref.make(0);
    const offered = yield* Queue.unbounded<FileSystem.WatchEvent | SystemError>();
    const layer = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (fileSystem) => ({
        ...fileSystem,
        watch: (directory: string) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const remaining = yield* Ref.getAndUpdate(refusals, (count) =>
                count > 0 ? count - 1 : 0,
              );
              if (remaining > 0) return Stream.fail(watchFailure(directory));
              yield* Ref.update(stood, (watches) => [...watches, directory]);
              return Stream.flatMap(Stream.fromQueue(offered), (event) =>
                event instanceof SystemError ? Stream.fail(event) : Stream.succeed(event),
              );
            }),
          ),
      })),
    ).pipe(Layer.provide(NodeFileSystem.layer));
    return {
      layer,
      stood: Ref.get(stood),
      refuse: (count) => Ref.set(refusals, count),
      emit: (fileName) =>
        Effect.asVoid(Queue.offer(offered, FileSystem.WatchEventCreate({ path: fileName }))),
      fail: Effect.asVoid(Queue.offer(offered, watchFailure("spool"))),
    };
  });

/**
 * Every batch the stream reports, taken off a queue a fiber of its own fills.
 * A queue rather than a list because the reads behind a window are real file
 * reads: a taker suspends until the batch has actually been read, where a
 * list would have to be polled for it.
 */
interface Collected {
  /** The next `count` batches, suspending until that many have been read. */
  readonly take: (
    count: number,
  ) => Effect.Effect<readonly (readonly ObservedSpoolEvent<SpoolEvent>[])[]>;
  readonly reported: Effect.Effect<number>;
  readonly fiber: Fiber.RuntimeFiber<void, unknown>;
}

const collectBatches = (
  spoolDirectory: string,
): Effect.Effect<Collected, never, FileSystem.FileSystem | Scope.Scope> =>
  Effect.gen(function* () {
    const reported = yield* Queue.unbounded<readonly ObservedSpoolEvent<SpoolEvent>[]>();
    const fiber = yield* Effect.forkScoped(
      Stream.runForEach(observationSpoolEvents({ spoolDirectory, events: EVENTS }), (batch) =>
        Queue.offer(reported, batch),
      ),
    );
    return {
      take: (count) => Effect.map(Queue.takeN(reported, count), Chunk.toReadonlyArray),
      reported: Queue.size(reported),
      fiber,
    };
  });

/**
 * One test's spool: a temporary directory, the watch under the test's hand,
 * and both gone when the test's scope closes.
 */
const withSpool = <Answer, Failure>(
  body: (
    watch: FakeWatch,
    spoolDirectory: string,
  ) => Effect.Effect<Answer, Failure, FileSystem.FileSystem | Scope.Scope>,
): Effect.Effect<Answer, Failure | PlatformError> =>
  Effect.flatMap(fakeWatch(), (watch) =>
    Effect.scoped(
      Effect.provide(
        Effect.flatMap(temporaryDirectoryScoped(), (spoolDirectory) => body(watch, spoolDirectory)),
        watch.layer,
      ),
    ),
  );

/**
 * The next `count` batches, with the clock moved on until they arrive. The
 * window is the clock's and the reads behind it are real file reads, so the
 * ticker runs on a fiber of its own while the taker suspends: the batch is
 * what ends the wait, and the recurrence bound is what turns a batch that
 * never comes into a failing test rather than a hanging one.
 */
const awaitBatches = (collected: Collected, count: number) =>
  Effect.flatMap(
    Effect.fork(
      Effect.repeat(TestClock.adjust(Duration.millis(DEBOUNCE_MS)), Schedule.recurs(TICKS)),
    ),
    (ticker) => Effect.zipLeft(collected.take(count), Fiber.interrupt(ticker)),
  );

const writeSpoolFile = (spoolDirectory: string, fileName: string, content: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
    fileSystem.writeFileString(path.join(spoolDirectory, fileName), content),
  );

const named = (batch: readonly ObservedSpoolEvent<SpoolEvent>[]) =>
  batch.map(({ providerSessionId, event }) => ({ providerSessionId, event }));

const ids = (batches: readonly (readonly ObservedSpoolEvent<SpoolEvent>[])[]) =>
  batches.map((batch) => batch.map((event) => event.providerSessionId));

describe("the observation spool stream", () => {
  it.effect("reports every readable file one window saw as one batch", () =>
    withSpool((watch, spoolDirectory) =>
      Effect.gen(function* () {
        const collected = yield* collectBatches(spoolDirectory);

        yield* writeSpoolFile(spoolDirectory, "session-a.json", '{"event":"stop"}');
        yield* writeSpoolFile(spoolDirectory, "session-b.json", '{"event":"prompt"}');
        yield* writeSpoolFile(spoolDirectory, "foreign.json", '{"event":"something-else"}');
        yield* writeSpoolFile(spoolDirectory, "broken.json", "not json");
        yield* writeSpoolFile(spoolDirectory, ".session-c.123.tmp", '{"event":"stop"}');

        for (const fileName of [
          "session-a.json",
          "session-a.json",
          "session-b.json",
          "foreign.json",
          "broken.json",
          "absent.json",
          ".session-c.123.tmp",
          "../escape.json",
        ]) {
          yield* watch.emit(fileName);
        }

        yield* TestClock.adjust(Duration.millis(DEBOUNCE_MS - 1));
        assert.equal(yield* collected.reported, 0);
        yield* TestClock.adjust(Duration.millis(1));

        const batches = yield* awaitBatches(collected, 1);
        assert.deepEqual(named(batches[0] ?? []), [
          { providerSessionId: "session-a", event: HOOK_EVENT.STOP },
          { providerSessionId: "session-b", event: HOOK_EVENT.PROMPT },
        ]);
      }),
    ),
  );

  it.effect("reports a name seen after a batch in a batch of its own", () =>
    withSpool((watch, spoolDirectory) =>
      Effect.gen(function* () {
        const collected = yield* collectBatches(spoolDirectory);
        yield* writeSpoolFile(spoolDirectory, "first.json", '{"event":"session-start"}');
        yield* writeSpoolFile(spoolDirectory, "second.json", '{"event":"stop"}');

        yield* watch.emit("first.json");
        assert.deepEqual(ids(yield* awaitBatches(collected, 1)), [["first"]]);

        yield* watch.emit("second.json");
        assert.deepEqual(ids(yield* awaitBatches(collected, 1)), [["second"]]);
      }),
    ),
  );

  it.effect("reports nothing for a window whose files all fail to read", () =>
    withSpool((watch, spoolDirectory) =>
      Effect.gen(function* () {
        const collected = yield* collectBatches(spoolDirectory);
        yield* watch.emit("gone.json");
        yield* TestClock.adjust(Duration.millis(DEBOUNCE_MS));

        assert.equal(yield* collected.reported, 0);
      }),
    ),
  );

  it.effect("stands the watch again after the rearm interval and reports what it then sees", () =>
    withSpool((watch, spoolDirectory) =>
      Effect.gen(function* () {
        yield* watch.refuse(2);
        const collected = yield* collectBatches(spoolDirectory);
        assert.deepEqual(yield* watch.stood, []);

        yield* TestClock.adjust(Duration.millis(REARM_INTERVAL_MS));
        assert.deepEqual(yield* watch.stood, []);
        yield* TestClock.adjust(Duration.millis(REARM_INTERVAL_MS));
        assert.deepEqual(yield* watch.stood, [spoolDirectory]);

        yield* writeSpoolFile(spoolDirectory, "late.json", '{"event":"stop"}');
        yield* watch.emit("late.json");
        yield* TestClock.adjust(Duration.millis(DEBOUNCE_MS));
        assert.deepEqual(ids(yield* awaitBatches(collected, 1)), [["late"]]);
      }),
    ),
  );

  it.effect("stands the watch again after one that had stood fails", () =>
    withSpool((watch, spoolDirectory) =>
      Effect.gen(function* () {
        const collected = yield* collectBatches(spoolDirectory);
        yield* TestClock.adjust(Duration.millis(1));
        assert.deepEqual(yield* watch.stood, [spoolDirectory]);

        yield* watch.fail;
        yield* TestClock.adjust(Duration.millis(REARM_INTERVAL_MS));
        assert.deepEqual(yield* watch.stood, [spoolDirectory, spoolDirectory]);

        yield* writeSpoolFile(spoolDirectory, "after.json", '{"event":"notification"}');
        yield* watch.emit("after.json");
        yield* TestClock.adjust(Duration.millis(DEBOUNCE_MS));
        assert.deepEqual(ids(yield* awaitBatches(collected, 1)), [["after"]]);
      }),
    ),
  );

  it.effect("reports nothing once the fiber that ran it is interrupted", () =>
    withSpool((watch, spoolDirectory) =>
      Effect.gen(function* () {
        const collected = yield* collectBatches(spoolDirectory);
        yield* writeSpoolFile(spoolDirectory, "pending.json", '{"event":"stop"}');
        yield* watch.emit("pending.json");
        yield* Fiber.interrupt(collected.fiber);

        yield* watch.emit("pending.json");
        yield* TestClock.adjust(Duration.millis(DEBOUNCE_MS + REARM_INTERVAL_MS));
        assert.equal(yield* collected.reported, 0);
      }),
    ),
  );
});
