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

/** The status an act's output carries when whether it happened cannot be established. */
export const UNKNOWN_ACT_STATUS = "unknown";

/** What a model is told about a call whose act ran but whose result never reached the journal. */
export const UNKNOWN_ACT_RESULT = {
  status: UNKNOWN_ACT_STATUS,
  reason: "the act was started but its result was lost before it was recorded",
} as const;

/**
 * What a model is told about a call whose performer threw after dispatch: the
 * provider may have taken the write, so it is neither a refusal nor a result,
 * and it is never retried on the model's own initiative.
 */
export const UNCONFIRMED_ACT_RESULT = {
  status: UNKNOWN_ACT_STATUS,
  reason: "the act was dispatched but did not answer; it may have happened, so do not repeat it",
} as const;

/** What a run's journal can vouch for: acts that went through, and acts whose outcome is not known. */
export interface JournalActCounts {
  performedActs: number;
  unknownActs: number;
}

/**
 * Reads a run's accounting from its journal alone: an entry whose result was
 * accepted went through; one whose result says unknown, or that has no result
 * at all, may have. Counting from the journal rather than from a running
 * tally means a launch that finds the run mid-flight reports exactly what
 * the acts before the crash established, no more and no less.
 */
export function journalActCounts(
  entries: readonly BrainJournalEntry[],
  runId: string,
): JournalActCounts {
  const counts: JournalActCounts = { performedActs: 0, unknownActs: 0 };
  for (const entry of entries) {
    if (entry.runId !== runId) continue;
    if (entry.outputJson === undefined) {
      counts.unknownActs += 1;
      continue;
    }
    const status = outputStatus(entry.outputJson);
    if (status === "accepted") counts.performedActs += 1;
    else if (status === UNKNOWN_ACT_STATUS) counts.unknownActs += 1;
  }
  return counts;
}

function outputStatus(outputJson: string): string | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the record and string guards are the validation.
    const parsed = JSON.parse(outputJson) as UnparsedWireValue;
    return isRecord(parsed) && isWireString(parsed.status) ? parsed.status : undefined;
  } catch {
    return undefined;
  }
}

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
