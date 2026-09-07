import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { type BrainJournalEntry, brainJournalEntryFromWire } from "./brain-journal.js";
import type { ResponsesInputItem } from "./brain-openai.js";
import { type BrainRequestRecord, brainRequestRecordFromWire } from "./brain-requests.js";

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
  };
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
}

/**
 * The one writer of the brain's state. Every write is serialized behind the
 * last, so two callers cannot interleave half-envelopes; every write names
 * the generation it believes it is writing, so a write prepared against a
 * generation that has since been replaced or reset lands nowhere. The store
 * holds the envelope in memory between writes, and answers whether each
 * write reached storage, because the caller decides what a failed checkpoint
 * means for the act it guards.
 */
/**
 * Who may write through the store right now. Each agent built on the store
 * takes the lease at construction; taking it releases every earlier holder, so
 * a replaced agent's late checkpoint — drained or not — lands nowhere once its
 * successor holds the store, even inside the same generation.
 */
export interface BrainStoreLease {
  readonly holder: symbol;
}

export class BrainStateStore {
  readonly #storage: BrainStateStorage;
  readonly #createGenerationId: () => string;
  readonly #now: () => number;
  #state: BrainPersistedState | undefined;
  #lease: BrainStoreLease | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #replacedListeners = new Set<(state: BrainPersistedState) => void>();

  constructor(options: BrainStateStoreOptions) {
    this.#storage = options.storage;
    this.#createGenerationId = options.createGenerationId;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Reads the envelope once from storage; later calls answer the held copy.
   * A missing or foreign file becomes a fresh generation in memory, written
   * only when something is first checkpointed into it.
   */
  load(): Promise<BrainPersistedState> {
    return this.#serialized(async () => {
      if (this.#state) return this.#state;
      let stored: string | undefined;
      try {
        stored = await this.#storage.read();
      } catch {
        stored = undefined;
      }
      this.#state =
        brainStateFromStored(stored) ?? freshBrainState(this.#createGenerationId(), this.#now());
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
   * Writes a new envelope of the generation named, under the lease given.
   * `mutate` runs inside the store's queue, once every earlier write has
   * settled, so an envelope composed there from live state includes every
   * earlier save; `committed` runs in the same queue step once the write has
   * landed, before any later write composes, so what it applies to live state
   * is in every later envelope. Answers false without touching storage when
   * that generation is no longer the store's, or the lease has passed to a
   * later agent — the fences a reset, a replacement, and a rebuild raise
   * against late writers — and false
   * when storage refused, leaving the held copy as it was so the caller's
   * own memory and the file cannot silently disagree about what is known.
   */
  write(
    lease: BrainStoreLease,
    generationId: string,
    mutate: (
      state: BrainPersistedState,
    ) => Omit<BrainPersistedState, "version" | "generationId" | "createdAt" | "expiresAt">,
    committed?: () => void,
  ): Promise<boolean> {
    return this.#serialized(async () => {
      const held = this.#state;
      if (!this.holdsLease(lease) || !held || held.generationId !== generationId) return false;
      const next: BrainPersistedState = {
        ...mutate(held),
        version: BRAIN_STATE_VERSION,
        generationId: held.generationId,
        createdAt: held.createdAt,
        expiresAt: held.expiresAt,
      };
      if (!(await this.#persist(next))) return false;
      this.#state = next;
      committed?.();
      return true;
    });
  }

  /** Replaces the envelope whole with the one given, a new generation included. */
  replace(state: BrainPersistedState): Promise<boolean> {
    return this.#serialized(async () => {
      if (!(await this.#persist(state))) return false;
      this.#state = state;
      this.#announceReplaced(state);
      return true;
    });
  }

  /**
   * Discards the envelope and begins a fresh generation: the file goes, the
   * held copy becomes empty, and every listener hears the new generation so
   * runs of the old one can stand down.
   */
  reset(): Promise<boolean> {
    return this.#serialized(async () => {
      let removed: boolean;
      try {
        removed = await this.#storage.remove();
      } catch {
        removed = false;
      }
      if (!removed) return false;
      this.#state = freshBrainState(this.#createGenerationId(), this.#now());
      this.#announceReplaced(this.#state);
      return true;
    });
  }

  /** Hears every replacement or reset, with the generation that now stands. */
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

  async #persist(state: BrainPersistedState): Promise<boolean> {
    try {
      return await this.#storage.write(brainStateRecord(state));
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
