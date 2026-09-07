import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The action journal: one entry per act a developer ask dispatched, keyed by
 * the run and the model's own call id. An entry is written before the
 * performer is called and completed with the act's result before the model
 * hears it, so a crash between the two leaves a started entry whose result is
 * unknown — never replayed, and answered to the model as exactly that.
 */

export interface BrainJournalEntry {
  runId: string;
  callId: string;
  name: string;
  argumentsJson: string;
  startedAt: number;
  /** The act's outcome as a JSON record, once the performer answered. */
  outputJson?: string;
  settledAt?: number;
}

export function brainJournalEntryFromWire(value: UnparsedWireValue): BrainJournalEntry | undefined {
  if (!isRecord(value)) return undefined;
  if (!isWireString(value.runId) || !isWireString(value.callId) || !isWireString(value.name)) {
    return undefined;
  }
  if (!isWireString(value.argumentsJson)) return undefined;
  if (!isWireNumber(value.startedAt) || !Number.isFinite(value.startedAt)) return undefined;
  if (value.outputJson !== undefined && !isWireString(value.outputJson)) return undefined;
  if (
    value.settledAt !== undefined &&
    !(isWireNumber(value.settledAt) && Number.isFinite(value.settledAt))
  ) {
    return undefined;
  }
  const entry: BrainJournalEntry = {
    runId: value.runId,
    callId: value.callId,
    name: value.name,
    argumentsJson: value.argumentsJson,
    startedAt: value.startedAt,
  };
  if (value.outputJson !== undefined) entry.outputJson = value.outputJson;
  if (value.settledAt !== undefined) entry.settledAt = value.settledAt;
  return entry;
}

/** What a model is told about a call whose act ran but whose result never reached the journal. */
export const UNKNOWN_ACT_RESULT = {
  status: "unknown",
  reason: "the act was started but its result was lost before it was recorded",
} as const;

/**
 * Journal entries as one run reads them: by call id, with the two questions
 * the dispatch asks — has this call already been answered, and does a repeated
 * id carry the same arguments it did the first time.
 */
export class BrainJournal {
  readonly #entries = new Map<string, Map<string, BrainJournalEntry>>();

  constructor(entries: readonly BrainJournalEntry[] = []) {
    for (const entry of entries) this.#run(entry.runId).set(entry.callId, { ...entry });
  }

  #run(runId: string): Map<string, BrainJournalEntry> {
    let run = this.#entries.get(runId);
    if (!run) {
      run = new Map();
      this.#entries.set(runId, run);
    }
    return run;
  }

  get(runId: string, callId: string): BrainJournalEntry | undefined {
    return this.#entries.get(runId)?.get(callId);
  }

  start(entry: Omit<BrainJournalEntry, "outputJson" | "settledAt">): void {
    this.#run(entry.runId).set(entry.callId, { ...entry });
  }

  settle(runId: string, callId: string, outputJson: string, settledAt: number): void {
    const entry = this.get(runId, callId);
    if (!entry) return;
    entry.outputJson = outputJson;
    entry.settledAt = settledAt;
  }

  /** Every entry, runs in insertion order and calls in dispatch order. */
  entries(): readonly BrainJournalEntry[] {
    return [...this.#entries.values()].flatMap((run) => [...run.values()].map((e) => ({ ...e })));
  }

  /** Drops one entry whose start could not be checkpointed, so it never reads as an act that ran. */
  forget(runId: string, callId: string): void {
    const run = this.#entries.get(runId);
    run?.delete(callId);
    if (run?.size === 0) this.#entries.delete(runId);
  }

  /** Drops the journals of the runs named, for the host's retention to call. */
  dropRuns(runIds: Iterable<string>): void {
    for (const runId of runIds) this.#entries.delete(runId);
  }
}
