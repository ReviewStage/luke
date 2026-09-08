import {
  type AgentRuntime,
  type ContextEngine,
  checkpointFormatFromTag,
  checkpointFormatTag,
  type RuntimeCheckpoint,
} from "@sidecar/runtime-contracts";
import type { SessionIdentity } from "@sidecar/session";
import {
  ACT_RESULT_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { TranscriptCursors } from "./cursors.js";
import { BrainJournal } from "./journal.js";
import type { BrainRequestRecord } from "./requests.js";
import { settledUnlessAborted } from "./settled.js";
import type { BrainPersistedState } from "./state-store.js";

/**
 * One envelope's working copy, alive from the moment the agent adopts it to
 * the moment the store replaces it. Every turn captures the generation it
 * opened in and works on that object alone: a turn still awaiting a model, a
 * read, or an act when the generation is replaced finishes against the
 * orphaned copy, whose checkpoints the store then fences, and can neither
 * append to nor roll back the generation that succeeded it. The signal fires
 * on replacement and on stop, and every wait of the generation settles on it.
 *
 * The context is the runtime's: opened from the stored checkpoint, which the
 * runtime loads only when the stamp is its own. A checkpoint of another
 * runtime's stamp is not corruption — it is kept whole in the store, beside
 * the requests and the journal — and the generation stands with no context
 * and `incompatible` naming why, refusing every turn until a runtime that can
 * read it loads it or the developer starts fresh.
 */
export interface Generation {
  id: string;
  expiresAt: number;
  /** Settles once the checkpoint has been offered to the runtime; the fields below are read after it. */
  ready: Promise<void>;
  context?: ContextEngine;
  incompatible?: string;
  /** How many dangling tool calls the context paired at load, so the load may be checkpointed. */
  repaired: number;
  cursors: TranscriptCursors;
  journal: BrainJournal;
  requests: Map<string, BrainRequestRecord>;
  /** Runs accepted in memory but not yet checkpointed; not yet acknowledged to anyone. */
  provisional: Set<string>;
  abort: AbortController;
}

/** The stored items as a checkpoint, or nothing for a generation never checkpointed into. */
export function storedCheckpoint(state: BrainPersistedState): RuntimeCheckpoint | undefined {
  if (state.checkpointFormat === undefined) return undefined;
  const format = checkpointFormatFromTag(state.checkpointFormat);
  if (!format) return undefined;
  return { format, items: state.items };
}

export function generationFrom(
  state: BrainPersistedState,
  runtime: AgentRuntime,
  lostResultJson: string,
): Generation {
  const abort = new AbortController();
  const generation: Generation = {
    id: state.generationId,
    expiresAt: state.expiresAt,
    ready: Promise.resolve(),
    repaired: 0,
    cursors: new TranscriptCursors(state.cursors),
    journal: new BrainJournal(state.journal),
    requests: new Map(state.requests.map((record) => [record.runId, { ...record }])),
    provisional: new Set(),
    abort,
  };
  const checkpoint = storedCheckpoint(state);
  if (state.checkpointFormat !== undefined && !checkpoint) {
    generation.incompatible = `checkpoint stamp ${state.checkpointFormat} is not one this build reads`;
    return generation;
  }
  // The open is raced against the generation's own signal: a runtime whose
  // bootstrap ignores the signal cannot hold `ready` open past a stop or a
  // replacement, and a context that finishes opening after the fence is
  // retired rather than installed, so a successor never inherits it.
  generation.ready = settledUnlessAborted(
    runtime.openContext(checkpoint, lostResultJson, { signal: abort.signal }),
    abort.signal,
  )
    .then((opened) => {
      if (opened.aborted) {
        generation.incompatible = "the generation was replaced while its context was opening";
        return;
      }
      const { context, bootstrap } = opened.value;
      if (abort.signal.aborted) {
        retireContext(context);
        generation.incompatible = "the generation was replaced while its context was opening";
        return;
      }
      if (bootstrap.loaded) {
        generation.context = context;
        generation.repaired = bootstrap.repaired;
        return;
      }
      retireContext(context);
      generation.incompatible =
        bootstrap.reason ??
        `checkpoint ${checkpoint ? checkpointFormatTag(checkpoint.format) : "(none)"} could not be loaded`;
    })
    .catch((error: Error) => {
      generation.incompatible = `the runtime could not open the context: ${error.name}`;
    });
  return generation;
}

/**
 * Lets go of a context nothing will read again. Its dispose is not awaited:
 * an engine whose dispose hangs must not hold a stop, a replacement, or a
 * successor's first turn, and a dispose that throws has nothing to tell.
 */
export function retireContext(context: ContextEngine): void {
  void Promise.resolve()
    .then(() => context.dispose())
    .catch(() => undefined);
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
