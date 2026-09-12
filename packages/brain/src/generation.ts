import {
  type AgentRuntimeEffect,
  type ContextEngine,
  type ContextOpening,
  checkpointFormatFromTag,
  checkpointFormatTag,
  type RuntimeCheckpoint,
} from "@sidecar/runtime/vocabulary";
import type { UnknownActionResult } from "@sidecar/wire";
import { Effect, Exit, Option, Scope } from "effect";
import { TranscriptCursors } from "./cursors.js";
import type { Carry } from "./effect/carry.js";
import { claimedUnlessAborted } from "./effect/settled.js";
import type { BrainPersistedState } from "./envelope.js";
import { BrainJournal } from "./journal.js";
import type { BrainObservationEntry } from "./observation-inbox.js";
import type { BrainRequestRecord } from "./requests.js";
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
  cursors: TranscriptCursors;
  /** Where the inbox has captured each transcript to; moves at capture, never with a turn. */
  captureCursors: TranscriptCursors;
  /** The observations captured and not yet consumed, as last committed. */
  inbox: readonly BrainObservationEntry[];
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
  flush: {
    read: boolean;
    lastCompactionCount?: number | undefined;
    settling?: Effect.Effect<void> | undefined;
  };
  journal: BrainJournal;
  requests: Map<string, BrainRequestRecord>;
  /** Runs accepted in memory but not yet checkpointed; not yet acknowledged to anyone. */
  provisional: Set<string>;
  abort: AbortController;
  /**
   * What the generation owns, released in reverse order by one close: the
   * signal every wait of the generation settles on, and, behind it, the
   * context the runtime opened. Closing is the whole of retiring a
   * generation, and it is synchronous — every finalizer here is — so the
   * fence a replacement raises still stands before any disk is waited on.
   */
  scope: Scope.CloseableScope;
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
 * Claims a context the runtime is opening, or lets it go, answering nothing
 * where it let go. The open is raced against the signal: a runtime whose
 * bootstrap ignores the signal cannot hold the wait open past a stop or a
 * replacement, and a context that finishes opening once the signal has fired
 * — in the same turn or later, or while the fiber that asked for it is being
 * interrupted — is retired by the race itself, exactly once, so a successor
 * never inherits it. The value is claimed while the signal stands, but this
 * continuation runs later, so the signal is read once more before the context
 * is handed back: an abort that landed between the two retires it as well.
 */
export function claimOpenedContext(
  open: Effect.Effect<ContextOpening>,
  signal: AbortSignal,
  notLoadedReason: string,
  now: () => number = Date.now,
): Effect.Effect<Option.Option<OpenedContext>> {
  return Effect.map(
    claimedUnlessAborted(open, signal, ({ context }) => retireContext(context)),
    Option.flatMap(({ context, bootstrap }) => {
      if (signal.aborted) {
        retireContext(context);
        return Option.none();
      }
      if (bootstrap.loaded) {
        // The engine is handed back behind the transcript recorder, so every
        // input the runtime ingests and every fold is on record beside the
        // checkpoint that carries it.
        return Option.some<OpenedContext>({
          kind: CONTEXT_OPENING.LOADED,
          context: new RecordingContextEngine(context, now),
          repaired: bootstrap.repaired,
        });
      }
      retireContext(context);
      return Option.some(incompatibleContext(bootstrap.reason ?? notLoadedReason));
    }),
  );
}

/**
 * The generation as the agent adopts it: built in one synchronous statement,
 * because the fence a replacement raises must stand before any disk is waited
 * on, so the open the runtime answers as an effect is carried to the promise
 * this object holds by the agent's own door rather than run here.
 */
export function generationFrom(
  state: BrainPersistedState,
  runtime: AgentRuntimeEffect,
  lostResult: UnknownActionResult,
  carry: Carry,
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
      : carry(
          claimOpenedContext(
            runtime.openContext(checkpoint, lostResult, { signal: abort.signal }),
            abort.signal,
            `checkpoint ${checkpoint ? checkpointFormatTag(checkpoint.format) : "(none)"} could not be loaded`,
            now,
          ).pipe(Effect.map(Option.getOrElse(() => incompatibleContext(REPLACED_WHILE_OPENING)))),
        ).catch((error: Error) =>
          incompatibleContext(`the runtime could not open the context: ${error.message}`),
        );
  const scope = Effect.runSync(Scope.make());
  Effect.runSync(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => retireOpenedContext(opened)),
    ),
  );
  Effect.runSync(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => abort.abort()),
    ),
  );
  return {
    id: state.generationId,
    expiresAt: state.expiresAt,
    opened,
    cursors: new TranscriptCursors(state.cursors),
    captureCursors: new TranscriptCursors(state.captureCursors),
    inbox: [...state.inbox],
    compactionCount: state.compactionCount,
    flush: { read: false },
    journal: new BrainJournal(state.journal),
    requests: new Map(state.requests.map((record) => [record.runId, { ...record }])),
    provisional: new Set(),
    abort,
    scope,
  };
}

/**
 * Lets go of everything the generation owns, in one close and in reverse
 * order: the signal fires first, so every wait of the generation settles,
 * and the context the runtime opened is retired behind it. Nothing here
 * waits — a close of a generation nobody will read again must not hold a
 * stop, a replacement, or a successor's first turn — so the retirement is
 * over by the time this returns, and closing a generation already retired
 * does nothing.
 */
export function retireGeneration(generation: Generation): void {
  Effect.runSync(Scope.close(generation.scope, Exit.void));
}

/** Retires the context once the open is known, when it was loaded; nothing else holds one. */
function retireOpenedContext(opened: Promise<OpenedContext>): void {
  void opened.then((standing) => {
    if (standing.kind === CONTEXT_OPENING.LOADED) retireContext(standing.context);
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
