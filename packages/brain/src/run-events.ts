import { type EffectiveToolPolicy, TOOL_EXECUTION } from "@sidecar/runtime";
import type { BrainRequestFailure, BrainRequestStatus } from "./requests.js";
import { BRAIN_TOOL } from "./tools.js";

/**
 * What a recorded run tells whoever is relaying it into a live conversation,
 * as it happens: the one moment it begins a step worth a spoken update, the
 * moment every action it took has its result journaled, the final answer a
 * sentence at a time once that moment has passed, and its end. The events
 * carry the run's id and the record's own vocabulary, never a transcript,
 * and a listener that throws ends no turn.
 */

export const BRAIN_RUN_EVENT = {
  /** The run began a step slow enough to be worth telling the developer about; fired once per run. */
  SLOW_STEP: "slow_step",
  /** Every action the run dispatched has its result journaled; nothing it did is still uncertain. */
  ACTIONS_SETTLED: "actions_settled",
  /** One sentence of the final answer, in order, after the actions settled. */
  REPLY_SENTENCE: "reply_sentence",
  /** The run's record reached a terminal status. */
  ENDED: "ended",
} as const;

/** The kinds of step that count as slow: a whole transcript read, or a write the provider carries. */
export const SLOW_STEP_KIND = {
  TRANSCRIPT_READ: "transcript_read",
  PROVIDER_WRITE: "provider_write",
} as const;

export type SlowStepKind = (typeof SLOW_STEP_KIND)[keyof typeof SLOW_STEP_KIND];

export type BrainRunEvent =
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.SLOW_STEP;
      readonly runId: string;
      readonly step: SlowStepKind;
    }
  | { readonly kind: typeof BRAIN_RUN_EVENT.ACTIONS_SETTLED; readonly runId: string }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.REPLY_SENTENCE;
      readonly runId: string;
      readonly sentence: string;
    }
  | {
      readonly kind: typeof BRAIN_RUN_EVENT.ENDED;
      readonly runId: string;
      readonly status: BrainRequestStatus;
      readonly text?: string;
      readonly failure?: BrainRequestFailure;
    };

/** Which slow step a tool call the policy offers begins, or nothing for a call that is neither slow nor offered. */
export function slowStepOf(policy: EffectiveToolPolicy, name: string): SlowStepKind | undefined {
  const tool = policy.allowed.find((candidate) => candidate.schema.name === name);
  if (!tool) return undefined;
  if (tool.execution === TOOL_EXECUTION.PERFORMER) return SLOW_STEP_KIND.PROVIDER_WRITE;
  if (name === BRAIN_TOOL.READ_TRANSCRIPT) return SLOW_STEP_KIND.TRANSCRIPT_READ;
  return undefined;
}

const SENTENCE_BOUNDARY = /(?<=[.!?…]["'”’)\]]*)\s+|\n+/;

/** A reply as the sentences it is spoken in: split at sentence ends and line breaks, each trimmed, none empty. */
export function replySentences(text: string): readonly string[] {
  return text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
