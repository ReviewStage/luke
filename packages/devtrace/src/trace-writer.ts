import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AttentionUpdate } from "@sidecar/attention";
import type { AttentionDecision } from "@sidecar/session";
import { type AgentWireTrace, sanitizedTraceEvent } from "./vocabulary.js";

/**
 * One evaluator pass as the trace records it: the bounded update that went to
 * the model, the decision that came back — absent when the pass failed — how
 * long the round trip took, and which model reviewed it, absent when the pass
 * ran through the hosted service, whose model the desktop never learns.
 */
export interface AttentionTraceRecord {
  update: AttentionUpdate;
  decision: AttentionDecision | undefined;
  elapsedMs: number;
  error?: string;
  model?: string;
}

export const TRACE_ENTRY_KIND = {
  WIRE: "wire",
  ATTENTION: "attention",
} as const;

/**
 * One line of the trace before its timestamp is stamped on. `JSON.stringify`
 * drops undefined-valued fields, so an absent decision or error never reaches
 * the file as a key.
 */
type PendingTraceEntry =
  | ({ kind: typeof TRACE_ENTRY_KIND.WIRE } & AgentWireTrace)
  | ({ kind: typeof TRACE_ENTRY_KIND.ATTENTION } & AttentionTraceRecord);

export interface AgentTraceWriterOptions {
  /** Where the trace lands, created on the first line rather than up front. */
  directory: string;
  now?: () => Date;
  report?: (message: string) => void;
}

/**
 * Appends the development trace as JSONL, one line per tapped event. The file
 * is named at construction so one app run is one trace, and lines queue behind
 * one another so the file keeps wire order even though appends are
 * asynchronous. A write failure is reported once and then silent: the trace is
 * an instrument reading the app, and a full disk must never become a voice
 * bug.
 */
export class AgentTraceWriter {
  readonly file: string;
  readonly #directory: string;
  readonly #now: () => Date;
  readonly #report: (message: string) => void;
  /** The directory made once, whichever line gets there first. */
  #directoryReady: Promise<void> | undefined;
  #queue: Promise<void> = Promise.resolve();
  #failed = false;

  constructor(options: AgentTraceWriterOptions) {
    this.#directory = options.directory;
    this.#now = options.now ?? (() => new Date());
    this.#report = options.report ?? ((text: string) => process.stderr.write(text));
    const stamp = this.#now().toISOString().replace(/[:.]/gu, "-");
    this.file = path.join(options.directory, `agent-trace-${stamp}.jsonl`);
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

  recordAttention(record: AttentionTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.ATTENTION, ...record });
  }

  /** The queue drained, for a test to await what `record*` fired and forgot. */
  settled(): Promise<void> {
    return this.#queue;
  }

  #append(entry: PendingTraceEntry): void {
    const line = `${JSON.stringify({ at: this.#now().toISOString(), ...entry })}\n`;
    this.#queue = this.#queue
      .then(async () => {
        this.#directoryReady ??= mkdir(this.#directory, { recursive: true }).then(() => undefined);
        await this.#directoryReady;
        await appendFile(this.file, line);
      })
      .catch((error) => {
        if (this.#failed) return;
        this.#failed = true;
        const message = error instanceof Error ? error.message : String(error);
        this.#report(`Agent trace could not be written: ${message}\n`);
      });
  }
}
