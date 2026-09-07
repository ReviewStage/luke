import type {
  BrainJournalEntry,
  BrainPersistedState,
  BrainRequestRecord,
  BrainTranscriptCursors,
  ResponsesInputItem,
} from "@sidecar/brain";

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
  generationId: string;
  items?: BrainItemsDelta;
  cursors?: BrainTranscriptCursors;
  requests?: BrainRequestsDelta;
  journal?: BrainJournalDelta;
}

/**
 * What one save carries: the whole envelope, or the difference from the last
 * one saved, and in both cases the generation the writer believes stands in
 * the database — or none. The database applies a save only while exactly
 * that generation stands there, so a writer whose picture is stale — a
 * second handle, a checkpoint prepared against a generation the store has
 * since replaced — is refused, and never turns "the database moved on" into
 * a replacement of the newer generation. Replacing a generation on purpose
 * is a whole envelope that names the generation it replaces.
 */
export type BrainStateSave = { expectGeneration: string | undefined } & (
  | { full: BrainPersistedState }
  | { delta: BrainStateDelta }
);

function sameJson(left: unknown, right: unknown): boolean {
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
 * The save that turns `previous` into `next`: a delta while both are the same
 * generation, the whole envelope otherwise. A generation's birth, expiry, and
 * marker never change within it, so a delta carries none of them. The
 * generation the save expects to find is `observedGeneration` — what the
 * writer last saw standing in the database, decoded or not — so a generation
 * whose rows this build could not read is still named exactly, and the
 * repair that replaces it lands while a stale writer's save does not.
 */
export function brainStateSave(
  previous: BrainPersistedState | undefined,
  observedGeneration: string | undefined,
  next: BrainPersistedState,
): BrainStateSave {
  const expectGeneration = observedGeneration;
  if (!previous || previous.generationId !== next.generationId) {
    return { expectGeneration, full: next };
  }
  const delta: BrainStateDelta = { generationId: next.generationId };
  const items = itemsDelta(previous.items, next.items);
  if (items) delta.items = items;
  if (!sameJson(previous.cursors, next.cursors)) delta.cursors = next.cursors;
  const requests = requestsDelta(previous.requests, next.requests);
  if (requests) delta.requests = requests;
  const journal = journalDelta(previous.journal, next.journal);
  if (journal) delta.journal = journal;
  return { expectGeneration, delta };
}
