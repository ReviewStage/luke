import type {
  BrainJournalEntry,
  BrainObservationEntry,
  BrainPersistedState,
  BrainRequestRecord,
  BrainTranscriptCursors,
  ResponsesInputItem,
} from "@sidecar/brain";
import type { TranscriptEvent } from "@sidecar/runtime-contracts";
import type { EnvelopeRead } from "./brain-envelope.js";

/**
 * How one envelope becomes the next in the database without rewriting every
 * row. The store composes whole envelopes; the repository client compares
 * each one with the last it saved and sends the difference, keyed the way the
 * tables are keyed. A delta names the generation it belongs to, and the
 * database applies it only while that generation stands there too — any
 * other envelope is saved whole, replacing whatever stood.
 */

export interface BrainItemsDelta {
  /** How many leading items are unchanged; everything after them is replaced by `append`. */
  keepPrefix: number;
  append: readonly ResponsesInputItem[];
}

export interface BrainRequestsDelta {
  /** Records to insert or replace, each with the position it holds in the envelope's list. */
  upsert: readonly { ordinal: number; record: BrainRequestRecord }[];
  remove: readonly string[];
}

export interface BrainJournalDelta {
  upsert: readonly { ordinal: number; entry: BrainJournalEntry }[];
  remove: readonly { runId: string; callId: string }[];
}

export interface BrainStateDelta {
  /** The generation's stamp, when this save sets, changes, or clears it. */
  checkpointFormat?: { stamp: string | undefined };
  items?: BrainItemsDelta;
  cursors?: BrainTranscriptCursors;
  captureCursors?: BrainTranscriptCursors;
  /** The inbox whole, when it changed; it is small by construction and replaced rather than diffed. */
  inbox?: readonly BrainObservationEntry[];
  requests?: BrainRequestsDelta;
  journal?: BrainJournalDelta;
}

export const SAVE_KIND = {
  /** A whole envelope replacing whatever generation stands, named as the one it expects to replace. */
  REPLACE: "replace",
  /** The difference from the last envelope saved, applied to the generation it names. */
  AMEND: "amend",
} as const;

export type SaveKind = (typeof SAVE_KIND)[keyof typeof SAVE_KIND];

/**
 * What one save carries, and the one generation id the database checks it
 * against. A replacement names the generation the writer believes stands —
 * or none — and lands only while exactly that one stands; an amendment
 * names the generation it changes, and lands only while that one stands. So
 * a writer whose picture is stale — a second handle, a checkpoint prepared
 * against a generation the store has since replaced — is refused, and never
 * turns "the database moved on" into a replacement of the newer generation.
 */
export type BrainStateSave = (
  | { kind: typeof SAVE_KIND.REPLACE; expectGeneration?: string; state: BrainPersistedState }
  | { kind: typeof SAVE_KIND.AMEND; generationId: string; delta: BrainStateDelta }
) & {
  /**
   * The transcript events the checkpoint carries with it, appended to the
   * conversation's retained transcript in the same transaction under the
   * generation the save lands in, so a checkpoint and its record of what
   * entered the context are one write or none.
   */
  transcript?: readonly TranscriptEvent[];
};

function sameJson<Value>(left: Value, right: Value): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function itemsDelta(
  previous: readonly ResponsesInputItem[],
  next: readonly ResponsesInputItem[],
): BrainItemsDelta | undefined {
  let keepPrefix = 0;
  while (
    keepPrefix < previous.length &&
    keepPrefix < next.length &&
    sameJson(previous[keepPrefix], next[keepPrefix])
  ) {
    keepPrefix += 1;
  }
  if (keepPrefix === previous.length && keepPrefix === next.length) return undefined;
  return { keepPrefix, append: next.slice(keepPrefix) };
}

