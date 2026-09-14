import {
  isWireString,
  type UnknownActionResult,
  type UnparsedWireValue,
  type WireRecord,
} from "@sidecar/wire";
import { Schema } from "effect";

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

export const REASONING_EFFORT = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export type ReasoningEffort = (typeof REASONING_EFFORT)[keyof typeof REASONING_EFFORT];

export const ReasoningEffortSchema = Schema.Literals(Object.values(REASONING_EFFORT));

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

type ModelFailure = (typeof MODEL_FAILURE)[keyof typeof MODEL_FAILURE];

/** An answer stopped short, with the status and reason the provider gave. */
interface ModelIncomplete {
  readonly status?: string;
  readonly reason: string;
}

/**
 * One inference, normalized: the provider items the context engine ingests
 * verbatim, the text the model wrote, the tool calls to dispatch, the usage
 * counted, and whether it stopped short. The items stay opaque here; only an
 * engine of the same format reads inside them.
 */
interface ModelAnswer {
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

export const CONTEXT_INPUT_KIND = {
  /** Words from the host: an ask, an observation, a released hold, each already marked as data. */
  USER_TEXT: "user_text",
  /** What a model answered, as the provider items it produced. */
  MODEL_OUTPUT: "model_output",
  /** The answer to one tool call, paired to the call by its id. */
  TOOL_RESULT: "tool_result",
} as const;

type ContextInput =
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
interface ContextLifecycle {
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
