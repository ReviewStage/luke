import path from "node:path";
import { type SerialQueue, serialQueue } from "@sidecar/runtime/effect";
import { Cause, Deferred, Effect, type Scope } from "effect";
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

interface AgentTraceWriterOptions {
  /** Where the trace lands, created on the first line rather than up front. */
  directory: string;
  now?: () => Date;
  report?: (message: string) => void;
}

/** Where a writer with no reporter of its own says a write failed. */
const reportToStderr = (text: string): void => {
  process.stderr.write(text);
};

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
function traceLine(entry: PendingTraceEntry, now: () => Date): string {
  return `${JSON.stringify({ at: now().toISOString(), ...entry })}\n`;
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
  readonly #now: () => Date;
  /** The line writes in arrival order, and a caller's own marker among them; the fiber is the scope's. */
  readonly #work: SerialQueue<FileSystem.FileSystem>;
  #failed = false;

  /**
   * The queue drained, for a test to await what `record*` fired and forgot: a
   * marker of its own onto the same queue, awaited until the fiber reaches it.
   * The queue is first in, first out, so the marker's turn is exactly that
   * moment and no counting of what is outstanding is needed to find it.
   */
  readonly settled: Effect.Effect<void> = Effect.suspend(() =>
    Effect.flatMap(Deferred.make<void>(), (done) =>
      Effect.andThen(
        this.#work.offer(Effect.asVoid(Deferred.succeed(done, undefined))),
        Deferred.await(done),
      ),
    ),
  );

  private constructor(options: AgentTraceWriterOptions, work: SerialQueue<FileSystem.FileSystem>) {
    this.#directory = options.directory;
    const now = options.now ?? (() => new Date());
    this.#report = options.report ?? reportToStderr;
    const stamp = now().toISOString().replace(/[:.]/gu, "-");
    this.file = path.join(options.directory, `agent-trace-${stamp}.jsonl`);
    this.#now = now;
    this.#work = work;
  }

  /** One writer, with the fiber that carries its lines to disk forked into the caller's scope. */
  static make(
    options: AgentTraceWriterOptions,
  ): Effect.Effect<AgentTraceWriter, never, Scope.Scope | FileSystem.FileSystem> {
    return Effect.gen(function* () {
      const report = options.report ?? reportToStderr;
      // Only a write's own failure is caught by the write; a line that dies
      // is one more way the trace could not be written, said the same way.
      const work = yield* serialQueue<FileSystem.FileSystem>({
        onDefect: (cause) =>
          Effect.sync(() =>
            report(`Agent trace could not be written: ${String(Cause.squash(cause))}\n`),
          ),
      });
      return new AgentTraceWriter({ ...options, report }, work);
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

  /** One line onto the queue; a write that fails is reported once and then silent. */
  #append(entry: PendingTraceEntry): void {
    const line = traceLine(entry, this.#now);
    this.#work.offerUnsafe(
      Effect.catch(writeTraceLine(this.#directory, this.file, line), (error) =>
        Effect.sync(() => {
          if (this.#failed) return;
          this.#failed = true;
          this.#report(`Agent trace could not be written: ${error.message}\n`);
        }),
      ),
    );
  }
}
