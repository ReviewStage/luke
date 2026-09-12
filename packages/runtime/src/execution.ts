import {
  isWireString,
  type UnknownActionResult,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { Cause, Data, Effect, Either, Exit, ManagedRuntime, Runtime, Schema } from "effect";
import type { CompactionSource } from "./storage.js";

/**
 * The seams along which Luke's reasoning is replaceable. A host owns the
 * conversation — accepting asks, recording runs, journaling effects, keeping
 * the checkpoint — and reaches a model only through these interfaces: an
 * agent runtime that turns a request into normalized events, a model adapter
 * that carries one inference, a context engine that owns the provider's item
 * shapes, and a tool executor the host supplies. Nothing here names a
 * provider. A provider's own vocabulary (an OpenAI Responses item, an
 * encrypted reasoning item) travels as opaque records inside a checkpoint
 * whose format tag says whose shape it is, and a runtime loads only the
 * formats it can read.
 */

/**
 * What a checkpoint is compatible with: the runtime that wrote it, at which
 * revision of its own rules, and the provider format its items are in, at
 * which revision of that shape. All four have to match for a runtime to load
 * it — a runtime of another id, or the same runtime at another version, may
 * not read items whose format it happens to share, because the format alone
 * does not say what the items were allowed to mean.
 */
export interface CheckpointFormat {
  readonly runtime: string;
  readonly runtimeVersion: number;
  readonly format: string;
  readonly formatVersion: number;
}

/** The items a context engine persists between turns, opaque to everything but an engine of the same format. */
export interface RuntimeCheckpoint {
  readonly format: CheckpointFormat;
  readonly items: readonly WireRecord[];
}

export function sameCheckpointFormat(left: CheckpointFormat, right: CheckpointFormat): boolean {
  return (
    left.runtime === right.runtime &&
    left.runtimeVersion === right.runtimeVersion &&
    left.format === right.format &&
    left.formatVersion === right.formatVersion
  );
}

const TAG_RUNTIME_SEPARATOR = "@";
const TAG_FORMAT_SEPARATOR = ":";
const TAG_VERSION_SEPARATOR = "/";

/** The tag one format travels under in storage: `<runtime>@<runtimeVersion>:<format>/<formatVersion>`. */
export function checkpointFormatTag(format: CheckpointFormat): string {
  return [
    format.runtime,
    TAG_RUNTIME_SEPARATOR,
    format.runtimeVersion,
    TAG_FORMAT_SEPARATOR,
    format.format,
    TAG_VERSION_SEPARATOR,
    format.formatVersion,
  ].join("");
}

function versioned(
  value: string,
  separator: string,
): { name: string; version: number } | undefined {
  const at = value.lastIndexOf(separator);
  if (at <= 0 || at === value.length - 1) return undefined;
  const version = Number(value.slice(at + 1));
  if (!Number.isInteger(version) || version < 0) return undefined;
  return { name: value.slice(0, at), version };
}

/** Reads a stored tag back into a format, or nothing for a tag not written by this rule. */
export function checkpointFormatFromTag(tag: UnparsedWireValue): CheckpointFormat | undefined {
  if (!isWireString(tag)) return undefined;
  const split = tag.indexOf(TAG_FORMAT_SEPARATOR);
  if (split <= 0) return undefined;
  const runtime = versioned(tag.slice(0, split), TAG_RUNTIME_SEPARATOR);
  const format = versioned(tag.slice(split + 1), TAG_VERSION_SEPARATOR);
  if (!runtime || !format) return undefined;
  return {
    runtime: runtime.name,
    runtimeVersion: runtime.version,
    format: format.name,
    formatVersion: format.version,
  };
}

/** A tool as a model is offered it: a name, what it is for, and its JSON-schema parameters. */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: WireRecord;
}

/** One tool call a model emitted, as the runtime hands it to the executor. */
export interface ToolInvocation {
  readonly callId: string;
  readonly name: string;
  readonly argumentsJson: string;
}

