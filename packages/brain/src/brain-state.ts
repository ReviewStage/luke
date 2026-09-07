import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { type BrainJournalEntry, brainJournalEntryFromWire } from "./brain-journal.js";
import type { ResponsesInputItem } from "./brain-openai.js";
import {
  type BrainRequestRecord,
  brainRequestRecordFromWire,
  isTerminalBrainRequestStatus,
} from "./brain-requests.js";

/**
 * Everything the brain keeps across launches, in one envelope with one
 * writer. The envelope is a generation: it is born at a moment, it dies at a
 * fixed age or at the developer's Clear, and everything inside it — the
 * Responses input array from the latest compaction onward, the transcript
 * cursors, the request records, and the action journal — lives and dies
 * with it. A state file from another build or another shape reads as no
 * state, never as a fresh lifetime for old data.
 */

export const BRAIN_STATE_VERSION = 2;

/** How long a generation lives from its creation, whatever is written into it. */
export const BRAIN_GENERATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * How large a generation may grow. The request count bounds what the panel
 * and the model can be shown of ended runs; the byte cap bounds the file
 * itself, and is the one bound that can refuse a write: ended runs are let go
 * first, and a write that would still leave the envelope oversized is refused
 * rather than dropping anything that is not finished.
 */
export interface BrainStateBounds {
  readonly MAXIMUM_TERMINAL_REQUESTS: number;
  readonly MAXIMUM_SERIALIZED_BYTES: number;
}

export const BRAIN_STATE_BOUNDS: BrainStateBounds = {
  MAXIMUM_TERMINAL_REQUESTS: 200,
  MAXIMUM_SERIALIZED_BYTES: 8 * 1024 * 1024,
};

/**
 * What a Clear leaves behind in place of the generation it erased: the id of
 * the generation nothing may write into again, and the instant of the Clear,
 * before which no line of the conversation may stand. It carries no content of
 * either, and it rides inside the fresh generation that succeeds the erased
 * one until a later Clear or a new generation supersedes it.
 */
export interface BrainResetMarker {
  generationId: string;
  clearedAt: number;
}

export type BrainTranscriptCursors = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface BrainPersistedState {
  version: typeof BRAIN_STATE_VERSION;
  generationId: string;
  createdAt: number;
  expiresAt: number;
  items: readonly ResponsesInputItem[];
  /** Keyed by provider id, then by provider session id. */
  cursors: BrainTranscriptCursors;
  requests: readonly BrainRequestRecord[];
  journal: readonly BrainJournalEntry[];
  reset?: BrainResetMarker;
}

/** Whether a generation's lifetime has run out: at the expiry instant itself, and ever after. */
export function brainGenerationExpired(
  state: Pick<BrainPersistedState, "expiresAt">,
  now: number,
): boolean {
  return now >= state.expiresAt;
}

/** An empty generation born now. */
export function freshBrainState(generationId: string, now: number): BrainPersistedState {
  return {
    version: BRAIN_STATE_VERSION,
    generationId,
    createdAt: now,
    expiresAt: now + BRAIN_GENERATION_LIFETIME_MS,
    items: [],
    cursors: {},
    requests: [],
    journal: [],
  };
}

/** Reads a persisted state, or nothing when the file is from another build or malformed. */
export function brainPersistedStateFromWire(
  value: UnparsedWireValue,
): BrainPersistedState | undefined {
  if (!isRecord(value) || value.version !== BRAIN_STATE_VERSION) return undefined;
  if (!isWireString(value.generationId) || value.generationId.length === 0) return undefined;
  if (!instant(value.createdAt) || !instant(value.expiresAt)) return undefined;
  if (!Array.isArray(value.items) || !isRecord(value.cursors)) return undefined;
  if (!Array.isArray(value.requests) || !Array.isArray(value.journal)) return undefined;
  const reset = resetMarkerFromWire(value.reset);
  if (reset === null) return undefined;
  const items: ResponsesInputItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) return undefined;
    items.push(item);
  }
  const cursors: Record<string, Record<string, string>> = {};
  for (const [providerId, sessions] of Object.entries(value.cursors)) {
    if (!isRecord(sessions)) return undefined;
    const provider: Record<string, string> = {};
    for (const [providerSessionId, cursor] of Object.entries(sessions)) {
      if (!isWireString(cursor)) return undefined;
      provider[providerSessionId] = cursor;
    }
    cursors[providerId] = provider;
  }
  const requests: BrainRequestRecord[] = [];
  for (const request of value.requests) {
    const record = brainRequestRecordFromWire(request);
    if (!record) return undefined;
    requests.push(record);
  }
  const journal: BrainJournalEntry[] = [];
  for (const entry of value.journal) {
    const parsed = brainJournalEntryFromWire(entry);
    if (!parsed) return undefined;
    journal.push(parsed);
  }
  return {
    version: BRAIN_STATE_VERSION,
    generationId: value.generationId,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    items,
    cursors,
    requests,
    journal,
    ...(reset ? { reset } : undefined),
  };
}

