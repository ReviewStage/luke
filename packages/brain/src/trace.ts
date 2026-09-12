import type { RunOrigin } from "@sidecar/runtime/vocabulary";
import type { BrainTurnTrigger } from "./turn.js";

export interface BrainToolCallTrace {
  name: string;
  argumentsChars: number;
  outcomeStatus: string;
  /** Set when the call and its answer were read ahead of the turn and entered its opening input rather than being asked for by the model. */
  prefetched?: boolean;
}

/** What one anticipation of a spoken ask came to. */
export const BRAIN_PREFETCH_OUTCOME = {
  /** No planner stands: no small model, or a hosted service that does not offer the prefetch. */
  UNAVAILABLE: "unavailable",
  /** The planner answered and every read it named that the roster allows was made. */
  PLANNED: "planned",
  /** The planner failed, or was superseded or dropped before it answered. */
  FAILED: "failed",
} as const;

export type BrainPrefetchOutcome =
  (typeof BRAIN_PREFETCH_OUTCOME)[keyof typeof BRAIN_PREFETCH_OUTCOME];

/** What a spoken turn found when it took the prefetch slot. */
export const BRAIN_PREFETCH_TAKE = {
  HIT: "hit",
  /** The reads were still under way and finished inside the turn's wait. */
  HIT_WAITED: "hit-waited",
  MISS_NONE: "miss-none",
  MISS_EXPIRED: "miss-expired",
  MISS_TIMEOUT: "miss-timeout",
  MISS_REVOKED: "miss-revoked",
} as const;

export type BrainPrefetchTake = (typeof BRAIN_PREFETCH_TAKE)[keyof typeof BRAIN_PREFETCH_TAKE];

/**
 * One prefetch moment as the development trace records it: an anticipation's
 * outcome with the size of the words so far and how many reads it made, or a
 * turn's take with how long it waited — counts and kinds, never the words,
 * the plan, or what a read answered.
 */
export interface BrainPrefetchTraceRecord {
  outcome?: BrainPrefetchOutcome;
  take?: BrainPrefetchTake;
  /** How long a take waited on reads still under way, when it waited. */
  waitedMs?: number;
  /** How many characters of the ask had been said when the anticipation was planned. */
  chars?: number;
  /** How many reads the plan made, or the take handed the turn. */
  reads?: number;
  /** How long the summary the voice was handed ran, when one was written. */
  summaryChars?: number;
  elapsedMs?: number;
  error?: string;
}

/**
 * One turn as the development trace records it: what woke it, who opened
 * it, the tools the policy offered it by name, the kinds of item it
 * appended, the input size the API counted, how many transcript characters
 * it read, each tool call by name and outcome, the text and briefings it
 * produced, and how it ran — never a transcript's text, and never the
 * prompt's.
 */
export interface BrainTurnTraceRecord {
  trigger: BrainTurnTrigger;
  origin: RunOrigin;
  /** Which agent runtime ran the turn, by its id. */
  runtime: string;
  /** The tools the effective policy offered, by name. */
  tools: readonly string[];
  promptChars: number;
  inputTokens?: number;
  transcriptBytes: number;
  toolCalls: readonly BrainToolCallTrace[];
  outputText?: string;
  /** Why the final answer stopped short, when it did while still carrying words. */
  incomplete?: string;
  deliveries: readonly { briefingChars: number }[];
  model?: string;
  elapsedMs: number;
  /** How many inferences answered with tool calls; the loop has no cap on them. */
  iterations: number;
  error?: string;
}