/** What a tool answered: its output as a JSON string for the model, and the status the host read off it. */
export interface ToolResult {
  readonly outputJson: string;
  /** The result's own status word, when its record carried one; the trace and the loop guard read it. */
  readonly status?: string;
}

/**
 * The standing a runtime hands the executor with each admitted invocation:
 * which run it belongs to, whether that run still stands, and the signal
 * every wait of the run settles on. The executor asks `isRevoked()` after
 * each step it awaited and once more before an effect, so an action prepared
 * inside a run that ended meanwhile is refused rather than dispatched.
 */
export interface ToolExecutionContext {
  readonly runId: string;
  readonly signal: AbortSignal;
  isRevoked(): boolean;
}

/** Executes one admitted invocation; the host supplies it, and everything it may do is the host's rule. */
export interface ToolExecutor {
  execute(invocation: ToolInvocation, context: ToolExecutionContext): Promise<ToolResult>;
}

export const REASONING_EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export type ReasoningEffort = (typeof REASONING_EFFORT)[keyof typeof REASONING_EFFORT];

export const ReasoningEffortSchema = Schema.Literal(...Object.values(REASONING_EFFORT));

const readsReasoningEffort = Schema.is(ReasoningEffortSchema);

export function isReasoningEffort(value: UnparsedWireValue): value is ReasoningEffort {
  return readsReasoningEffort(value);
}

/** What one inference is asked to do beyond the items it is shown. */
export interface ModelRequestOptions {
  /** The standing instructions, prepared by the host. */
  readonly prompt: string;
  readonly tools: readonly ToolSchema[];
  readonly maximumOutputTokens: number;
  readonly reasoningEffort?: ReasoningEffort;
  /**
   * Which prefix cache this inference should land against, when the transport
   * routes by one. A hint and nothing else: it names no session, since the
   * host hashes whatever it derived the key from before the key travels.
   */
  readonly promptCacheKey?: string;
  /**
   * One offered tool the model must call, by name, when the inference is a
   * classification rather than a turn: the transport that has a forced
   * choice forces it and turns parallel calls off. Absent, the model chooses.
   */
  readonly toolChoice?: string;
  /** Fires when the run this inference belongs to is cancelled or times out; the request is dropped with it. */
  readonly signal?: AbortSignal;
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** How much of the input the provider answered from its prefix cache, when it says; the trace reads it. */
  readonly cachedInputTokens?: number;
  /** How much of the output the provider spent reasoning before it wrote, when it says. */
  readonly reasoningTokens?: number;
}

/**
 * What one reasoning item says about itself in words: the provider's summary
 * of the reasoning behind the calls and words that followed it, read beside
 * the opaque item it belongs to. The item itself stays in the context for
 * replay and is never read inside; the summary is what a record keeps and a
 * client is shown.
 */
export interface ReasoningSummary {
  /** The provider's id for the reasoning item the summary describes. */
  readonly itemId: string;
  readonly summary: string;
  /** The item's encrypted content, lifted beside it by the adapter where the provider gives one, so a replay elsewhere can carry it. */
  readonly encryptedContent?: string;
  /** The item itself, opaque and whole, as the context ingested it; carried for a record and never read inside. */
  readonly item: WireRecord;
}

export const MODEL_RESPONSE_OUTCOME = {
  ANSWERED: "answered",
  /** Rate-limited or out of allowance; nothing was sent, and `until` says when to try again. */
  THROTTLED: "throttled",
  FAILED: "failed",
} as const;

/**
 * Why a model call failed, as a fixed word. A compatibility failure is the
 * one a host must never paper over: the adapter and the service it speaks to
 * disagree about the contract, and the honest answer is to stop, not to fall
 * back to an older behavior.
 */
export const MODEL_FAILURE = {
  COMPATIBILITY: "compatibility",
  NETWORK: "network",
  CREDENTIAL: "credential",
  UPSTREAM: "upstream",
  /** The answer came back but was not a response this adapter can read or replay. */
  MALFORMED: "malformed",
  /** The request would exceed a bound the transport fixes; nothing was sent. */
  BOUNDS: "bounds",
} as const;

