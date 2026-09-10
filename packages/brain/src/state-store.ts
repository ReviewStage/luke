import { checkpointFormatTag, type TranscriptEvent } from "@sidecar/runtime/vocabulary";
import { Emitter, type Event } from "@sidecar/wire";
import {
  BRAIN_STATE_VERSION,
  type BrainPersistedState,
  type BrainResetMarker,
  type BrainStateLoad,
  type BrainStateMutation,
  type BrainStateRepository,
  type BrainStoreLease,
  type BrainWriteCommit,
  brainGenerationExpired,
  freshBrainState,
  MAXIMUM_TERMINAL_REQUESTS,
  retainedBrainState,
} from "./envelope.js";
import type { Generation } from "./generation.js";
import type { BrainObservationEntry } from "./observation-inbox.js";
import type { BrainRecordChange, BrainRequestRecord } from "./requests.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";

export type BrainStateStoreOptions = {
  repository: BrainStateRepository;
  createGenerationId: () => string;
  now?: () => number;
  /** Enforce the stamped deadline. Off by default, as OpenClaw's session reset policy is `none`. */
  automaticReset?: boolean;
  /** Hears the store's own housekeeping failures: a discard or expiry the disk would not take. */
  report?: (message: string) => void;
};

/**
 * The one writer of the brain's state. Every write is serialized behind the
 * last, so two callers cannot interleave half-envelopes; every write names
 * the generation it believes it is writing, so a write prepared against a
 * generation that has since been replaced, expired, or cleared lands nowhere.
 * The store holds the envelope in memory between writes, and answers whether
 * each write reached storage, because the caller decides what a failed
 * checkpoint means for the action it guards.
 *
 * The store also owns the generation's two ends. Every generation is stamped
 * with a deadline at birth that no write moves, but by default nothing
 * enforces it: a generation stands until an explicit replacement, however old
 * its checkpoint, matching OpenClaw's default of no automatic reset. Only a
 * store constructed with `automaticReset` checks the deadline at load and on
 * demand.
 * A Clear replaces the generation with an empty one carrying a content-free
 * marker of the erasure, in one write, so the moment the marker is durable the
 * old content is gone from the same file; a marker the storage refused still
 * fences the old generation in memory, and the caller is told the erasure did
 * not complete.
 */
export class BrainStateStore {
  readonly automaticReset: boolean;
  readonly #repository: BrainStateRepository;
  readonly #createGenerationId: () => string;
  readonly #now: () => number;
  readonly #report: (message: string) => void;
  #state: BrainPersistedState | undefined;
  #lease: BrainStoreLease | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #replaced = new Emitter<BrainPersistedState>();
  /** Hears every replacement, expiry, or Clear, with the generation that now stands. */
  readonly onReplaced: Event<BrainPersistedState> = this.#replaced.event;

