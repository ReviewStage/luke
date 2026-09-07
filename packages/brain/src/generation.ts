import type { SessionIdentity } from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { BrainJournal } from "./journal.js";
import { BrainMemory } from "./memory.js";
import type { BrainRequestRecord } from "./requests.js";
import type { BrainPersistedState } from "./state-store.js";

/**
 * One envelope's working copy, alive from the moment the agent adopts it to
 * the moment the store replaces it. Every turn captures the generation it
 * opened in and works on that object alone: a turn still awaiting a model, a
 * read, or an act when the generation is replaced finishes against the
 * orphaned copy, whose checkpoints the store then fences, and can neither
 * append to nor roll back the generation that succeeded it. The signal fires
 * on replacement and on stop, and every wait of the generation settles on it.
 */
export interface Generation {
  id: string;
  expiresAt: number;
  memory: BrainMemory;
  journal: BrainJournal;
  requests: Map<string, BrainRequestRecord>;
  /** Runs accepted in memory but not yet checkpointed; not yet acknowledged to anyone. */
  provisional: Set<string>;
  abort: AbortController;
}

export function generationFrom(state: BrainPersistedState): Generation {
  return {
    id: state.generationId,
    expiresAt: state.expiresAt,
    memory: new BrainMemory({ items: state.items, cursors: state.cursors }),
    journal: new BrainJournal(state.journal),
    requests: new Map(state.requests.map((record) => [record.runId, { ...record }])),
    provisional: new Set(),
    abort: new AbortController(),
  };
}

export function parsedRecord(json: string): WireRecord {
  try {
    // SAFETY: JSON.parse returns a wire value; the record check below is the validation.
    const parsed = JSON.parse(json) as UnparsedWireValue;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function identityFromRecord(value: UnparsedWireValue): SessionIdentity | undefined {
  if (!isRecord(value)) return undefined;
  const providerId = text(value.provider_id);
  const providerSessionId = text(value.provider_session_id);
  return providerId && providerSessionId ? { providerId, providerSessionId } : undefined;
}

export function sameIdentity(first: SessionIdentity, second: SessionIdentity): boolean {
  return (
    first.providerId === second.providerId && first.providerSessionId === second.providerSessionId
  );
}

export function rejection(reason: string): WireRecord {
  return { status: ACT_RESULT_STATUS.REJECTED, reason };
}
