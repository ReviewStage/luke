import type { Schema, WireRecord } from "@sidecar/wire";
import type { ToolExecutionContext } from "./execution.js";
import type { RunOrigin } from "./identifiers.js";
import type { TOOL_EFFECT } from "./registry.js";

/**
 * The memory provider contract, the seam eve's runtime uses for durable
 * memory and the one the notebook stands behind here: `recall` before a
 * turn, answering messages for the model's context; `capture` at a
 * compaction or a reset, writing what the conversation is about to let go
 * of; and `tools`, the model-facing calls the provider owns. The host owns
 * the scope, the timing, and the journal; the provider owns storage,
 * retrieval, and what it lets a call do. Nothing here reads inside a
 * provider's item, and nothing here reaches a model.
 */

export const MEMORY_SCOPE_KIND = {
  /** Whose memory: the account's. On this Mac the one agent's workspace is the one account's notebook. */
  ACCOUNT: "account",
} as const;

type MemoryScopeKind = (typeof MEMORY_SCOPE_KIND)[keyof typeof MEMORY_SCOPE_KIND];

/** Whose memory a call reads or writes, resolved by the host and never by a model. */
export interface MemoryScope {
  readonly kind: MemoryScopeKind;
  readonly key: string;
}

export function sameMemoryScope(a: MemoryScope, b: MemoryScope): boolean {
  return a.kind === b.kind && a.key === b.key;
}

/**
 * One message a recall answers. A keyed message stands in the turn's
 * ephemeral context under its id, re-rendered every turn and stored nowhere;
 * an unkeyed one is appended to the conversation's own context once, as
 * words said, and never again.
 */
export interface MemoryRecallMessage {
  readonly content: string;
  readonly id?: string;
}

export interface MemoryRecallResult {
  readonly messages: readonly MemoryRecallMessage[];
}

/** What a recall may read of the conversation: its context as the engine holds it, empty for one opening fresh. */
export interface MemoryRecallHistory {
  readonly items: readonly WireRecord[];
  readonly signal: AbortSignal;
}

export const MEMORY_CAPTURE_PHASE = {
  /** The context is about to be compacted; the pre-compaction flush. */
  COMPACTION_REQUESTED: "compaction.requested",
  /** The conversation is about to start fresh; the reset capture. */
  RESET_REQUESTED: "reset.requested",
} as const;

export type MemoryCapturePhase = (typeof MEMORY_CAPTURE_PHASE)[keyof typeof MEMORY_CAPTURE_PHASE];

/**
 * How a capture ended. Only `completed` and `nothing-to-store` mean it ran
 * to its end; an interrupted or failed capture is not marked done, so the
 * cycle that asked for it runs it again.
 */
export const MEMORY_CAPTURE_OUTCOME = {
  COMPLETED: "completed",
  NOTHING_TO_STORE: "nothing-to-store",
  SKIPPED: "skipped",
  INTERRUPTED: "interrupted",
  FAILED: "failed",
} as const;

export type MemoryCaptureOutcome =
  (typeof MEMORY_CAPTURE_OUTCOME)[keyof typeof MEMORY_CAPTURE_OUTCOME];

export interface MemoryCaptureResult {
  readonly outcome: MemoryCaptureOutcome;
  /** How many writes the capture committed; each stands whatever the capture's end. */
  readonly writes: number;
  readonly reason?: string;
}

/** Which cycle of which lifetime a capture belongs to, so a provider can tell a retry from a second ask. */
interface MemoryCaptureOperation {
  readonly generationId: string;
  readonly compactionCount: number;
}

/** What a capture is handed: a copy of the context, never the engine, and the standing it runs under. */
export interface MemoryCaptureTurn {
  readonly scope: MemoryScope;
  readonly phase: MemoryCapturePhase;
  readonly operation: MemoryCaptureOperation;
  readonly items: readonly WireRecord[];
  readonly signal: AbortSignal;
}

/** The standing a memory tool's call runs under: the run's, who opened it, and whose memory it reaches. */
export interface MemoryToolContext extends ToolExecutionContext {
  readonly origin: RunOrigin;
  readonly scope: MemoryScope;
}

/**
 * One tool a provider owns, in the module shape every tool of the brain is
 * declared in: its name, what it does in the model's words, the wire schema
 * of what it takes (declared once; it parses a call and emits what the model
 * is shown), whether the call reads or writes, and the one `execute` that
 * carries a call whose arguments parsed as a record. A write runs through the
 * host's journal like every other effect; a memory tool never speaks.
 */
export interface MemoryTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema<unknown>;
  readonly effect: typeof TOOL_EFFECT.READ | typeof TOOL_EFFECT.WRITE;
  execute(input: WireRecord, context: MemoryToolContext): Promise<WireRecord>;
}

export interface MemoryProvider {
  recall(scope: MemoryScope, history: MemoryRecallHistory): Promise<MemoryRecallResult>;
  /** Absent on a provider bound to a conversation whose memory is never captured. */
  capture?(turn: MemoryCaptureTurn): Promise<MemoryCaptureResult>;
  readonly tools: readonly MemoryTool[];
}

/** A provider bound to the scope it serves for one conversation, as the host hands it to a brain. */
export interface MemoryDefinition {
  readonly scope: MemoryScope;
  readonly provider: MemoryProvider;
}

export function memoryToolNamed(provider: MemoryProvider, name: string): MemoryTool | undefined {
  return provider.tools.find((tool) => tool.name === name);
}
