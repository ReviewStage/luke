import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { type BrainJournalEntry, brainJournalEntryFromWire } from "./journal.js";
import {
  type BrainRequestRecord,
  brainRequestRecordFromWire,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import type { ResponsesInputItem } from "./responses-api.js";

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
  clearedAt: number;
  /** The erased generation, when the store knew one; a Clear pressed before any state was read carries the instant alone. */
  generationId?: string;
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
  // The lifetime is the build's, not the file's: an envelope claiming any
  // other span was not written by this rule and is not given one now.
  if (value.expiresAt - value.createdAt !== BRAIN_GENERATION_LIFETIME_MS) return undefined;
  if (!Array.isArray(value.items) || !isRecord(value.cursors)) return undefined;
  if (!Array.isArray(value.requests) || !Array.isArray(value.journal)) return undefined;
  const reset = resetMarkerFromWire(value.reset);
  if (reset === null || (reset && reset.clearedAt > value.createdAt)) return undefined;
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
  if (!isRecord(value) || !instant(value.clearedAt)) return null;
  if (value.generationId === undefined) return { clearedAt: value.clearedAt };
  if (!isWireString(value.generationId) || value.generationId.length === 0) return null;
  return { clearedAt: value.clearedAt, generationId: value.generationId };
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
  /** Whether the envelope still exceeds a bound — bytes or records — after everything eligible went. */
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
 * to. Both bounds prune only what is eligible and then report whether that
 * was enough, because what to do about an envelope that is still too large —
 * refuse the write that would grow it, or refuse the file at load — is the
 * writer's decision, not the retention's: nothing here touches a run still
 * going, a run whose end the thread has not yet taken, a journal, or the
 * model's own memory items. The count bounds records of every status
 * together, so however many runs stand at once the file never carries more
 * than the bound names.
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
  let excess = state.requests.length - bounds.MAXIMUM_TERMINAL_REQUESTS;
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
    oversized:
      bytes > bounds.MAXIMUM_SERIALIZED_BYTES ||
      retained.requests.length > bounds.MAXIMUM_TERMINAL_REQUESTS,
  };
}

/**
 * Where the envelope is kept, as one serialized record: the shape a test's
 * in-memory file has. Production keeps the envelope decomposed in the
 * runtime store instead, behind {@link BrainStateRepository}; this adapter
 * is how a record storage still satisfies that contract.
 */
export interface BrainStateStorage {
  read(): string | undefined | Promise<string | undefined>;
  /** Answers whether the write landed; a store that throws is read as one that did not. */
  write(contents: string): boolean | Promise<boolean>;
}

/** What a repository found: the envelope it holds, or nothing, or something it could not read. */
export interface BrainStateLoad {
  state?: BrainPersistedState;
  /** The repository holds content for the generation but this build cannot vouch for it. */
  unreadable?: boolean;
}

/**
 * The durable owner of the envelope, whatever it decomposes it into. The
 * store composes each envelope and asks the repository to make it the one
 * that stands, whole and atomically: after a save that answered true the
 * repository holds exactly the envelope given, and after one that answered
 * false or threw it holds what it held before. A repository whose writes
 * are asynchronous — a database on its own worker — fits the contract as
 * well as a file does, because the store serializes every write behind the
 * last and installs nothing in memory until the answer comes back.
 */
export interface BrainStateRepository {
  load(): BrainStateLoad | Promise<BrainStateLoad>;
  save(state: BrainPersistedState): boolean | Promise<boolean>;
}

/** A record storage as a repository: the whole envelope in one serialized record. */
export function brainStateRepositoryFromStorage(storage: BrainStateStorage): BrainStateRepository {
  return {
    async load() {
      const stored = await storage.read();
      if (stored === undefined) return {};
      const state = brainStateFromStored(stored);
      return state ? { state } : { unreadable: true };
    },
    save(state) {
      return storage.write(brainStateRecord(state));
    },
  };
}

