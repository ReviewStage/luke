import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { BRAIN_MAXIMUM_OUTPUT_TOKENS, failed } from "./model-adapter-shared.js";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "./state-store.js";

/** The two things a bare transport answers: an inference, and when it is quiet. */
export interface BareResponsesModel {
  readonly model?: string;
  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse>;
  quietUntil(): number | undefined;
}

/**
 * A full model adapter over a transport that only infers, in the Responses
 * item format: it counts and compacts nothing, and says so. For a host's
 * tests, which is why it ships behind the `testing` subpath and not the
 * package's barrel.
 */
export function bareModelAdapter(bare: BareResponsesModel): ModelAdapter {
  return {
    ...(bare.model ? { model: bare.model } : undefined),
    capabilities: () =>
      Promise.resolve({
        outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
        capabilities: {
          adapter: "bare-responses",
          ...(bare.model ? { model: bare.model } : undefined),
          checkpoint: {
            runtime: TOOL_LOOP_RUNTIME.ID,
            runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
            format: RESPONSES_ITEM_FORMAT.format,
            formatVersion: RESPONSES_ITEM_FORMAT.version,
          },
          countsInputTokens: false,
          compacts: false,
          maximumOutputTokens: BRAIN_MAXIMUM_OUTPUT_TOKENS,
        },
      }),
    respond: (items, options) => bare.respond(items, options),
    countInputTokens: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not count tokens")),
    compact: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not compact")),
    quietUntil: () => bare.quietUntil(),
  };
}

/** What a fake repository lets a test see and do beyond the contract it satisfies. */
export interface FakeBrainStateRepository extends BrainStateRepository {
  /** The envelope as it stands, or nothing when none has landed. */
  readonly state: BrainPersistedState | undefined;
  /** Everything the standing envelope would say, so a test can assert old content is gone. */
  words(): string;
  /** Content no build can read, so the next load answers unreadable. */
  corrupt(): void;
  /** Refuses every save until `accept()`; a refused save changes nothing. */
  refuse(): void;
  accept(): void;
  /** Holds the next save open; the returned function lets it land, or not. */
  hold(): (landed: boolean) => void;
  /** Holds the next load open; the returned function answers it with what stands then. */
  holdRead(): () => void;
  /** Whether a load or a save is waiting on its release. */
  readonly holding: boolean;
  readonly loads: number;
  /** How many saves have landed. */
  readonly saves: number;
  /** The transcript events every landed save carried, in order. */
  readonly transcript: readonly TranscriptEvent[];
}

/**
 * The envelope on nothing but memory, with the seams a store's own tests
 * need: a refusal, an unreadable generation, and a load or a save held open
 * so a test can land a fence while one is out. One fake for every test that
 * needs a repository, because a store whose durable owner is faked five
 * different ways is five chances for one of them to be wrong about the
 * contract.
 */
export function fakeBrainStateRepository(
  initial?: BrainPersistedState | { unreadable: true },
): FakeBrainStateRepository {
  const planted = initial !== undefined && "unreadable" in initial ? undefined : initial;
  let held: BrainPersistedState | undefined = planted;
  let unreadable = initial !== undefined && "unreadable" in initial;
  let refusing = false;
  let loads = 0;
  let saves = 0;
  const transcript: TranscriptEvent[] = [];
  let holdNextSave = false;
  let holdNextLoad = false;
  let releaseSave: ((landed: boolean) => void) | undefined;
  let releaseLoad: (() => void) | undefined;

  const read = (): BrainStateLoad => {
    loads += 1;
    if (held) return { state: held };
    return unreadable ? { unreadable: true } : {};
  };

  const commit = (state: BrainPersistedState, events?: readonly TranscriptEvent[]): boolean => {
    if (refusing) return false;
    held = state;
    unreadable = false;
    saves += 1;
    if (events) transcript.push(...events);
    return true;
  };

  return {
    get state() {
      return held;
    },
    get holding() {
      return releaseSave !== undefined || releaseLoad !== undefined;
    },
    get loads() {
      return loads;
    },
    get saves() {
      return saves;
    },
    get transcript() {
      return transcript;
    },
    words: () => JSON.stringify(held ?? null),
    corrupt: () => {
      held = undefined;
      unreadable = true;
    },
    refuse: () => {
      refusing = true;
    },
    accept: () => {
      refusing = false;
    },
    hold: () => {
      holdNextSave = true;
      return (landed) => {
        holdNextSave = false;
        const release = releaseSave;
        releaseSave = undefined;
        release?.(landed);
      };
    },
    holdRead: () => {
      holdNextLoad = true;
      return () => {
        holdNextLoad = false;
        const release = releaseLoad;
        releaseLoad = undefined;
        release?.();
      };
    },
    load: () => {
      if (!holdNextLoad) return read();
      holdNextLoad = false;
      return new Promise<BrainStateLoad>((resolve) => {
        releaseLoad = () => resolve(read());
      });
    },
    save: (state, events) => {
      if (!holdNextSave) return commit(state, events);
      holdNextSave = false;
      return new Promise<boolean>((resolve) => {
        releaseSave = (landed) => resolve(landed ? commit(state, events) : false);
      });
    },
  };
}
