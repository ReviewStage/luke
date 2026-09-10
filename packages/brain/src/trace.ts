import type { RunOrigin } from "@sidecar/runtime/vocabulary";
import type { BrainTurnTrigger } from "./turn.js";

export interface BrainToolCallTrace {
  name: string;
  argumentsChars: number;
  outcomeStatus: string;
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
