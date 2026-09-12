import {
  ACTION_REFUSAL,
  type ActionFunctionCall,
  type ActionOutputEnvelope,
  acceptedActionOutput,
  refusedActionOutput,
  type ValidatedAction,
} from "@sidecar/actions";
import { APP_SETTING_KIND, type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import type { Session } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import type { BrainPersistedState, BrainStateLoad, BrainStateRepository } from "./envelope.js";
import { BRAIN_MAXIMUM_OUTPUT_TOKENS, failed } from "./model-adapter-shared.js";
import type { BrainActionExecution, BrainActionPerformer } from "./performer.js";
import { actionToolNamed } from "./tools/action-tools.js";
import { toolArguments } from "./tools/tool-module.js";

/** The two things a bare transport answers: an inference, and when it is quiet. */
export interface BareResponsesModel {
  readonly model?: string;
  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse>;
  quietUntil(): number | undefined;
}

/**
 * A full model adapter over a transport that only infers, in the Responses
 * item format: it counts nothing, and says so. For a host's tests, which is
 * why it ships behind the `testing` subpath and not the package's barrel.
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
          maximumOutputTokens: BRAIN_MAXIMUM_OUTPUT_TOKENS,
        },
      }),
    respond: (items, options) => bare.respond(items, options),
    countInputTokens: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not count tokens")),
    quietUntil: () => bare.quietUntil(),
  };
}

/** What a fake repository lets a test see and do beyond the contract it satisfies. */
export interface FakeBrainStateRepository extends BrainStateRepository {
  /** The envelope as it stands, or nothing when none has landed. */
  readonly state: BrainPersistedState | undefined;
  /** Everything the standing envelope would say, so a test can assert old content is gone. */
  words(): string;
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
  /** What each landed save carried into the transcript, in order; a save that carried none adds nothing. */
  readonly transcripts: readonly (readonly TranscriptEvent[])[];
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
  const transcripts: TranscriptEvent[][] = [];
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
    if (events && events.length > 0) transcripts.push([...events]);
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
    get transcripts() {
      return transcripts;
    },
    words: () => JSON.stringify(held ?? null),
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

/** A guide with one adjustable toggle, so a test's setting change has something to be admitted against. */
export const CAPTIONS_GUIDE: AppGuideSnapshot = {
  ...EMPTY_APP_GUIDE,
  settings: [
    {
      id: "voice_captions",
      label: "Captions",
      description: "Luke's words on screen.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: "off",
      defaultValue: "off",
      adjustable: true,
      manual: "the Voice page",
    },
  ],
};

export interface FakeActionPerformerOptions {
  /** The roster admission reads, as the latest pass would report it; empty admits no session action. */
  readonly sessions?: readonly Session[];
  readonly guide?: AppGuideSnapshot;
  /** What carrying an admitted action answers; accepted by default. The tests' own promise, awaited by the carrier's effect. */
  readonly carry?:
    | ((action: ValidatedAction, execution: BrainActionExecution) => Promise<ActionOutputEnvelope>)
    | undefined;
}

export interface FakeActionPerformer {
  readonly actions: BrainActionPerformer;
  /** Every action carried, admitted, in order. */
  readonly performed: ValidatedAction[];
  readonly executions: BrainActionExecution[];
}

/**
 * The host's two halves as a test stands them in: readers over the sessions
 * and guide the test chose, and a carrier that records what admission minted
 * and answers what the test chose. Admission itself is the real one, run by
 * the tool's own `execute`, so a test's action is admitted exactly as a
 * developer's would be.
 */
export function fakeActionPerformer(options: FakeActionPerformerOptions = {}): FakeActionPerformer {
  const performed: ValidatedAction[] = [];
  const executions: BrainActionExecution[] = [];
  const actions: BrainActionPerformer = {
    admission: () =>
      Effect.succeed({
        roster: { read: () => Effect.succeed(options.sessions ?? []) },
        guide: options.guide ?? EMPTY_APP_GUIDE,
        rememberedFacts: [],
      }),
    carry: (action, execution) =>
      Effect.suspend(() => {
        performed.push(action);
        executions.push(execution);
        const chosen = options.carry;
        return chosen
          ? Effect.promise(() => chosen(action, execution))
          : Effect.succeed(acceptedActionOutput());
      }),
  };
  return { actions, performed, executions };
}

/**
 * A raw call run the way the executor runs one, for a test that speaks in
 * calls: the action tool's module the name selects, its admission inside,
 * over the performer's two halves. A name no module answers, or arguments
 * that are not a record, refuse before anything is admitted.
 */
export function performCall(
  actions: BrainActionPerformer,
  call: ActionFunctionCall,
  execution: BrainActionExecution,
): Effect.Effect<ActionOutputEnvelope> {
  return Effect.suspend(() => {
    const tool = actionToolNamed(call.name);
    if (!tool) return Effect.succeed(refusedActionOutput(ACTION_REFUSAL.NO_TOOL));
    const input = toolArguments(call.argumentsJson);
    if (input === undefined) return Effect.succeed(refusedActionOutput(ACTION_REFUSAL.UNREADABLE));
    return Effect.gen(function* () {
      return yield* tool.execute(input, {
        ...execution,
        admission: yield* actions.admission(execution),
        carry: (action) => actions.carry(action, execution),
      });
    });
  });
}
