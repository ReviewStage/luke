import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrainTurnTraceRecord } from "@sidecar/brain";
import { type AgentWireTrace, sanitizedTraceEvent } from "./vocabulary.js";

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
  error?: string;
}

export const TRACE_ENTRY_KIND = {
  WIRE: "wire",
  BRAIN: "brain",
  BRAIN_REQUEST: "brain-request",
} as const;

export type TraceEntryKind = (typeof TRACE_ENTRY_KIND)[keyof typeof TRACE_ENTRY_KIND];

/**
 * One line of the trace before its timestamp is stamped on. `JSON.stringify`
 * drops undefined-valued fields, so an absent model or error never reaches
 * the file as a key.
 */
type PendingTraceEntry =
  | ({ kind: typeof TRACE_ENTRY_KIND.WIRE } & AgentWireTrace)
  | ({ kind: typeof TRACE_ENTRY_KIND.BRAIN } & BrainTurnTraceRecord)
  | ({ kind: typeof TRACE_ENTRY_KIND.BRAIN_REQUEST } & BrainRequestTraceRecord);

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

  recordBrainTurn(record: BrainTurnTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.BRAIN, ...record });
  }

  recordBrainRequest(record: BrainRequestTraceRecord): void {
    this.#append({ kind: TRACE_ENTRY_KIND.BRAIN_REQUEST, ...record });
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
