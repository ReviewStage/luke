import type { WireRecord } from "@sidecar/wire";

/**
 * What one inference reports about itself, as the brain's run stream and
 * its message builder carry it. Nothing here names a provider: a provider's
 * own vocabulary (an OpenAI Responses item, an encrypted reasoning item)
 * travels as an opaque record.
 */

/** One tool call a model emitted, as the runtime hands it to the executor. */
export interface ToolInvocation {
  readonly callId: string;
  readonly name: string;
  readonly argumentsJson: string;
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