export type BrainStateStoreOptions = (
  | { storage: BrainStateStorage; repository?: undefined }
  | { repository: BrainStateRepository; storage?: undefined }
) & {
  createGenerationId: () => string;
  now?: () => number;
  bounds?: BrainStateBounds;
  /** Hears the store's own housekeeping failures: a discard or expiry the disk would not take. */
  report?: (message: string) => void;
};

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
  readonly #repository: BrainStateRepository;
  readonly #createGenerationId: () => string;
  readonly #now: () => number;
  readonly #bounds: BrainStateBounds;
  readonly #report: (message: string) => void;
  #state: BrainPersistedState | undefined;
  #lease: BrainStoreLease | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #replacedListeners = new Set<(state: BrainPersistedState) => void>();

  constructor(options: BrainStateStoreOptions) {
    this.#repository = options.repository ?? brainStateRepositoryFromStorage(options.storage);
    this.#createGenerationId = options.createGenerationId;
    this.#now = options.now ?? Date.now;
    this.#bounds = options.bounds ?? BRAIN_STATE_BOUNDS;
    this.#report = options.report ?? (() => undefined);
  }

  /**
   * Reads the envelope once from storage; later calls answer the held copy.
   * What is read is admitted before anything sees it: a missing, foreign, or
   * malformed file, a generation past its time, and a valid envelope that
   * exceeds its bounds after every eligible ended run is let go all become a
   * fresh generation — nothing of them is read into memory — and an envelope
   * within bounds is held as retention leaves it. Whatever the file held that
   * the store did not admit is replaced on disk in the same load, so a
   * generation found dead or unreadable does not wait for a later write to
   * be gone; a disk that refuses the replacement is reported. A held copy is
   * judged again on every load, so an agent built after an idle stretch never
   * adopts a generation that died while nothing kept its timer.
   */
  load(): Promise<BrainPersistedState> {
    return this.#serialized(async () => {
      const held = this.#state;
      if (held) {
        if (!brainGenerationExpired(held, this.#now())) return held;
        const fresh = this.#begin(this.#now());
        await this.#persistHousekeeping(fresh, "the expired generation");
        return this.#state ?? fresh;
      }
      const loaded = await this.#load();
      // A Clear, expiry, or replacement that landed while the file was being
      // read is the newer truth: what the file held is not installed over
      // it, and the caller adopts what now stands.
      if (this.#state) return this.#state;
      const admitted = this.#admit(loaded);
      this.#state = admitted.state;
      if (admitted.rewrite) {
        this.#report(`Brain memory discarded ${admitted.rewrite}`);
        await this.#persistHousekeeping(admitted.state, admitted.rewrite);
      }
      return this.#state ?? admitted.state;
    });
  }

  /** Reads the repository once, taking a repository that throws as one holding nothing readable. */
  async #load(): Promise<BrainStateLoad> {
    try {
      return await this.#repository.load();
    } catch {
      return { unreadable: true };
    }
  }

  /** What a stored file becomes in memory, and whether the file must be rewritten to match. */
  #admit(loaded: BrainStateLoad): AdmittedBrainState {
    const now = this.#now();
    const read = loaded.state;
    if (!read) {
      return {
        state: freshBrainState(this.#createGenerationId(), now),
        ...(loaded.unreadable ? { rewrite: "an unreadable state file" } : undefined),
      };
    }
    if (brainGenerationExpired(read, now)) {
      return {
        state: freshBrainState(this.#createGenerationId(), now),
        rewrite: "the expired generation",
      };
    }
    const retained = retainedBrainState(read, this.#bounds);
    if (retained.oversized) {
      // Nothing this build writes exceeds its bounds with nothing left to
      // let go, so a file that does was not written under this rule; it is
      // refused whole rather than trimmed by guesswork.
      return {
        state: freshBrainState(this.#createGenerationId(), now),
        rewrite: "a state file past its bounds",
      };
    }
    return {
      state: retained.state,
      ...(retained.prunedRunIds.length > 0 ? { rewrite: "ended runs past retention" } : undefined),
    };
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
   * generation replaced, expired, or cleared never stands again, and it
   * stops standing the instant the replacement, expiry, or Clear is asked
   * for, before any disk is waited on.
   */
  holdsGeneration(generationId: string): boolean {
    return this.#state?.generationId === generationId;
  }

  /** The marker of the last Clear, while the generation carrying it stands. */
  resetMarker(): BrainResetMarker | undefined {
    return this.#state?.reset;
  }

  /**
   * Whether the generation named has room for one more record after
   * retention has let go of what it may. The count is a hard bound on the
   * file, so a run is refused at its door rather than accepted into an
   * envelope the store would then refuse to write.
   */
  admits(generationId: string): boolean {
    const held = this.#state;
    if (!held || held.generationId !== generationId) return false;
    const cap = this.#bounds.MAXIMUM_TERMINAL_REQUESTS;
    const withRoom = { ...this.#bounds, MAXIMUM_TERMINAL_REQUESTS: cap - 1 };
    return retainedBrainState(held, withRoom).state.requests.length < cap;
  }

  /**
   * Ends the standing generation if its lifetime has run out, beginning an
   * empty one in its place at once, and answers whether it did. The fence is
   * synchronous: by the time this returns, the old generation stands nowhere
   * in memory and every listener has heard the successor, so a turn holding
   * a model answer, a read, or an act's preparation finds itself revoked
   * before any disk is waited on. The write that carries the successor to
   * the file, replacing the old content, is queued behind the writes already
   * out; a disk that refuses it is reported, and the old content stays on
   * disk only until the next write that lands.
   */
  expireIfDue(now: number = this.#now()): boolean {
    const held = this.#state;
    if (!held || !brainGenerationExpired(held, now)) return false;
    const fresh = this.#begin(now);
    void this.#serialized(() => this.#persistHousekeeping(fresh, "the expired generation"));
    return true;
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
   * writers — false when the envelope would still exceed a bound after every
   * eligible ended run went and the write would grow it, and false when
   * storage refused, leaving the held copy as it was so the caller's own
   * memory and the file cannot silently disagree about what is known. A
   * fence raised while the write was out on disk is honored the same way: the
   * landed content is not installed over the successor, `committed` is not
   * called, and the caller hears false, because what it wrote belongs to a
   * generation that no longer stands.
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
      if (retained.oversized && grows(retained, held)) return false;
      if (!(await this.#persist(retained.state))) return false;
      if (this.#state !== held || !this.holdsLease(lease)) return false;
      this.#state = retained.state;
      committed?.({ prunedRunIds: retained.prunedRunIds });
      return true;
    });
  }

  /**
   * Replaces the envelope whole with the one given, a new generation
   * included, under the same rule as every other end of a generation: the
   * fence is synchronous — the replacement stands and is announced before
   * this returns — and its write is queued behind the writes already out. An
   * envelope past its bounds replaces nothing. Answers whether the write
   * landed; a later fence raised while it was out leaves it unwritten, the
   * newer truth carrying the file.
   */
  replace(state: BrainPersistedState): Promise<boolean> {
    const retained = retainedBrainState(state, this.#bounds);
    if (retained.oversized) return Promise.resolve(false);
    this.#state = retained.state;
    this.#announceReplaced(retained.state);
    return this.#serialized(async () => {
      if (this.#state !== retained.state) return false;
      return this.#persist(retained.state);
    });
  }

  /**
   * The Clear. The fence is synchronous: the standing generation is
   * forgotten in memory and every listener hears the empty successor before
   * this returns, so nothing of the old generation can checkpoint, publish,
   * deliver, or dispatch from here on, whatever the disk does next. The
   * successor carries a content-free marker of the erasure — the Clear's
   * instant, and the erased generation's id when one is known — and is then
   * written over the old content in one write, queued behind the writes
   * already out. A store that had not yet read its file learns the erased
   * generation's id from the file at that point, reading nothing else of it,
   * so a Clear pressed before any capability loaded the state still leaves
   * the marker behind. Answers whether the marker reached storage: when it
   * did not, the old generation is still gone from memory and fenced against
   * every late writer, but the file still holds it until the next write that
   * lands, and the caller must say the erasure did not complete rather than
   * that it did.
   */
  clear(now: number = this.#now()): Promise<boolean> {
    const held = this.#state;
    const fresh = this.#begin(now, {
      clearedAt: now,
      ...(held ? { generationId: held.generationId } : undefined),
    });
    return this.#serialized(async () => {
      let marker = fresh;
      if (!held && this.#state === fresh) {
        const prior = (await this.#load()).state?.generationId;
        if (prior && this.#state === fresh) {
          marker = { ...fresh, reset: { clearedAt: now, generationId: prior } };
          this.#state = marker;
        }
      }
      if (this.#state !== marker) return false;
      return this.#persist(marker);
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

  /** Begins a fresh generation in memory now and tells every listener; the disk is the caller's next step. */
  #begin(now: number, reset?: BrainResetMarker): BrainPersistedState {
    const fresh: BrainPersistedState = {
      ...freshBrainState(this.#createGenerationId(), now),
      ...(reset ? { reset } : undefined),
    };
    this.#state = fresh;
    this.#announceReplaced(fresh);
    return fresh;
  }

  /**
   * Writes a generation the store began on its own — at expiry, or in place
   * of a file it did not admit — unless a later fence has already superseded
   * it, in which case the later write carries the newer truth.
   */
  async #persistHousekeeping(state: BrainPersistedState, what: string): Promise<void> {
    if (this.#state !== state) return;
    if (!(await this.#persist(state))) {
      this.#report(`Brain memory could not replace ${what} on disk`);
    }
  }

  #announceReplaced(state: BrainPersistedState): void {
    for (const listener of [...this.#replacedListeners]) listener(state);
  }

  async #persist(state: BrainPersistedState): Promise<boolean> {
    try {
      return await this.#repository.save(state);
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

/** What a load admitted, and what the file held instead when it must be rewritten to match. */
interface AdmittedBrainState {
  state: BrainPersistedState;
  rewrite?: string;
}

/** Whether a retained envelope is larger than the one it would replace, in bytes or in records. */
function grows(retained: RetainedBrainState, held: BrainPersistedState): boolean {
  return (
    retained.bytes > recordBytes(brainStateRecord(held)) ||
    retained.state.requests.length > held.requests.length
  );
}