export type ModelFailure = (typeof MODEL_FAILURE)[keyof typeof MODEL_FAILURE];

/** An answer stopped short, with the status and reason the provider gave. */
export interface ModelIncomplete {
  readonly status?: string;
  readonly reason: string;
}

/**
 * One inference, normalized: the provider items the context engine ingests
 * verbatim, the text the model wrote, the tool calls to dispatch, the usage
 * counted, and whether it stopped short. The items stay opaque here; only an
 * engine of the same format reads inside them.
 */
export interface ModelAnswer {
  readonly outcome: typeof MODEL_RESPONSE_OUTCOME.ANSWERED;
  readonly items: readonly WireRecord[];
  readonly text: string;
  readonly toolCalls: readonly ToolInvocation[];
  readonly usage?: ModelUsage;
  readonly incomplete?: ModelIncomplete;
  /** The provider's id for this response, when it named one; a run keeps every one it was answered with. */
  readonly responseId?: string;
  /** The summaries of the reasoning items this answer carried, in the order the items stand. */
  readonly reasoning?: readonly ReasoningSummary[];
}

export type ModelResponse =
  | ModelAnswer
  | { readonly outcome: typeof MODEL_RESPONSE_OUTCOME.THROTTLED; readonly until: number }
  | {
      readonly outcome: typeof MODEL_RESPONSE_OUTCOME.FAILED;
      readonly failure: ModelFailure;
      readonly reason: string;
    };

export type ModelTokenCount =
  | { readonly outcome: typeof MODEL_RESPONSE_OUTCOME.ANSWERED; readonly inputTokens: number }
  | { readonly outcome: typeof MODEL_RESPONSE_OUTCOME.THROTTLED; readonly until: number }
  | {
      readonly outcome: typeof MODEL_RESPONSE_OUTCOME.FAILED;
      readonly failure: ModelFailure;
      readonly reason: string;
    };

/** What a model adapter can do, and in whose checkpoint format it speaks. */
export interface ModelCapabilities {
  /** The adapter's own id, for the trace and the diagnostics line. */
  readonly adapter: string;
  /** The model the inferences run on, when the adapter knows it. */
  readonly model?: string;
  readonly checkpoint: CheckpointFormat;
  readonly countsInputTokens: boolean;
  /** The most output tokens one inference may be asked for. */
  readonly maximumOutputTokens: number;
  /** The tool names the adapter's transport will carry; absent means any schema travels whole. */
  readonly tools?: readonly string[];
  /** The model's context window in tokens, when the adapter knows it; the compaction policy reads it. */
  readonly contextWindowTokens?: number;
  /**
   * The most bytes one serialized request may weigh on this transport, when
   * the transport fixes one. It is an admission bound, separate from the
   * context window: the host prepares the context before a request would
   * cross it rather than letting the transport refuse.
   */
  readonly maximumRequestBytes?: number;
}

export type ModelCapabilitiesAnswer =
  | {
      readonly outcome: typeof MODEL_RESPONSE_OUTCOME.ANSWERED;
      readonly capabilities: ModelCapabilities;
    }
  | {
      readonly outcome: typeof MODEL_RESPONSE_OUTCOME.FAILED;
      readonly failure: ModelFailure;
      readonly reason: string;
    };

/**
 * One transport to one model. It carries inferences and answers them
 * normalized; it decides nothing about what to do with a tool call, keeps no
 * conversation, and executes nothing.
 */
export interface ModelAdapter {
  /** The model the adapter knows it runs on before any call; a hosted adapter learns it from capabilities. */
  readonly model?: string | undefined;
  capabilities(): Promise<ModelCapabilitiesAnswer>;
  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse>;
  countInputTokens(
    items: readonly WireRecord[],
    options: Pick<ModelRequestOptions, "prompt" | "tools" | "signal">,
  ): Promise<ModelTokenCount>;
  /** The moment held-back inferences may resume, for a host to ask before spending a turn. */
  quietUntil(): number | undefined;
}

