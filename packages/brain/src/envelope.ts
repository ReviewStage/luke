import { checkpointFormatFromTag, type TranscriptEvent } from "@sidecar/runtime/vocabulary";
import {
  isInstant,
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
} from "@sidecar/wire";
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
 * Responses input array from the latest compaction onward, the request
 * records, and the action journal — lives and dies
 * with it. A state file from another build or another shape reads as no
 * state, never as a fresh lifetime for old data.
 */

export const BRAIN_STATE_VERSION = 2;

/** The span every generation is stamped with at birth; enforced only by a store whose automatic reset is enabled. */
export const BRAIN_GENERATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * How large a generation may grow. The request count bounds what the panel
 * and the model can be shown of ended runs, and it is the one bound that can
 * refuse a write: ended runs are let go first, and a write that would still
 * leave the envelope oversized is refused rather than dropping anything that
 * is not finished.
 *
 * It bounds records and nothing else. The checkpoint items are bounded by
 * compaction, which folds the context under the model's own window, and a
 * hosted request is bounded again by its transport's envelope; there is no
 * bound on the envelope's bytes, because the envelope is rows in the store
 * rather than a file to measure. A byte bound here would have to be measured
 * where the bytes are, over the checkpoint rows, and that is a decision this
 * build has not made.
 */
export const MAXIMUM_TERMINAL_REQUESTS = 200;

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

export interface BrainPersistedState {
  version: typeof BRAIN_STATE_VERSION;
  generationId: string;
  createdAt: number;
  /** Always stamped and validated as part of the envelope's shape; a deadline only when automatic reset is enabled. */
  expiresAt: number;
  /**
   * Whose shape the items are, as `checkpointFormatTag` writes it, carried on
   * the generation itself so an empty checkpoint keeps its stamp too. Absent
   * only on a generation nothing has checkpointed into yet.
   */
  checkpointFormat?: string;
  items: readonly ResponsesInputItem[];
  /**
   * How many times this generation's context has folded. A property of the
   * context the items are, so it rides on the envelope: the pre-compaction
   * flush's cycle is this count, and a fresh generation starts at zero.
   */
  compactionCount: number;
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
    compactionCount: 0,
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
  if (!isInstant(value.createdAt) || !isInstant(value.expiresAt)) return undefined;
  // The lifetime is the build's, not the file's: an envelope claiming any
  // other span was not written by this rule and is not given one now.
  if (value.expiresAt - value.createdAt !== BRAIN_GENERATION_LIFETIME_MS) return undefined;
  if (!Array.isArray(value.items)) return undefined;
  if (!Array.isArray(value.requests) || !Array.isArray(value.journal)) return undefined;
  const checkpointFormat = checkpointFormatTagFromWire(value.checkpointFormat);
  if (checkpointFormat === null) return undefined;
  const reset = resetMarkerFromWire(value.reset);
  if (reset === null || (reset && reset.clearedAt > value.createdAt)) return undefined;
  // An envelope written before the count existed has folded under no rule
  // this build reads; it starts its cycles at zero rather than as unreadable.
  const compactionCount = value.compactionCount === undefined ? 0 : value.compactionCount;
  if (!isWireNumber(compactionCount) || !Number.isInteger(compactionCount) || compactionCount < 0) {
    return undefined;
  }
  const items: ResponsesInputItem[] = [];
  for (const item of value.items) {
    if (!isRecord(item)) return undefined;
    items.push(item);
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
    ...(checkpointFormat !== undefined ? { checkpointFormat } : undefined),
    items,
    compactionCount,
    requests,
    journal,
    ...(reset ? { reset } : undefined),
  };
}

/**
 * The stamp as stored: nothing for a generation never checkpointed, the tag
 * itself when it reads as one, and null for a tag not written by the rule.
 */
function checkpointFormatTagFromWire(value: UnparsedWireValue): string | undefined | null {
  if (value === undefined) return undefined;
  if (!isWireString(value) || !checkpointFormatFromTag(value)) return null;
  return value;
}

/** The marker as stored, nothing when absent, and null when present but unreadable. */
function resetMarkerFromWire(value: UnparsedWireValue): BrainResetMarker | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isInstant(value.clearedAt)) return null;
  if (value.generationId === undefined) return { clearedAt: value.clearedAt };
  if (!isWireString(value.generationId) || value.generationId.length === 0) return null;
  return { clearedAt: value.clearedAt, generationId: value.generationId };
}

/**
 * Whether an ended run may be let go of. Only an ended run whose end the host
 * has already written into its own thread: the thread is where the words
 * outlive the record, so a record still waiting to be written there is kept
 * however old it is, and a run still going is never eligible at all.
 */
export function brainRequestPrunable(record: BrainRequestRecord): boolean {
  return isTerminalBrainRequestStatus(record.status) && record.conversationRecordedAt !== undefined;
}

/** An envelope held to its bound, and which runs were let go to get there. */
export interface RetainedBrainState {
  state: BrainPersistedState;
  prunedRunIds: readonly string[];
  /** Whether the envelope still exceeds the bound after everything eligible went. */
  oversized: boolean;
}

/**
 * Applies the bound, oldest ended runs going first and each run's journal
 * going with its record, so a call is never left without the run it belonged
 * to. It prunes only what is eligible and then reports whether that was
 * enough, because what to do about an envelope that is still too large —
 * refuse the write that would grow it, or refuse the file at load — is the
 * writer's decision, not the retention's: nothing here touches a run still
 * going, a run whose end the thread has not yet taken, a journal, or the
 * model's own memory items. The count bounds records of every status
 * together, so however many runs stand at once the envelope never carries
 * more than the bound names.
 */
export function retainedBrainState(
  state: BrainPersistedState,
  maximumRequests: number = MAXIMUM_TERMINAL_REQUESTS,
): RetainedBrainState {
  const eligible = state.requests
    .filter(brainRequestPrunable)
    .sort(
      (left, right) =>
        (left.settledAt ?? left.acceptedAt) - (right.settledAt ?? right.acceptedAt) ||
        left.acceptedAt - right.acceptedAt,
    );
  const pruned = new Set<string>();
  let excess = state.requests.length - maximumRequests;
  for (const record of eligible) {
    if (excess <= 0) break;
    pruned.add(record.runId);
    excess -= 1;
  }
  const retained: BrainPersistedState =
    pruned.size > 0
      ? {
          ...state,
          requests: state.requests.filter((record) => !pruned.has(record.runId)),
          journal: state.journal.filter((entry) => !pruned.has(entry.runId)),
        }
      : state;
  return {
    state: retained,
    prunedRunIds: [...pruned],
    oversized: retained.requests.length > maximumRequests,
  };
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
  /**
   * Makes `state` the envelope that stands and, in the same write, appends
   * `transcript` to the conversation's retained record under the generation
   * the state names. A repository with no transcript table ignores it.
   */
  save(
    state: BrainPersistedState,
    transcript?: readonly TranscriptEvent[],
  ): boolean | Promise<boolean>;
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
 * What one write composes: the envelope's mutable fields, and beside them
 * the transcript events the checkpoint carries into the conversation's
 * retained record in the same write. The transcript is not part of the
 * envelope — it answers to the conversation's retention, not the
 * generation's — and rides along only so the two land together or not at all.
 */
export type BrainStateMutation = Omit<
  BrainPersistedState,
  "version" | "generationId" | "createdAt" | "expiresAt" | "reset"
> & { transcript?: readonly TranscriptEvent[] };
