import type { WireRecord } from "@repo/wire";

export interface ToolInvocation {
  readonly callId: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface ReasoningSummary {
  readonly itemId: string;
  readonly summary: string;
  readonly encryptedContent?: string;
  readonly item: WireRecord;
}
