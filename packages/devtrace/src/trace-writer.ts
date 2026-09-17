import { DateTime, Deferred, Effect, Path, Queue, type Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { type AgentWireTrace, sanitizedTraceEvent, TRACE_ENTRY_KIND } from "./vocabulary.js";

/**
 * One decision the speech arbiter took about a proactive turn: which kind of
 * turn, what was decided of it, and how many requests stood pending after.
 * Nothing worded travels — a briefing's text is transcript-derived, and the
 * trace widening to it is a product decision.
 */
interface SpeechTraceRecord {
  kind: string;
  decision: string;
  pendingCount: number;
}

/**
 * One line of the trace before its timestamp is stamped on. `JSON.stringify`
 * drops undefined-valued fields, so an absent model or error never reaches
 * the file as a key.
 */
type PendingTraceEntry =
  | ({ kind: typeof TRACE_ENTRY_KIND.WIRE } & AgentWireTrace)
  | { kind: typeof TRACE_ENTRY_KIND.SPEECH; speech: SpeechTraceRecord };

/**
 * What waits on the writer's queue: a line to append, or a caller's own marker
 * that it wants every line offered before it to have landed. The queue is
 * first in, first out, so the marker's turn is exactly that moment and no
 * counting of what is outstanding is needed to find it.
 */
const TRACE_WORK = {
  LINE: "line",
  SETTLED: "settled",
} as const;

type TraceWork =
  | { readonly kind: typeof TRACE_WORK.LINE; readonly line: string }
  | {
      readonly kind: typeof TRACE_WORK.SETTLED;
      readonly done: Deferred.Deferred<void>;
    };

interface AgentTraceWriterOptions {
  /** Where the trace lands, created on the first line rather than up front. */
  directory: string;
  report?: (message: string) => void;
}

/**
 * The trace's line format: what one tapped entry becomes once the moment it
 * reached the writer is stamped on. It only formats; `writeTraceLine` below
 * is the effect that carries the formatted line to disk, so the two halves of
 * "a line written through `FileSystem`" stay separate the way the library
 * draws that line everywhere else. It is a plain function rather than an
 * Effect `Logger`, because a v4 `Logger` is handed the live fiber of a
 * runtime log event and nothing outside a fiber can fabricate one; the
 * stamping is the writer's own, taken the instant `record*` was called.
 */
function traceLine(entry: PendingTraceEntry): string {
  return `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`;
}

/** Appends one already-formatted line, making the directory on first use. */
const writeTraceLine = /* @__PURE__ */ Effect.fnUntraced(function* (
  directory: string,
  file: string,
  line: string,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(file, line, { flag: "a" });
});

/**
 * Appends the development trace as JSONL, one line per tapped event. The file
 * is named at construction so one app run is one trace, and lines queue behind
 * one another so the file keeps wire order even though appends are
 * asynchronous. A write failure is reported once and then silent: the trace is
 * an instrument reading the app, and a full disk must never become a voice
 * bug.
 *
 * It runs nothing of its own. A `record*` call offers its line onto an
 * unbounded queue, and one fiber — forked by {@link AgentTraceWriter.make}
 * into the scope its caller is already composing in, over the `FileSystem`
 * that caller's own layer provides — takes them one at a time and writes
 * them, so the order the queue keeps is the order the file gets and the fiber
 * ends with that scope.
 */
export class AgentTraceWriter {
  readonly file: string;
  readonly #directory: string;
  readonly #report: (message: string) => void;
  readonly #work: Queue.Queue<TraceWork>;
  #failed = false;

  /**
   * The queue drained, for a test to await what `record*` fired and forgot: a
   * marker of its own onto the same queue, awaited until the fiber reaches it.
   */
  readonly settled: Effect.Effect<void> = Effect.suspend(() =>
    Effect.flatMap(Deferred.make<void>(), (done) =>
      Effect.andThen(
        Queue.offer(this.#work, { kind: TRACE_WORK.SETTLED, done }),
        Deferred.await(done),
      ),
    ),
  );

  private constructor(
    options: AgentTraceWriterOptions,
    file: string,
    work: Queue.Queue<TraceWork>,
  ) {
    this.#directory = options.directory;
    this.#report = options.report ?? ((text: string) => process.stderr.write(text));
    this.file = file;
    this.#work = work;
  }

  /** One writer, with the fiber that carries its lines to disk forked into the caller's scope. */
  static make(
    options: AgentTraceWriterOptions,
  ): Effect.Effect<AgentTraceWriter, never, Scope.Scope | FileSystem.FileSystem | Path.Path> {
    return Effect.gen(function* () {
      const path = yield* Path.Path;
      const openedAt = yield* DateTime.nowAsDate;
      const stamp = openedAt.toISOString().replace(/[:.]/gu, "-");
      const file = path.join(options.directory, `agent-trace-${stamp}.jsonl`);
      const writer = new AgentTraceWriter(options, file, yield* Queue.unbounded<TraceWork>());
      yield* Effect.forkScoped(writer.#drain());
      return writer;
    });
  }

  recordWire(trace: AgentWireTrace): void {
    // Sanitized here as well as at the renderer's tap, because this is the
    // one place that touches the file: the trust constraint is that audio
    // never reaches disk, and a rule enforced only by a caller's manners is
    // one a second caller forgets. The sanitizer returns an already-stripped
    // event unchanged, so the two passes cost one field read.
    this.#append({
      kind: TRACE_ENTRY_KIND.WIRE,
      ...trace,
      event: sanitizedTraceEvent(trace.event),
    });
  }

  #append(entry: PendingTraceEntry): void {
    Queue.offerUnsafe(this.#work, {
      kind: TRACE_WORK.LINE,
      line: traceLine(entry),
    });
  }

  /**
   * One line at a time, for as long as the fiber stands. Only a write's own
   * failure is caught, so the interruption that ends the scope ends the fiber
   * rather than being swallowed by a loop that would never stop.
   */
  #drain(): Effect.Effect<never, never, FileSystem.FileSystem> {
    return Effect.forever(
      Effect.flatMap(Queue.take(this.#work), (work) =>
        work.kind === TRACE_WORK.SETTLED
          ? Effect.asVoid(Deferred.succeed(work.done, undefined))
          : Effect.catch(writeTraceLine(this.#directory, this.file, work.line), (error) =>
              Effect.sync(() => {
                if (this.#failed) return;
                this.#failed = true;
                this.#report(`Agent trace could not be written: ${error.message}\n`);
              }),
            ),
      ),
    );
  }
}
