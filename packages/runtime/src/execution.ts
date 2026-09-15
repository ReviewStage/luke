import type { WireRecord } from "@sidecar/wire";

/**
 * The seams along which Luke's reasoning is replaceable. A host owns the
 * conversation — accepting asks, recording runs, journaling effects — and
 * reaches a model only through these interfaces: an agent runtime that turns
 * a request into normalized events, a model adapter that carries one
 * inference, and a tool executor the host supplies. Nothing here names a
 * provider: a provider's own vocabulary (an OpenAI Responses item, an
 * encrypted reasoning item) travels as an opaque record.
 */

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