/** The marker as stored, nothing when absent, and null when present but unreadable. */
function resetMarkerFromWire(value: UnparsedWireValue): BrainResetMarker | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (!isWireString(value.generationId) || value.generationId.length === 0) return null;
  if (!instant(value.clearedAt)) return null;
  return { generationId: value.generationId, clearedAt: value.clearedAt };
}

function instant(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

/** The record the state persists as. */
export function brainStateRecord(state: BrainPersistedState): string {
  return `${JSON.stringify(state)}\n`;
}

/** Reads a stored record back, or nothing for a missing, unparseable, or foreign file. */
export function brainStateFromStored(stored: string | undefined): BrainPersistedState | undefined {
  if (stored === undefined) return undefined;
  try {
    // SAFETY: JSON.parse returns a wire value; the reader is the validation.
    return brainPersistedStateFromWire(JSON.parse(stored) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}

/**
 * Whether an ended run may be let go of. Only an ended run whose end the host
 * has already written into its own thread: the thread is where the words
 * outlive the record, so a record still waiting to be written there is kept
 * however old it is, and a run still going is never eligible at all.
 */
export function brainRequestPrunable(record: BrainRequestRecord): boolean {
  return isTerminalBrainRequestStatus(record.status) && record.historyRecordedAt !== undefined;
}

/** An envelope held to its bounds, and which runs were let go to get there. */
export interface RetainedBrainState {
  state: BrainPersistedState;
  prunedRunIds: readonly string[];
  /** The serialized record's size in bytes, measured once for the write that follows. */
  record: string;
  bytes: number;
  /** Whether the envelope still exceeds the byte cap after everything eligible went. */
  oversized: boolean;
}

function recordBytes(record: string): number {
  return new TextEncoder().encode(record).length;
}

function withoutRuns(state: BrainPersistedState, runIds: ReadonlySet<string>): BrainPersistedState {
  return {
    ...state,
    requests: state.requests.filter((record) => !runIds.has(record.runId)),
    journal: state.journal.filter((entry) => !runIds.has(entry.runId)),
  };
}

/**
 * Applies both bounds, oldest ended runs going first and each run's journal
 * going with its record, so a call is never left without the run it belonged
 * to. The count is applied outright; the byte cap prunes only what is
 * eligible and then reports whether that was enough, because what to do about
 * an envelope that is still too large is the writer's decision, not the
 * retention's: nothing here touches a run still going, its journal, or the
 * model's own memory items.
 */
export function retainedBrainState(
  state: BrainPersistedState,
  bounds: BrainStateBounds = BRAIN_STATE_BOUNDS,
): RetainedBrainState {
  const eligible = state.requests
    .filter(brainRequestPrunable)
    .sort(
      (left, right) =>
        (left.settledAt ?? left.acceptedAt) - (right.settledAt ?? right.acceptedAt) ||
        left.acceptedAt - right.acceptedAt,
    );
  const pruned = new Set<string>();
  const terminal = state.requests.filter((record) => isTerminalBrainRequestStatus(record.status));
  let excess = terminal.length - bounds.MAXIMUM_TERMINAL_REQUESTS;
  for (const record of eligible) {
    if (excess <= 0) break;
    pruned.add(record.runId);
    excess -= 1;
  }
  let retained = pruned.size > 0 ? withoutRuns(state, pruned) : state;
  let record = brainStateRecord(retained);
  let bytes = recordBytes(record);
  for (const candidate of eligible) {
    if (bytes <= bounds.MAXIMUM_SERIALIZED_BYTES) break;
    if (pruned.has(candidate.runId)) continue;
    pruned.add(candidate.runId);
    retained = withoutRuns(state, pruned);
    record = brainStateRecord(retained);
    bytes = recordBytes(record);
  }
  return {
    state: retained,
    prunedRunIds: [...pruned],
    record,
    bytes,
    oversized: bytes > bounds.MAXIMUM_SERIALIZED_BYTES,
  };
}

/** Where the envelope is kept: one file's worth of read, write, and remove, however the host does them. */
export interface BrainStateStorage {
  read(): string | undefined | Promise<string | undefined>;
  /** Answers whether the write landed; a store that throws is read as one that did not. */
  write(contents: string): boolean | Promise<boolean>;
  remove(): boolean | Promise<boolean>;
}

export interface BrainStateStoreOptions {
  storage: BrainStateStorage;
  createGenerationId: () => string;
  now?: () => number;
  bounds?: BrainStateBounds;
}

/**
 * Who may write through the store right now. Each agent built on the store
 * takes the lease at construction; taking it releases every earlier holder, so
 * a replaced agent's late checkpoint — drained or not — lands nowhere once its
 * successor holds the store, even inside the same generation.
 */
export interface BrainStoreLease {
  readonly holder: symbol;
}

/** What the store tells a writer once its write has landed: which runs retention let go of. */
export interface BrainWriteCommit {
  prunedRunIds: readonly string[];
}

/**
 * The one writer of the brain's state. Every write is serialized behind the
 * last, so two callers cannot interleave half-envelopes; every write names
 * the generation it believes it is writing, so a write prepared against a
 * generation that has since been replaced, expired, or cleared lands nowhere.
 * The store holds the envelope in memory between writes, and answers whether
 * each write reached storage, because the caller decides what a failed
 * checkpoint means for the act it guards.
 *
 * The store also owns the generation's two ends. Its lifetime is fixed at
 * birth and checked at load, on demand, and never moved by a write, so an
 * envelope written into for a fortnight still dies on the day it was born to.
 * A Clear replaces the generation with an empty one carrying a content-free
 * marker of the erasure, in one write, so the moment the marker is durable the
 * old content is gone from the same file; a marker the storage refused still
 * fences the old generation in memory, and the caller is told the erasure did
 * not complete.
 */
export class BrainStateStore {
  readonly #storage: BrainStateStorage;
  readonly #createGenerationId: () => string;
  readonly #now: () => number;
  readonly #bounds: BrainStateBounds;
  #state: BrainPersistedState | undefined;
  #lease: BrainStoreLease | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #replacedListeners = new Set<(state: BrainPersistedState) => void>();

  constructor(options: BrainStateStoreOptions) {
    this.#storage = options.storage;
    this.#createGenerationId = options.createGenerationId;
    this.#now = options.now ?? Date.now;
    this.#bounds = options.bounds ?? BRAIN_STATE_BOUNDS;
  }

  /**
   * Reads the envelope once from storage; later calls answer the held copy.
   * A missing or foreign file becomes a fresh generation in memory, written
   * only when something is first checkpointed into it. So does a file whose
   * generation has died: nothing of it is read into memory, its marker
   * included, because a lifetime that ended is not extended by being found.
   */
  load(): Promise<BrainPersistedState> {
    return this.#serialized(async () => {
      const held = this.#state;
      if (held) {
        // A generation held across a stretch with no agent to keep its timer
        // is judged again here, so the agent built next never adopts a dead one.
        if (!brainGenerationExpired(held, this.#now())) return held;
        this.#state = freshBrainState(this.#createGenerationId(), this.#now());
        return this.#state;
      }
      let stored: string | undefined;
      try {
        stored = await this.#storage.read();
      } catch {
        stored = undefined;
      }
      const read = brainStateFromStored(stored);
      this.#state =
        read && !brainGenerationExpired(read, this.#now())
          ? read
          : freshBrainState(this.#createGenerationId(), this.#now());
      return this.#state;
    });
  }

  /** Takes the write lease, releasing whoever held it. */
  lease(): BrainStoreLease {
    this.#lease = { holder: Symbol("brain store lease") };
    return this.#lease;
  }

  holdsLease(lease: BrainStoreLease): boolean {
    return this.#lease === lease;
  }

  /** The envelope as last loaded or written, or nothing before the first load. */
  current(): BrainPersistedState | undefined {
    return this.#state;
  }

  generationId(): string | undefined {
    return this.#state?.generationId;
  }

  /**
   * Whether the generation named is the one that stands: the fence every
   * late arrival is checked against — a model answer, an act's result, a
   * delivery claim, a history line — before it may have an effect. A
   * generation replaced, expired, or cleared never stands again.
   */
  holdsGeneration(generationId: string): boolean {
    return this.#state?.generationId === generationId;
  }

  /** The marker of the last Clear, while the generation carrying it stands. */
  resetMarker(): BrainResetMarker | undefined {
    return this.#state?.reset;
  }

  /**
   * Ends the standing generation if its lifetime has run out, beginning an
   * empty one in its place, and answers whether it did. Called by the agent
   * before it opens any turn and from the timer it arms at the generation's
   * expiry, so a generation dies on time whether or not anything is written
   * into it. The old content leaves the file with the same write that begins
   * the new generation; a write the storage refuses leaves the old content on
   * disk for the next successful write to replace, but never back in memory.
   */
  expireIfDue(now: number = this.#now()): Promise<boolean> {
    return this.#serialized(async () => {
      const held = this.#state;
      if (!held || !brainGenerationExpired(held, now)) return false;
      const fresh = freshBrainState(this.#createGenerationId(), now);
      await this.#persist(fresh);
      this.#state = fresh;
      this.#announceReplaced(fresh);
      return true;
    });
  }

  /**
   * Writes a new envelope of the generation named, under the lease given.
   * `mutate` runs inside the store's queue, once every earlier write has
   * settled, so an envelope composed there from live state includes every
   * earlier save; `committed` runs in the same queue step once the write has
   * landed, before any later write composes, so what it applies to live state
   * is in every later envelope — including which runs retention let go of,
   * so the writer's own copy lets go of them too and no later save brings
   * them back. Answers false without touching storage when that generation
   * is no longer the store's, or the lease has passed to a later agent — the
   * fences a Clear, an expiry, a replacement, and a rebuild raise against late
   * writers — false when the envelope would still exceed its byte cap after
   * every eligible ended run went and the write would grow it, and false when
   * storage refused, leaving the held copy as it was so the caller's own
   * memory and the file cannot silently disagree about what is known.
   */
  write(
    lease: BrainStoreLease,
    generationId: string,
    mutate: (
      state: BrainPersistedState,
    ) => Omit<
      BrainPersistedState,
      "version" | "generationId" | "createdAt" | "expiresAt" | "reset"
    >,
    committed?: (commit: BrainWriteCommit) => void,
  ): Promise<boolean> {
    return this.#serialized(async () => {
      const held = this.#state;
      if (!this.holdsLease(lease) || !held || held.generationId !== generationId) return false;
      const composed: BrainPersistedState = {
        ...mutate(held),
        version: BRAIN_STATE_VERSION,
        generationId: held.generationId,
        createdAt: held.createdAt,
        expiresAt: held.expiresAt,
        ...(held.reset ? { reset: held.reset } : undefined),
      };
      const retained = retainedBrainState(composed, this.#bounds);
      if (retained.oversized && retained.bytes > recordBytes(brainStateRecord(held))) return false;
      if (!(await this.#persistRecord(retained.record))) return false;
      this.#state = retained.state;
      committed?.({ prunedRunIds: retained.prunedRunIds });
      return true;
    });
  }

  /** Replaces the envelope whole with the one given, a new generation included. */
  replace(state: BrainPersistedState): Promise<boolean> {
    return this.#serialized(async () => {
      const retained = retainedBrainState(state, this.#bounds);
      if (retained.oversized) return false;
      if (!(await this.#persistRecord(retained.record))) return false;
      this.#state = retained.state;
      this.#announceReplaced(retained.state);
      return true;
    });
  }

  /**
   * The Clear: the standing generation is fenced and forgotten in memory
   * first, then an empty generation carrying the marker of the erasure is
   * written over it — one write, so the file never holds the old content
   * beside the marker — and every listener hears the new generation so runs
   * of the old one stand down. Answers whether the marker reached storage:
   * when it did not, the old generation is still gone from memory and fenced
   * against every late writer, but the file still holds it until the next
   * successful write, and the caller must say the erasure did not complete
   * rather than that it did.
   */
  clear(now: number = this.#now()): Promise<boolean> {
    return this.#serialized(async () => {
      const held = this.#state;
      const fresh: BrainPersistedState = {
        ...freshBrainState(this.#createGenerationId(), now),
        ...(held ? { reset: { generationId: held.generationId, clearedAt: now } } : undefined),
      };
      this.#state = fresh;
      this.#announceReplaced(fresh);
      return this.#persist(fresh);
    });
  }

  /** Hears every replacement, expiry, or Clear, with the generation that now stands. */
  onReplaced(listener: (state: BrainPersistedState) => void): () => void {
    this.#replacedListeners.add(listener);
    return () => {
      this.#replacedListeners.delete(listener);
    };
  }

  /** Settles once every write queued so far has landed or been refused. */
  async flush(): Promise<void> {
    await this.#queue;
  }

  #announceReplaced(state: BrainPersistedState): void {
    for (const listener of this.#replacedListeners) listener(state);
  }

  #persist(state: BrainPersistedState): Promise<boolean> {
    return this.#persistRecord(brainStateRecord(state));
  }

  async #persistRecord(record: string): Promise<boolean> {
    try {
      return await this.#storage.write(record);
    } catch {
      return false;
    }
  }

  #serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}