export interface EmbeddingIdentity {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
}

export type EmbeddingBatch =
  | {
      readonly outcome: typeof MODEL_RESPONSE_OUTCOME.ANSWERED;
      readonly vectors: readonly (readonly number[])[];
    }
  | { readonly outcome: typeof MODEL_RESPONSE_OUTCOME.THROTTLED; readonly until: number }
  | {
      readonly outcome: typeof MODEL_RESPONSE_OUTCOME.FAILED;
      readonly failure: ModelFailure;
      readonly reason: string;
    };

/** Embeds batches of text and says which model, at what width, produced them. */
export interface EmbeddingAdapter {
  identity(): Promise<EmbeddingIdentity>;
  embed(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<EmbeddingBatch>;
}

export const CONTEXT_INPUT_KIND = {
  /** Words from the host: an ask, an observation, a released hold, each already marked as data. */
  USER_TEXT: "user_text",
  /** What a model answered, as the provider items it produced. */
  MODEL_OUTPUT: "model_output",
  /** The answer to one tool call, paired to the call by its id. */
  TOOL_RESULT: "tool_result",
} as const;

export type ContextInput =
  | { readonly kind: typeof CONTEXT_INPUT_KIND.USER_TEXT; readonly text: string }
  | {
      readonly kind: typeof CONTEXT_INPUT_KIND.MODEL_OUTPUT;
      readonly items: readonly WireRecord[];
    }
  | {
      readonly kind: typeof CONTEXT_INPUT_KIND.TOOL_RESULT;
      readonly callId: string;
      readonly outputJson: string;
    };

export interface ContextBootstrap {
  /** Whether the checkpoint's items were loaded; false leaves the engine empty. */
  readonly loaded: boolean;
  /** Why not, when they were not. */
  readonly reason?: string;
  /** How many dangling tool calls the engine had to pair with a lost-result answer. */
  readonly repaired: number;
}

/** What one assembly is shown beside the retained items: text the host rebuilds every call and never keeps. */
export interface ContextAssembly {
  readonly ephemeral: readonly string[];
}

/** A point to roll the engine back to when a turn fails partway. */
export interface ContextMark {
  readonly items: readonly WireRecord[];
}

/** A lifecycle hook may answer at once or after a wait; the runtime awaits either. */
export type MaybePromise<Value> = Value | Promise<Value>;

/**
 * What every lifecycle hook is handed beside its own arguments: the signal of
 * the run or generation the work belongs to. A hook that waits must settle
 * when it fires and apply nothing afterwards, because the runtime stops
 * waiting the moment it fires and the host may roll the engine back or reuse
 * it for the next run; a hook that answers at once may ignore it.
 */
export interface ContextLifecycle {
  readonly signal?: AbortSignal;
}

/**
 * Owns what the model sees: the provider's item shapes, how words become
 * items, how a compaction folds the past, and what persists as a checkpoint.
 * The engine holds retained state; the host decides when a turn commits or
 * rolls back, and persists the checkpoint the engine hands it. The lifecycle
 * hooks may be asynchronous — an engine backed by a store or a remote thread
 * is as much an engine as one holding an array — and the runtime awaits each
 * only until the run's signal fires. The three snapshot operations stay
 * synchronous because the host takes them inside its own serialized save,
 * where nothing may be awaited.
 */
export interface ContextEngine {
  readonly checkpointFormat: CheckpointFormat;
  /**
   * Loads a checkpoint, refusing one of another format, and answers a call a
   * crash left unpaired with the lost result: the envelope saying the call
   * was dispatched and its effect is unknown.
   */
  bootstrap(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResult: UnknownActionResult,
    lifecycle?: ContextLifecycle,
  ): MaybePromise<ContextBootstrap>;
  ingest(input: ContextInput, lifecycle?: ContextLifecycle): MaybePromise<void>;
  /** The items one inference is shown, the ephemeral text last so the retained prefix stays stable. */
  assemble(
    assembly: ContextAssembly,
    lifecycle?: ContextLifecycle,
  ): MaybePromise<readonly WireRecord[]>;
  /**
   * Replaces the retained items whole: a forked child's inherited history,
   * or the private copy a housekeeping turn runs over. What the items mean
   * is the caller's to know; the engine keeps them as the context from here.
   */
  adopt(items: readonly WireRecord[], lifecycle?: ContextLifecycle): MaybePromise<void>;
  /**
   * Folds the older retained items behind a summary the host writes for
   * them, keeping roughly `keepRecentTokens` of the most recent items and
   * never parting a tool call from its result or a reasoning item from the
   * call it preceded; answers how many items went, or zero when nothing was
   * folded — too little to fold, or a summary the host could not produce. An
   * engine whose items cannot be folded this way leaves it undefined.
   */
  foldBehindSummary?(
    summarize: (older: readonly WireRecord[]) => Promise<string | undefined>,
    keepRecentTokens: number,
    lifecycle?: ContextLifecycle,
  ): MaybePromise<number>;
  /** Maintenance once a turn has committed; nothing the model sees changes here. */
  afterTurn(lifecycle?: ContextLifecycle): MaybePromise<void>;
  mark(): ContextMark;
  rollback(mark: ContextMark): void;
  checkpoint(): RuntimeCheckpoint;
  dispose(): MaybePromise<void>;
}

export const RUNTIME_EVENT = {
  /** One inference answered; which tools it asked for, in order. */
  ANSWERED: "answered",
  /** Words steered into the run were ingested at a model boundary; how many, and the next checkpoint carries them. */
  STEERED: "steered",
  TEXT: "text",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
  USAGE: "usage",
  /** One inference was answered under a provider response id. */
  RESPONSE: "response",
  /** One reasoning item of an answer, after the answer's items are in the context. */
  REASONING: "reasoning",
  INCOMPLETE: "incomplete",
  THROTTLED: "throttled",
  PROVIDER_FAILURE: "provider_failure",
  CANCELLED: "cancelled",
  LOOP_GUARD: "loop_guard",
  ENDED: "ended",
} as const;

export const RUN_END_REASON = {
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  DEADLINE: "deadline",
  THROTTLED: "throttled",
  PROVIDER_FAILURE: "provider_failure",
  /** The model stopped without a reply. */
  INCOMPLETE: "incomplete",
  LOOP_GUARD: "loop_guard",
} as const;

/** What a run ended as: the reason, and what it carries for that reason. */
export type RuntimeRunEnd =
  | {
      readonly reason: typeof RUN_END_REASON.COMPLETED;
      /** The final answer's words, authoritative: empty when the model's last answer said nothing. */
      readonly text: string;
      /** Set when the final answer stopped short while still carrying words; the words are kept and the shortfall is not lost. */
      readonly incomplete?: ModelIncomplete;
    }
  | { readonly reason: typeof RUN_END_REASON.CANCELLED }
  | { readonly reason: typeof RUN_END_REASON.DEADLINE }
  | { readonly reason: typeof RUN_END_REASON.THROTTLED; readonly until: number }
  | {
      readonly reason: typeof RUN_END_REASON.PROVIDER_FAILURE;
      readonly failure: ModelFailure;
      readonly detail: string;
    }
  | { readonly reason: typeof RUN_END_REASON.INCOMPLETE; readonly detail: string }
  | { readonly reason: typeof RUN_END_REASON.LOOP_GUARD; readonly detail: string };

export type RuntimeEvent =
  | { readonly kind: typeof RUNTIME_EVENT.ANSWERED; readonly toolNames: readonly string[] }
  | { readonly kind: typeof RUNTIME_EVENT.STEERED; readonly inputs: number }
  | { readonly kind: typeof RUNTIME_EVENT.TEXT; readonly text: string }
  | { readonly kind: typeof RUNTIME_EVENT.TOOL_CALL; readonly invocation: ToolInvocation }
  | {
      readonly kind: typeof RUNTIME_EVENT.TOOL_RESULT;
      readonly invocation: ToolInvocation;
      readonly result: ToolResult;
    }
  | { readonly kind: typeof RUNTIME_EVENT.USAGE; readonly usage: ModelUsage }
  | { readonly kind: typeof RUNTIME_EVENT.RESPONSE; readonly responseId: string }
  | { readonly kind: typeof RUNTIME_EVENT.REASONING; readonly reasoning: ReasoningSummary }
  | { readonly kind: typeof RUNTIME_EVENT.INCOMPLETE; readonly incomplete: ModelIncomplete }
  | { readonly kind: typeof RUNTIME_EVENT.THROTTLED; readonly until: number }
  | {
      readonly kind: typeof RUNTIME_EVENT.PROVIDER_FAILURE;
      readonly failure: ModelFailure;
      readonly reason: string;
    }
  | { readonly kind: typeof RUNTIME_EVENT.CANCELLED; readonly deadline: boolean }
  | { readonly kind: typeof RUNTIME_EVENT.LOOP_GUARD; readonly detail: string }
  | { readonly kind: typeof RUNTIME_EVENT.ENDED; readonly end: RuntimeRunEnd };

/**
 * Hears every event of a run in order. The runtime awaits the listener
 * before it continues, so a host that records a tool's result before the
 * next inference has the guarantee by construction: the model is not asked
 * again until the listener has returned.
 */
type RuntimeEventListenerEffect = (event: RuntimeEvent) => Effect.Effect<void>;

/** The same listener as the Promise door still hands it in. */
type RuntimeEventListener = (event: RuntimeEvent) => void | Promise<void>;

/** One execution as a host asks for it. */
export interface RuntimeRunRequestEffect {
  readonly runId: string;
  readonly context: ContextEngine;
  readonly tools: ToolExecutor;
  readonly toolSchemas: readonly ToolSchema[];
  readonly prompt: string;
  /** The words that open the run, ingested before the first inference. */
  readonly input: readonly ContextInput[];
  /** Text rebuilt for every inference and never retained: the roster, the standing context. */
  readonly ephemeral: () => readonly string[];
  readonly maximumOutputTokens: number;
  readonly reasoningEffort?: ReasoningEffort;
  /** The prefix cache every inference of this run asks for, when the transport routes by one. */
  readonly promptCacheKey?: string;
  /**
   * Fires when the host revokes the run. Inside the run it is an
   * interruption: the runtime watches it and interrupts its own fiber, so no
   * wait the loop holds reads it. It stays an `AbortSignal` because it is
   * also what a dispatched tool's waits and a context engine's own hooks
   * settle on, and the host hands both of those in as promises.
   */
  readonly signal: AbortSignal;
  readonly onEvent: RuntimeEventListenerEffect;
}

/** One execution as the Promise door still asks for it. */
export interface RuntimeRunRequest extends Omit<RuntimeRunRequestEffect, "onEvent"> {
  readonly onEvent: RuntimeEventListener;
}

/**
 * A run the host holds: it may steer it with more words or cancel it, and
 * carries it to its end through `done`, which is the run itself rather than
 * a handle on one already going. Whoever holds the run runs `done` exactly
 * once — forked or awaited — and a cancel asked before that ends it the
 * instant it opens, exactly as one asked mid-flight does.
 */
export interface RuntimeRunEffect {
  readonly runId: string;
  /** Words for the model to read at the next safe boundary, before its next inference; answers false once the run has ended. */
  steer(input: ContextInput): boolean;
  /** Ends the run at the next safe point; a deadline is a cancel that says so. */
  cancel(reason?: { deadline: boolean }): void;
  readonly done: Effect.Effect<RuntimeRunEnd>;
}

/** A run under way, as the Promise door answers one: started already, and awaited rather than run. */
export interface RuntimeRun extends Omit<RuntimeRunEffect, "done"> {
  readonly done: Promise<RuntimeRunEnd>;
}

/** A context engine just opened, and what its bootstrap said about the checkpoint it was handed. */
export interface ContextOpening {
  readonly context: ContextEngine;
  readonly bootstrap: ContextBootstrap;
}

export interface RuntimeIdentity {
  readonly id: string;
  readonly checkpoint: CheckpointFormat;
  /** The model the runtime's inferences run on, when its adapter knows it. */
  readonly model?: string;
}

/** That a compaction happened, by which way and folding how much, or why it did not. */
export type RuntimeCompaction =
  | {
      readonly compacted: true;
      readonly source: CompactionSource;
      readonly dropped: number;
      /** The summary the older items were folded behind, where the compaction wrote one; a provider's opaque window carries none. */
      readonly summary?: string;
    }
  | { readonly compacted: false; readonly reason: string };

/** What a compaction runs under: the prompt the next request will carry, and the signal that ends the wait. */
export interface CompactionOptions {
  readonly prompt: string;
  readonly signal: AbortSignal;
}

/** Why a resume would not open the checkpoint it was handed, in the engine's own words. */
export class RuntimeResumeRefused extends Data.TaggedError("RuntimeResumeRefused")<{
  readonly reason: string;
}> {}

/**
 * Turns a request into normalized events over a model adapter, a context
 * engine, and a tool executor. It owns the loop between the model and the
 * tools and nothing outside it: no scheduling, no persistence, no policy
 * about what a tool may do.
 *
 * Every wait it holds is an effect, so the fiber a host runs it on is the
 * whole of its cancellation: an interruption reaches the model answer, the
 * engine's hooks, and the listener alike, and nothing is read after it. The
 * context engine, the model adapter, and the tool executor stay as the host
 * hands them in, because the host owns each by identity — it marks and rolls
 * back the engine it checkpoints, and folds the context through the same
 * adapter — and those three move when the host hands them in as layers.
 */
export interface AgentRuntimeEffect {
  readonly descriptor: RuntimeIdentity;
  /** The moment held-back inferences may resume, for a host to ask before opening a turn. */
  quietUntil(): number | undefined;
  /** What the runtime's model can do and how large its window is, for the host's compaction policy; nothing when it cannot say. */
  capabilities(): Effect.Effect<ModelCapabilities | undefined>;
  /**
   * Folds the context behind a summary so the next request fits. A fold that
   * did not happen is this answer's own `compacted: false` and not a failure:
   * the context is exactly as it was either way, and the host decides what a
   * refusal means for the turn that needed it.
   */
  compact(context: ContextEngine, options: CompactionOptions): Effect.Effect<RuntimeCompaction>;
  /** A context engine of this runtime's format, bootstrapped from the checkpoint when one is compatible, its unpaired calls answered with the lost result. */
  openContext(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResult: UnknownActionResult,
    lifecycle?: ContextLifecycle,
  ): Effect.Effect<ContextOpening>;
  /** The run, decided here and carried by whoever runs its `done`; steering and cancelling stand from this instant. */
  start(request: RuntimeRunRequestEffect): RuntimeRunEffect;
  /** A run over a context restored from the checkpoint, its unpaired calls answered with the lost result; a checkpoint of another format is refused. */
  resume(
    checkpoint: RuntimeCheckpoint,
    request: Omit<RuntimeRunRequestEffect, "context">,
    lostResult: UnknownActionResult,
  ): Effect.Effect<RuntimeRunEffect, RuntimeResumeRefused>;
}

/**
 * The same seam as the hosts still holding a promise read it.
 *
 * @deprecated Read `AgentRuntimeEffect` instead; P12-02 deletes this shape
 * with `promiseAgentRuntime` and the turn runner that holds it, once a turn
 * is a fiber.
 */
export interface AgentRuntime
  extends Omit<
    AgentRuntimeEffect,
    "capabilities" | "compact" | "openContext" | "start" | "resume"
  > {
  capabilities(): Promise<ModelCapabilities | undefined>;
  compact(context: ContextEngine, options: CompactionOptions): Promise<RuntimeCompaction>;
  openContext(
    checkpoint: RuntimeCheckpoint | undefined,
    lostResult: UnknownActionResult,
    lifecycle?: ContextLifecycle,
  ): Promise<ContextOpening>;
  start(request: RuntimeRunRequest): RuntimeRun;
  resume(
    checkpoint: RuntimeCheckpoint,
    request: Omit<RuntimeRunRequest, "context">,
    lostResult: UnknownActionResult,
  ): Promise<RuntimeRun | { readonly refused: string }>;
}

/** A runtime a run is carried on: the managed one an edge holds, or a plain one. */
export type ExecutionRuntime = ManagedRuntime.ManagedRuntime<never, never> | Runtime.Runtime<never>;

const exitsOn = (
  execution: ExecutionRuntime,
): (<Value>(effect: Effect.Effect<Value>) => Promise<Exit.Exit<Value>>) =>
  ManagedRuntime.TypeId in execution
    ? (effect) => execution.runPromiseExit(effect)
    : Runtime.runPromiseExit(execution);

const promisesOn = (
  execution: ExecutionRuntime,
): (<Value>(effect: Effect.Effect<Value>) => Promise<Value>) => {
  const exits = exitsOn(execution);
  return (effect) =>
    exits(effect).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      throw Cause.squash(exit.cause);
    });
};

