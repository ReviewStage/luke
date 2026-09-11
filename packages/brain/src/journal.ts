import {
  isRecord,
  isWireNumber,
  isWireString,
  UNKNOWN_ACTION_STATUS,
  type UnknownActionResult,
  type UnparsedWireValue,
} from "@sidecar/wire";
import { NestedMap } from "./nested-map.js";
import { outputStatus } from "./tool-results.js";

/**
 * The action journal: one entry per action a developer ask dispatched, keyed by
 * the run and the model's own call id. An entry is written before the
 * performer is called and completed with the action's result before the model
 * hears it, so a crash between the two leaves a started entry whose result is
 * unknown — never replayed, and answered to the model as exactly that.
 */

export interface BrainJournalEntry {
  runId: string;
  callId: string;
  name: string;
  argumentsJson: string;
  startedAt: number;
  /** The action's outcome as a JSON record, once the performer answered. */
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

/** The status an action's output carries when whether it happened cannot be established. */
export { UNKNOWN_ACTION_STATUS };

/** What a model is told about a call whose action ran but whose result never reached the journal. */
export const UNKNOWN_ACTION_RESULT = {
  status: UNKNOWN_ACTION_STATUS,
  reason: "the action was started but its result was lost before it was recorded",
} as const satisfies UnknownActionResult;

/**
 * What a model is told about a call whose performer threw after dispatch: the
 * provider may have taken the write, so it is neither a refusal nor a result,
 * and it is never retried on the model's own initiative.
 */
export const UNCONFIRMED_ACTION_RESULT = {
  status: UNKNOWN_ACTION_STATUS,
  reason: "the action was dispatched but did not answer; it may have happened, so do not repeat it",
} as const satisfies UnknownActionResult;

/** What a run's journal can vouch for: actions that went through, and actions whose outcome is not known. */
export interface JournalActionCounts {
  performedActions: number;
  unknownActions: number;
}

/**
 * Reads a run's accounting from its journal alone: an entry whose result was
 * accepted went through; one whose result says unknown, or that has no result
 * at all, may have. Counting from the journal rather than from a running
 * tally means a launch that finds the run mid-flight reports exactly what
 * the actions before the crash established, no more and no less.
 */
export function journalActionCounts(
  entries: readonly BrainJournalEntry[],
  runId: string,
): JournalActionCounts {
  const counts: JournalActionCounts = { performedActions: 0, unknownActions: 0 };
  for (const entry of entries) {
    if (entry.runId !== runId) continue;
    if (entry.outputJson === undefined) {
      counts.unknownActions += 1;
      continue;
    }
    const status = outputStatus(entry.outputJson);
    if (status === "accepted") counts.performedActions += 1;
    else if (status === UNKNOWN_ACTION_STATUS) counts.unknownActions += 1;
  }
  return counts;
}

/**
 * Journal entries as one run reads them: by call id, with the two questions
 * the dispatch asks — has this call already been answered, and does a repeated
 * id carry the same arguments it did the first time.
 */
export class BrainJournal {
  readonly #entries = new NestedMap<BrainJournalEntry>();

  constructor(entries: readonly BrainJournalEntry[] = []) {
    for (const entry of entries) this.#entries.set(entry.runId, entry.callId, { ...entry });
  }

  get(runId: string, callId: string): BrainJournalEntry | undefined {
    return this.#entries.get(runId, callId);
  }

  start(entry: Omit<BrainJournalEntry, "outputJson" | "settledAt">): void {
    this.#entries.set(entry.runId, entry.callId, { ...entry });
  }

  settle(runId: string, callId: string, outputJson: string, settledAt: number): void {
    const entry = this.get(runId, callId);
    if (!entry) return;
    entry.outputJson = outputJson;
    entry.settledAt = settledAt;
  }

  /** Every entry, runs in insertion order and calls in dispatch order. */
  entries(): readonly BrainJournalEntry[] {
    return [...this.#entries.groups()].flatMap(([, run]) =>
      [...run.values()].map((entry) => ({ ...entry })),
    );
  }

  /** Drops one entry whose start could not be checkpointed, so it never reads as an action that ran. */
  forget(runId: string, callId: string): void {
    this.#entries.delete(runId, callId);
  }

  /** Drops the journals of the runs named, for the host's retention to call. */
  dropRuns(runIds: Iterable<string>): void {
    for (const runId of runIds) this.#entries.deleteOuter(runId);
  }
}
