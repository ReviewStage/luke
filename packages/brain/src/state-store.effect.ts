/**
 * The one writer of the brain's state in Effect's own terms. `state-store.ts`
 * is a port of OpenClaw `b7528507`'s session store and imports nothing from
 * `effect`, so its Effect surface lives here: every write the class already
 * answers with `false` (a lease or generation that no longer stands, a bound
 * a write would still cross, storage that refused the bytes) restated as a
 * typed refusal instead of a boolean a caller must re-check, and `load` and
 * `flush` restated as effects with no failure of their own, since the class
 * never lets either throw outward.
 */
import { Data, Effect } from "effect";
import type {
  BrainPersistedState,
  BrainStateMutation,
  BrainStoreLease,
  BrainWriteCommit,
} from "./envelope.js";
import type { Generation } from "./generation.js";
import type { BrainObservationEntry } from "./observation-inbox.js";
import type { BrainRecordChange } from "./requests.js";
import type { BrainSaveResult, BrainStateStore } from "./state-store.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";

/** A write the store did not carry to storage, naming the generation it was attempted against. */
export class BrainStateWriteRefused extends Data.TaggedError("BrainStateWriteRefused")<{
  readonly generationId: string | undefined;
}> {}

/** Reads the envelope once from storage; later calls answer the held copy. Never fails: an unreadable file is a fresh generation. */
export const loadBrainState = (store: BrainStateStore): Effect.Effect<BrainPersistedState> =>
  Effect.promise(() => store.load());

const refusedUnlessLanded = (
  generationId: string | undefined,
  landed: Promise<boolean>,
): Effect.Effect<void, BrainStateWriteRefused> =>
  Effect.promise(() => landed).pipe(
    Effect.flatMap((ok) =>
      ok ? Effect.void : Effect.fail(new BrainStateWriteRefused({ generationId })),
    ),
  );

const refusedUnlessSaved = (
  generationId: string,
  result: Promise<BrainSaveResult>,
): Effect.Effect<BrainSaveResult, BrainStateWriteRefused> =>
  Effect.promise(() => result).pipe(
    Effect.flatMap((outcome) =>
      outcome.saved
        ? Effect.succeed(outcome)
        : Effect.fail(new BrainStateWriteRefused({ generationId })),
    ),
  );

/** A turn's or an action's checkpoint; fails when the lease, the generation, or storage itself refused it. */
export const saveWorkingState = (
  store: BrainStateStore,
  lease: BrainStoreLease,
  generation: Generation,
  working: {
    context: RecordingContextEngine;
    record?: BrainRecordChange;
    consumes?: readonly string[];
  },
): Effect.Effect<BrainSaveResult, BrainStateWriteRefused> =>
  refusedUnlessSaved(generation.id, store.saveWorking(lease, generation, working));

/** A staged write of some fields of one record; fails the same way `saveWorkingState` does. */
export const saveRecordState = (
  store: BrainStateStore,
  lease: BrainStoreLease,
  generation: Generation,
  change: BrainRecordChange,
): Effect.Effect<BrainSaveResult, BrainStateWriteRefused> =>
  refusedUnlessSaved(generation.id, store.saveRecord(lease, generation, change));

/** The restore's own save, carrying the loaded context only when the runtime could read it. */
export const saveWholeState = (
  store: BrainStateStore,
  lease: BrainStoreLease,
  generation: Generation,
  context: RecordingContextEngine | undefined,
): Effect.Effect<BrainSaveResult, BrainStateWriteRefused> =>
  refusedUnlessSaved(generation.id, store.saveWhole(lease, generation, context));

/** Observations captured into the inbox, with the capture cursors they advanced. */
export const saveCaptureState = (
  store: BrainStateStore,
  lease: BrainStoreLease,
  generation: Generation,
  entries: readonly BrainObservationEntry[],
): Effect.Effect<BrainSaveResult, BrainStateWriteRefused> =>
  refusedUnlessSaved(generation.id, store.saveCapture(lease, generation, entries));

/** Writes a new envelope of the generation named, under the lease given; fails when it did not land. */
export const writeBrainState = (
  store: BrainStateStore,
  lease: BrainStoreLease,
  generationId: string,
  mutate: (state: BrainPersistedState) => BrainStateMutation,
  committed?: (commit: BrainWriteCommit) => void,
): Effect.Effect<void, BrainStateWriteRefused> =>
  refusedUnlessLanded(generationId, store.write(lease, generationId, mutate, committed));

/** Replaces the envelope whole; fails when the write did not land. */
export const replaceBrainState = (
  store: BrainStateStore,
  state: BrainPersistedState,
): Effect.Effect<void, BrainStateWriteRefused> =>
  refusedUnlessLanded(state.generationId, store.replace(state));

/**
 * The Clear; fails when the erasure's marker did not reach storage. The
 * successor's id is read only once `clear` has begun it in memory — the
 * store's own synchronous fence, ahead of the disk write this awaits — so
 * the refusal names the generation the marker was meant for, not the one it
 * replaced.
 */
export const clearBrainState = (
  store: BrainStateStore,
  now?: number,
): Effect.Effect<void, BrainStateWriteRefused> =>
  Effect.suspend(() => {
    const landed = store.clear(now);
    return refusedUnlessLanded(store.generationId(), landed);
  });

/** Start fresh; fails when the successor did not reach storage, named the same way `clearBrainState` names it. */
export const resetBrainState = (
  store: BrainStateStore,
  now?: number,
): Effect.Effect<void, BrainStateWriteRefused> =>
  Effect.suspend(() => {
    const landed = store.reset(now);
    return refusedUnlessLanded(store.generationId(), landed);
  });

/** Settles once every write queued so far has landed or been refused. */
export const flushBrainState = (store: BrainStateStore): Effect.Effect<void> =>
  Effect.promise(() => store.flush());