function requestsDelta(
  previous: readonly BrainRequestRecord[],
  next: readonly BrainRequestRecord[],
): BrainRequestsDelta | undefined {
  const before = new Map(previous.map((record, ordinal) => [record.runId, { ordinal, record }]));
  const upsert: { ordinal: number; record: BrainRequestRecord }[] = [];
  const kept = new Set<string>();
  next.forEach((record, ordinal) => {
    kept.add(record.runId);
    const held = before.get(record.runId);
    if (held && held.ordinal === ordinal && sameJson(held.record, record)) return;
    upsert.push({ ordinal, record });
  });
  const remove = previous.filter((record) => !kept.has(record.runId)).map((r) => r.runId);
  return upsert.length === 0 && remove.length === 0 ? undefined : { upsert, remove };
}

function journalKey(entry: Pick<BrainJournalEntry, "runId" | "callId">): string {
  return JSON.stringify([entry.runId, entry.callId]);
}

function journalDelta(
  previous: readonly BrainJournalEntry[],
  next: readonly BrainJournalEntry[],
): BrainJournalDelta | undefined {
  const before = new Map(previous.map((entry, ordinal) => [journalKey(entry), { ordinal, entry }]));
  const upsert: { ordinal: number; entry: BrainJournalEntry }[] = [];
  const kept = new Set<string>();
  next.forEach((entry, ordinal) => {
    const key = journalKey(entry);
    kept.add(key);
    const held = before.get(key);
    if (held && held.ordinal === ordinal && sameJson(held.entry, entry)) return;
    upsert.push({ ordinal, entry });
  });
  const remove = previous
    .filter((entry) => !kept.has(journalKey(entry)))
    .map((entry) => ({ runId: entry.runId, callId: entry.callId }));
  return upsert.length === 0 && remove.length === 0 ? undefined : { upsert, remove };
}

/**
 * The save that turns `previous` into `next`: an amendment while both are
 * the same generation, the whole envelope otherwise. A generation's birth,
 * expiry, and marker never change within it, so an amendment carries none of
 * them. The generation a replacement expects to find is `observedGeneration`
 * — what the writer last saw standing in the database, decoded or not — so a
 * generation whose rows this build could not read is still named exactly,
 * and the repair that replaces it lands while a stale writer's save does not.
 */
export function brainStateSave(
  previous: BrainPersistedState | undefined,
  observedGeneration: string | undefined,
  next: BrainPersistedState,
): BrainStateSave {
  if (!previous || previous.generationId !== next.generationId) {
    return {
      kind: SAVE_KIND.REPLACE,
      ...(observedGeneration !== undefined ? { expectGeneration: observedGeneration } : undefined),
      state: next,
    };
  }
  const delta: BrainStateDelta = {};
  const items = itemsDelta(previous.items, next.items);
  if (items) delta.items = items;
  if (next.checkpointFormat !== previous.checkpointFormat) {
    delta.checkpointFormat = { stamp: next.checkpointFormat };
  }
  if (!sameJson(previous.cursors, next.cursors)) delta.cursors = next.cursors;
  if (!sameJson(previous.captureCursors, next.captureCursors)) {
    delta.captureCursors = next.captureCursors;
  }
  if (!sameJson(previous.inbox, next.inbox)) delta.inbox = next.inbox;
  const requests = requestsDelta(previous.requests, next.requests);
  if (requests) delta.requests = requests;
  const journal = journalDelta(previous.journal, next.journal);
  if (journal) delta.journal = journal;
  return { kind: SAVE_KIND.AMEND, generationId: next.generationId, delta };
}

/**
 * One writer's picture of the database, and the compare-and-set each of its
 * saves carries. The picture is what it last observed standing — loaded,
 * readable or not, or saved — so after every save that landed the tables
 * hold exactly the envelope given, and a save from a picture the database
 * has moved past is refused and leaves the picture as it was, refused the
 * same way until the writer observes again.
 */
export class EnvelopeTracker {
  #saved: BrainPersistedState | undefined;
  #observed: string | undefined;

  observe(read: EnvelopeRead): void {
    this.#saved = read.state;
    this.#observed = read.generation;
  }

  saveFor(next: BrainPersistedState, transcript?: readonly TranscriptEvent[]): BrainStateSave {
    const save = brainStateSave(this.#saved, this.#observed, next);
    return transcript && transcript.length > 0 ? { ...save, transcript } : save;
  }

  landed(next: BrainPersistedState): void {
    this.#saved = next;
    this.#observed = next.generationId;
  }
}
