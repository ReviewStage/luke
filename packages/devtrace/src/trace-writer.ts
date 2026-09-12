import path from "node:path";
import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem } from "@effect/platform-node";
import type { BrainPrefetchTraceRecord, BrainTurnTraceRecord } from "@sidecar/brain";
import {
  Cause,
  Effect,
  FiberId,
  FiberRefs,
  HashMap,
  List,
  Logger,
  LogLevel,
  ManagedRuntime,
} from "effect";
import { type AgentWireTrace, sanitizedTraceEvent, TRACE_ENTRY_KIND } from "./vocabulary.js";

/**
 * One model request a brain turn made, as the trace records it. The input
 * travels as counts alone — how many items, how many JSON characters — the
 * way an audio append travels as its byte count: a turn's input carries
 * transcript text, and the trace widening to it is a product decision. The
 * answer side keeps the outcome, the kinds of items that came back, and the
 * token counts the payload reported; the model when the client knows one,
 * absent through the hosted service, whose model the desktop never learns.
 */
export interface BrainRequestTraceRecord {
  inputItems: number;
  inputChars: number;
  outcome: string;
  elapsedMs: number;
  model?: string;
  outputItemKinds?: readonly string[];
  inputTokens?: number;
  outputTokens?: number;
  /** How much of the input the provider answered from its prefix cache, when it reported any. */
  cachedInputTokens?: number;
  /** Whether the request asked for a prefix cache at all; the key itself is a hash and is not recorded. */
  promptCacheKeyed?: boolean;
  error?: string;
}

/**
 * One decision the speech arbiter took about a proactive turn: which kind of
 * turn, what was decided of it, and how many requests stood pending after.
 * Nothing worded travels — a briefing's text is transcript-derived, and the
 * trace widening to it is a product decision.
 */
export interface SpeechTraceRecord {
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
  | ({ kind: typeof TRACE_ENTRY_KIND.BRAIN } & BrainTurnTraceRecord)
  | ({ kind: typeof TRACE_ENTRY_KIND.BRAIN_REQUEST } & BrainRequestTraceRecord)
  | ({ kind: typeof TRACE_ENTRY_KIND.BRAIN_PREFETCH } & BrainPrefetchTraceRecord)
  | { kind: typeof TRACE_ENTRY_KIND.SPEECH; speech: SpeechTraceRecord };

export interface AgentTraceWriterOptions {
  /** Where the trace lands, created on the first line rather than up front. */
  directory: string;
  now?: () => Date;
  report?: (message: string) => void;
}

/**
 * The trace's line format, as an Effect `Logger`: what one tapped entry
 * becomes once the moment it reached the writer is stamped on. The logger
 * only formats; `writeTraceLine` below is the effect that carries the
 * formatted line to disk, so the two halves of "an Effect Logger writing
 * through `FileSystem`" stay separate the way the library draws that line
 * everywhere else.
 */
function traceLineLogger(now: () => Date): Logger.Logger<PendingTraceEntry, string> {
  return Logger.make(
    ({ message }) => `${JSON.stringify({ at: now().toISOString(), ...message })}\n`,
  );
}

/** Appends one already-formatted line, making the directory on first use. */
function writeTraceLine(
  directory: string,
  file: string,
  line: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.writeFileString(file, line, { flag: "a" });
  });
}

/**
 * Appends the development trace as JSONL, one line per tapped event. The file
 * is named at construction so one app run is one trace, and lines queue behind
 * one another so the file keeps wire order even though appends are
 * asynchronous. A write failure is reported once and then silent: the trace is
 * an instrument reading the app, and a full disk must never become a voice
 * bug.
 *
 * @deprecated `AgentTraceWriter` is a promise-facing strangler shim on the
 * `Effect.runPromise` allowlist in `docs/adr/0001-effect.md`: its callers
 * (the host's composers) still hold a plain object with `record*` methods,
 * not a fiber, so each line's effect — the logger's formatting and the
 * `FileSystem` write together — is run here rather than on a caller's own
 * runtime. It is deleted once a host composer is a `Layer` that can hold the
 * writer's `ManagedRuntime` itself, in P7's devtrace composer PR (or P12-03
 * if none is needed before then).
 */
export class AgentTraceWriter {
  readonly file: string;
  readonly #directory: string;
  readonly #report: (message: string) => void;
  readonly #logger: Logger.Logger<PendingTraceEntry, string>;
  readonly #runtime: ManagedRuntime.ManagedRuntime<FileSystem.FileSystem, never>;
  #queue: Promise<void> = Promise.resolve();
  #failed = false;

  constructor(options: AgentTraceWriterOptions) {
    this.#directory = options.directory;
    const now = options.now ?? (() => new Date());
    this.#report = options.report ?? ((text: string) => process.stderr.write(text));
    const stamp = now().toISOString().replace(/[:.]/gu, "-");
    this.file = path.join(options.directory, `agent-trace-${stamp}.jsonl`);
    this.#logger = traceLineLogger(now);
    this.#runtime = ManagedRuntime.make(NodeFileSystem.layer);
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

  recordBrainTurn(record: BrainTurnTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.BRAIN, ...record });
  }

  recordBrainRequest(record: BrainRequestTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.BRAIN_REQUEST, ...record });
  }

  /** The prefetch's outcome, take, waits, and sizes; the words so far, the plan, and what a read answered never reach the line. */
  recordBrainPrefetch(record: BrainPrefetchTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.BRAIN_PREFETCH, ...record });
  }

  /**
   * Nested rather than spread: the record's own `kind` names the speech turn,
   * and the line's `kind` names the entry, and the two must not collide.
   */
  recordSpeechDecision(record: SpeechTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.SPEECH, speech: record });
  }

  /** The queue drained, for a test to await what `record*` fired and forgot. */
  settled(): Promise<void> {
    return this.#queue;
  }

  #append(entry: PendingTraceEntry): void {
    const line = this.#logger.log({
      fiberId: FiberId.none,
      logLevel: LogLevel.Info,
      message: entry,
      cause: Cause.empty,
      context: FiberRefs.empty(),
      spans: List.empty(),
      annotations: HashMap.empty(),
      date: new Date(),
    });
    this.#queue = this.#queue
      .then(() => this.#runtime.runPromise(writeTraceLine(this.#directory, this.file, line)))
      .catch((error) => {
        if (this.#failed) return;
        this.#failed = true;
        const message = error instanceof Error ? error.message : String(error);
        this.#report(`Agent trace could not be written: ${message}\n`);
      });
  }
}