  constructor(options: BrainStateStoreOptions) {
    this.automaticReset = options.automaticReset ?? false;
    this.#repository = options.repository;
    this.#createGenerationId = options.createGenerationId;
    this.#now = options.now ?? Date.now;
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
        if (!this.automaticReset || !brainGenerationExpired(held, this.#now())) return held;
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
    if (this.automaticReset && brainGenerationExpired(read, now)) {
      return {
        state: freshBrainState(this.#createGenerationId(), now),
        rewrite: "the expired generation",
      };
    }
    const retained = retainedBrainState(read);
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
   * late arrival is checked against — a model answer, an action's result, a
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
    // One place kept open is what asks whether one more record would fit.
    return (
      retainedBrainState(held, MAXIMUM_TERMINAL_REQUESTS - 1).state.requests.length <
      MAXIMUM_TERMINAL_REQUESTS
    );
  }

  /**
   * Ends the standing generation if its lifetime has run out, beginning an
   * empty one in its place at once, and answers whether it did. The fence is
   * synchronous: by the time this returns, the old generation stands nowhere
   * in memory and every listener has heard the successor, so a turn holding
   * a model answer, a read, or an action's preparation finds itself revoked
   * before any disk is waited on. The write that carries the successor to
   * the file, replacing the old content, is queued behind the writes already
   * out; a disk that refuses it is reported, and the old content stays on
   * disk only until the next write that lands.
   */
  expireIfDue(now: number = this.#now()): boolean {
    const held = this.#state;
    if (!this.automaticReset || !held || !brainGenerationExpired(held, now)) return false;
    const fresh = this.#begin(now);
    void this.#serialized(() => this.#persistHousekeeping(fresh, "the expired generation"));
    return true;
  }

  /**
   * Every envelope a save composes is composed here, inside the store's
   * serialized queue and from the store's committed state — never from a
   * copy taken before entering the queue, and never from live state the save
   * does not own — so a save can only add what it owns to what the saves
   * before it kept. Everything a save then applies to live working state —
   * the retained transcript count, the new inbox, the runs retention let go
   * of, and the owned record's fields — is applied in the same queue step,
   * after the write has landed and before any later write composes. The four
   * methods below are the only ways in, so no caller can put the two halves
   * anywhere else.
   */

  /**
   * A turn's or an action's checkpoint: the working context, cursors, and
   * journal this turn owns become the committed ones, together with the run's
   * own accounting when a run owns the turn, and the inbox loses exactly the
   * entries the turn consumed. Nothing else changes: every other record stays
   * as committed, so a request accepted or marked meanwhile is untouched and
   * a request still provisional is not published.
   */
  saveWorking(
    lease: BrainStoreLease,
    generation: Generation,
    working: {
      context: RecordingContextEngine;
      record?: BrainRecordChange;
      /** The inbox entries the turn consumed, gone from the inbox in the same write as the checkpoint. */
      consumes?: readonly string[];
    },
  ): Promise<BrainSaveResult> {
    const { context, record, consumes } = working;
    const pruned: string[] = [];
    let carried = 0;
    let inbox: readonly BrainObservationEntry[] | undefined;
    let owned: BrainRequestRecord | undefined;
    let missing = false;
    return saveResult(
      pruned,
      () => missing,
      this.write(
        lease,
        generation.id,
        (state) => {
          const checkpoint = context.checkpoint();
          const transcript = context.pending();
          carried = transcript.length;
          if (consumes) {
            const consumed = new Set(consumes);
            inbox = state.inbox.filter((entry) => !consumed.has(entry.id));
          }
          const changed = record ? changedRequests(state.requests, record) : undefined;
          owned = changed?.owned;
          missing = changed?.missing ?? false;
          return {
            checkpointFormat: checkpointFormatTag(checkpoint.format),
            items: checkpoint.items,
            compactionCount: generation.compactionCount,
            cursors: generation.cursors.persisted(),
            captureCursors: state.captureCursors,
            inbox: inbox ?? state.inbox,
            journal: generation.journal.entries(),
            requests: changed?.requests ?? state.requests,
            ...(transcript.length > 0 ? { transcript } : undefined),
          };
        },
        (commit) => {
          if (carried > 0) context.retained(carried);
          if (inbox) generation.inbox = inbox;
          this.#prune(generation, commit, pruned);
          applyOwned(generation, owned, record);
        },
      ),
    );
  }

  /**
   * A staged write of some fields of one record, owning nothing else: the
   * envelope is the store's committed state with the fields applied to that
   * record alone, and the live record takes them in the same queue step once
   * the store has — so no save assembled from older state can follow and undo
   * them, nothing reads the fields before they are kept, and nothing of any
   * other record or of a turn still in flight rides along.
   */
  saveRecord(
    lease: BrainStoreLease,
    generation: Generation,
    change: BrainRecordChange,
  ): Promise<BrainSaveResult> {
    const pruned: string[] = [];
    let owned: BrainRequestRecord | undefined;
    let missing = false;
    return saveResult(
      pruned,
      () => missing,
      this.write(
        lease,
        generation.id,
        (state) => {
          const changed = changedRequests(state.requests, change);
          owned = changed.owned;
          missing = changed.missing;
          return { ...mutableOf(state), requests: changed.requests };
        },
        (commit) => {
          this.#prune(generation, commit, pruned);
          applyOwned(generation, owned, change);
        },
      ),
    );
  }

  /**
   * The restore's alone: the working requests whole, carrying the context
   * only when the runtime loaded one. A generation whose checkpoint this
   * runtime could not load carries the stored items and stamp exactly as
   * committed — the memory is kept, never rewritten by a runtime that cannot
   * read it.
   */
  saveWhole(
    lease: BrainStoreLease,
    generation: Generation,
    context: RecordingContextEngine | undefined,
  ): Promise<BrainSaveResult> {
    const pruned: string[] = [];
    let carried = 0;
    return saveResult(
      pruned,
      undefined,
      this.write(
        lease,
        generation.id,
        (state) => {
          const checkpoint = context?.checkpoint();
          const transcript = context?.pending() ?? [];
          carried = transcript.length;
          return {
            ...(checkpoint
              ? { checkpointFormat: checkpointFormatTag(checkpoint.format) }
              : state.checkpointFormat !== undefined
                ? { checkpointFormat: state.checkpointFormat }
                : undefined),
            items: checkpoint ? checkpoint.items : state.items,
            compactionCount: context ? generation.compactionCount : state.compactionCount,
            cursors: context ? generation.cursors.persisted() : state.cursors,
            captureCursors: generation.captureCursors.persisted(),
            inbox: state.inbox,
            journal: context ? generation.journal.entries() : state.journal,
            requests: [...generation.requests.values()].map((record) => ({ ...record })),
            ...(transcript.length > 0 ? { transcript } : undefined),
          };
        },
        (commit) => {
          if (carried > 0) context?.retained(carried);
          this.#prune(generation, commit, pruned);
        },
      ),
    );
  }

  /**
   * Observations captured into the inbox, with the capture cursors they
   * advanced. The inbox is composed from the committed list, so a capture
   * landing during a turn is neither lost nor consumed early, and nothing
   * captured is let go of before a turn has read it.
   */
  saveCapture(
    lease: BrainStoreLease,
    generation: Generation,
    entries: readonly BrainObservationEntry[],
  ): Promise<BrainSaveResult> {
    const pruned: string[] = [];
    let inbox: readonly BrainObservationEntry[] = [];
    return saveResult(
      pruned,
      undefined,
      this.write(
        lease,
        generation.id,
        (state) => {
          inbox = [...state.inbox, ...entries];
          return {
            ...mutableOf(state),
            captureCursors: generation.captureCursors.persisted(),
            inbox,
          };
        },
        (commit) => {
          generation.inbox = inbox;
          this.#prune(generation, commit, pruned);
        },
      ),
    );
  }

  /**
   * Retention decided inside the same queue step: the runs the store let go
   * of leave the working copy too, or the next checkpoint of the journal
   * would write them straight back.
   */
  #prune(generation: Generation, commit: BrainWriteCommit, pruned: string[]): void {
    if (commit.prunedRunIds.length === 0) return;
    for (const runId of commit.prunedRunIds) generation.requests.delete(runId);
    generation.journal.dropRuns(commit.prunedRunIds);
    pruned.push(...commit.prunedRunIds);
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
    mutate: (state: BrainPersistedState) => BrainStateMutation,
    committed?: (commit: BrainWriteCommit) => void,
  ): Promise<boolean> {
    return this.#serialized(async () => {
      const held = this.#state;
      if (!this.holdsLease(lease) || !held || held.generationId !== generationId) return false;
      const { transcript, ...mutated } = mutate(held);
      const composed: BrainPersistedState = {
        ...mutated,
        version: BRAIN_STATE_VERSION,
        generationId: held.generationId,
        createdAt: held.createdAt,
        expiresAt: held.expiresAt,
        ...(held.reset ? { reset: held.reset } : undefined),
      };
      const retained = retainedBrainState(composed);
      // A write that would still leave the envelope over its bound is
      // refused rather than dropping a run still going or its journal; one
      // that shrinks it toward the bound is let through.
      if (retained.oversized && retained.state.requests.length > held.requests.length) {
        return false;
      }
      if (!(await this.#persist(retained.state, transcript))) return false;
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
    const retained = retainedBrainState(state);
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
    this.#replaced.fire(state);
  }

  async #persist(
    state: BrainPersistedState,
    transcript?: readonly TranscriptEvent[],
  ): Promise<boolean> {
    try {
      return await this.#repository.save(state, transcript);
    } catch {
      return false;
    }
  }

  /**
   * Start fresh: the standing generation is replaced by an empty one, born
   * now, and nothing else changes. The fence is the same synchronous one a
   * Clear raises — the old generation stands nowhere in memory and every
   * listener has heard the successor before this returns — but the successor
   * carries no marker, because nothing is erased: the conversation's history
   * and transcript stay as they were, attributed to the lifetime that wrote
   * them, and the model simply begins its next turn from nothing. Answers
   * whether the successor reached storage.
   */
  reset(now: number = this.#now()): Promise<boolean> {
    const fresh = this.#begin(now);
    return this.#serialized(async () => {
      if (this.#state !== fresh) return false;
      return this.#persist(fresh);
    });
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

/** What a save came to: whether it landed whole, and the runs retention let go of on the way. */
export interface BrainSaveResult {
  /** The envelope landed and the save owned every record it named. */
  readonly saved: boolean;
  readonly prunedRunIds: readonly string[];
}

async function saveResult(
  pruned: readonly string[],
  missing: (() => boolean) | undefined,
  written: Promise<boolean>,
): Promise<BrainSaveResult> {
  const landed = await written;
  return { saved: landed && !(missing?.() ?? false), prunedRunIds: pruned };
}

/** The envelope's mutable fields exactly as committed, for a save that owns none of them. */
function mutableOf(state: BrainPersistedState): BrainStateMutation {
  return {
    ...(state.checkpointFormat !== undefined
      ? { checkpointFormat: state.checkpointFormat }
      : undefined),
    items: state.items,
    compactionCount: state.compactionCount,
    cursors: state.cursors,
    captureCursors: state.captureCursors,
    inbox: state.inbox,
    journal: state.journal,
    requests: state.requests,
  };
}

/** What a save's one record did to the committed list. */
interface ChangedRequests {
  requests: readonly BrainRequestRecord[];
  /** The record as written, when the committed list held it or the save inserted it. */
  owned?: BrainRequestRecord;
  /** The save named a record the committed state does not hold, and inserted none. */
  missing: boolean;
}

/** What a save's one record does to the committed list: changed in place, appended, or named and absent. */
function changedRequests(
  committed: readonly BrainRequestRecord[],
  change: BrainRecordChange,
): ChangedRequests {
  const existing = committed.find((record) => record.runId === change.runId);
  if (existing) {
    const changed: BrainRequestRecord = {
      ...existing,
      ...change.changes,
      revision: existing.revision + 1,
    };
    return {
      requests: committed.map((record) => (record.runId === change.runId ? changed : record)),
      owned: changed,
      missing: false,
    };
  }
  if (change.insert) {
    const owned = { ...change.insert };
    return { requests: [...committed, owned], owned, missing: false };
  }
  return { requests: committed, missing: true };
}

/** The owned record's fields on the live record, merged onto whatever else has advanced meanwhile. */
function applyOwned(
  generation: Generation,
  owned: BrainRequestRecord | undefined,
  change: BrainRecordChange | undefined,
): void {
  if (!owned || !change) return;
  const live = generation.requests.get(owned.runId);
  if (!live) return;
  generation.requests.set(owned.runId, {
    ...live,
    ...change.changes,
    revision: owned.revision,
  });
}