const listenerEffect =
  (onEvent: RuntimeEventListener): RuntimeEventListenerEffect =>
  (event) =>
    Effect.promise(async () => {
      await onEvent(event);
    });

const runOn = (
  run: RuntimeRunEffect,
  carry: <Value>(effect: Effect.Effect<Value>) => Promise<Value>,
): RuntimeRun => ({
  runId: run.runId,
  steer: (input) => run.steer(input),
  cancel: (reason) => run.cancel(reason),
  done: carry(run.done),
});

/**
 * The `AgentRuntime` shape a host still holding a promise reads, over the
 * effects the runtime itself answers. Running here is a run outside a
 * runtime edge, which the rule allows precisely because this door is that
 * edge for as long as it exists: `AgentRuntime` is what declares a promise,
 * and the door goes with that declaration. A defect is squashed back to the
 * error that caused it, so a listener or an engine that threw reaches the
 * caller as the error it threw rather than as the fiber failure that carried
 * it, and a run's `done` is carried the instant `start` answers, so a host
 * that steers or cancels before it awaits reaches a run already going.
 *
 * @deprecated The strangler shim on the `Effect.runPromise` allowlist in
 * `docs/adr/0001-effect.md`; P12-02 deletes it with the turn runner that
 * holds it, once a turn is a fiber.
 */
export function promiseAgentRuntime(
  runtime: AgentRuntimeEffect,
  options: { readonly execution?: ExecutionRuntime } = {},
): AgentRuntime {
  const carry = promisesOn(options.execution ?? Runtime.defaultRuntime);
  return {
    // Read on each ask, because a hosted adapter learns its model only once
    // its capabilities have been answered.
    get descriptor(): RuntimeIdentity {
      return runtime.descriptor;
    },
    quietUntil: () => runtime.quietUntil(),
    capabilities: () => carry(runtime.capabilities()),
    compact: (context, compaction) => carry(runtime.compact(context, compaction)),
    openContext: (checkpoint, lostResult, lifecycle) =>
      carry(runtime.openContext(checkpoint, lostResult, lifecycle)),
    start: (request) =>
      runOn(runtime.start({ ...request, onEvent: listenerEffect(request.onEvent) }), carry),
    resume: (checkpoint, request, lostResult) =>
      carry(
        Effect.either(
          runtime.resume(
            checkpoint,
            { ...request, onEvent: listenerEffect(request.onEvent) },
            lostResult,
          ),
        ),
      ).then((resumed) =>
        Either.isLeft(resumed) ? { refused: resumed.left.reason } : runOn(resumed.right, carry),
      ),
  };
}
