import {
  type AgentRuntime,
  type ContextEngine,
  type ContextOpening,
  checkpointFormatFromTag,
  checkpointFormatTag,
  type RuntimeCheckpoint,
} from "@sidecar/runtime/vocabulary";
import type { BrainPersistedState } from "./envelope.js";
import { BrainJournal } from "./journal.js";
import type { BrainRequestRecord } from "./requests.js";
import { claimedUnlessAborted, type Settled } from "./settled.js";
import { RecordingContextEngine } from "./transcript-recorder.js";

/**
 * One envelope's working copy, alive from the moment the agent adopts it to
 * the moment the store replaces it. Every turn captures the generation it
 * opened in and works on that object alone: a turn still awaiting a model, a
 * read, or an action when the generation is replaced finishes against the
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
  /** Settles once the checkpoint has been offered to the runtime, with the context it gave or the reason it gave none. */
  opened: Promise<OpenedContext>;
  /** How many times the context has folded in this generation; persisted with every checkpoint. */
  compactionCount: number;
  /**
   * The flush marker as this generation has read it: whether the store has
   * been consulted, and the compaction count the last completed flush ran
   * under. Filled from the marker store at the first assessment and kept in
   * step with every marker that lands after. A marker write the turn stopped
   * waiting for is still `settling`: the next assessment waits for it before
   * reading the gate, so a write that lands late is counted and never
   * repeated.
   */
  flush: { read: boolean; lastCompactionCount?: number; settling?: Promise<void> };
  journal: BrainJournal;
  requests: Map<string, BrainRequestRecord>;
  /** Runs accepted in memory but not yet checkpointed; not yet acknowledged to anyone. */
  provisional: Set<string>;
  abort: AbortController;
}

export const CONTEXT_OPENING = {
  LOADED: "loaded",
  INCOMPATIBLE: "incompatible",
} as const;

export type OpenedContext =
  | {
      kind: typeof CONTEXT_OPENING.LOADED;
      /** The runtime's engine behind the transcript recorder, so every save can carry what the engine ingested. */
      context: RecordingContextEngine;
      /** How many dangling tool calls the context paired at load, so the load may be checkpointed. */
      repaired: number;
    }
  | { kind: typeof CONTEXT_OPENING.INCOMPATIBLE; reason: string };

function incompatibleContext(reason: string): OpenedContext {
  return { kind: CONTEXT_OPENING.INCOMPATIBLE, reason };
}

const REPLACED_WHILE_OPENING = "the generation was replaced while its context was opening";

/** The stored items as a checkpoint, or nothing for a generation never checkpointed into. */
function storedCheckpoint(state: BrainPersistedState): RuntimeCheckpoint | undefined {
  if (state.checkpointFormat === undefined) return undefined;
  const format = checkpointFormatFromTag(state.checkpointFormat);
  if (!format) return undefined;
  return { format, items: state.items };
}

/**
 * Claims a context the runtime is opening, or lets it go. The open is raced
 * against the signal: a runtime whose bootstrap ignores the signal cannot
 * hold the wait open past a stop or a replacement, and a context that
 * finishes opening once the signal has fired — in the same turn or later —
 * is retired by the race itself, exactly once, so a successor never inherits
 * it. The value is claimed while the signal stands, but this continuation
 * runs later, so the signal is read once more before the context is handed
 * back: an abort that landed between the two retires it as well.
 */
export async function claimOpenedContext(
  open: Promise<ContextOpening>,
  signal: AbortSignal,
  notLoadedReason: string,
  now: () => number = Date.now,
): Promise<Settled<OpenedContext>> {
  const claimed = await claimedUnlessAborted(open, signal, ({ context }) => retireContext(context));
  if (claimed.aborted) return claimed;
  const { context, bootstrap } = claimed.value;
  if (signal.aborted) {
    retireContext(context);
    return { aborted: true };
  }
  if (bootstrap.loaded) {
    // The engine is handed back behind the transcript recorder, so every
    // input the runtime ingests and every fold is on record beside the
    // checkpoint that carries it.
    return {
      aborted: false,
      value: {
        kind: CONTEXT_OPENING.LOADED,
        context: new RecordingContextEngine(context, now),
        repaired: bootstrap.repaired,
      },
    };
  }
  retireContext(context);
  return { aborted: false, value: incompatibleContext(bootstrap.reason ?? notLoadedReason) };
}

export function generationFrom(
  state: BrainPersistedState,
  runtime: AgentRuntime,
  lostResultJson: string,
  now: () => number = Date.now,
): Generation {
  const abort = new AbortController();
  const checkpoint = storedCheckpoint(state);
  const opened =
    state.checkpointFormat !== undefined && !checkpoint
      ? Promise.resolve(
          incompatibleContext(
            `checkpoint stamp ${state.checkpointFormat} is not one this build reads`,
          ),
        )
      : claimOpenedContext(
          runtime.openContext(checkpoint, lostResultJson, { signal: abort.signal }),
          abort.signal,
          `checkpoint ${checkpoint ? checkpointFormatTag(checkpoint.format) : "(none)"} could not be loaded`,
          now,
        )
          .then((claimed) =>
            claimed.aborted ? incompatibleContext(REPLACED_WHILE_OPENING) : claimed.value,
          )
          .catch((error: Error) =>
            incompatibleContext(`the runtime could not open the context: ${error.message}`),
          );
  return {
    id: state.generationId,
    expiresAt: state.expiresAt,
    opened,
    compactionCount: state.compactionCount,
    flush: { read: false },
    journal: new BrainJournal(state.journal),
    requests: new Map(state.requests.map((record) => [record.runId, { ...record }])),
    provisional: new Set(),
    abort,
  };
}

/** Retires the generation's context once it is known, when it was loaded; nothing else holds one. */
export function retireOpenedContext(generation: Generation): void {
  void generation.opened.then((opened) => {
    if (opened.kind === CONTEXT_OPENING.LOADED) retireContext(opened.context);
  });
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
