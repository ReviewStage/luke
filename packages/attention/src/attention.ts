import { isRecord, isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * The decision vocabulary of the released attention contract, kept here as a
 * compatibility type and not in the session model: the desktop no longer
 * evaluates attention this way, but released clients still ask the hosted
 * service to, and the answer they parse is this one.
 */
export const ATTENTION_DISPOSITION = {
  SILENT: "silent",
  SPEAK_DURING_TURN: "speak-during-turn",
  SPEAK_AT_TURN_END: "speak-at-turn-end",
} as const;

export type AttentionDisposition =
  (typeof ATTENTION_DISPOSITION)[keyof typeof ATTENTION_DISPOSITION];

/** One judgment about one session and no words at all. */
export interface AttentionDecision {
  disposition: AttentionDisposition;
  decidedAt: number;
}

export const ATTENTION_TRIGGER = {
  OBSERVED: "observed",
  STATUS_CHANGED: "status-changed",
  ERROR_REPORTED: "error-reported",
} as const;

export type AttentionTrigger = (typeof ATTENTION_TRIGGER)[keyof typeof ATTENTION_TRIGGER];

export const ATTENTION_DECISION_SCHEMA_NAME = "attention_decision";

const ATTENTION_DISPOSITIONS: readonly AttentionDisposition[] =
  Object.values(ATTENTION_DISPOSITION);

/**
 * What each disposition means, in the wording an evaluator is shown. The
 * schema description and the evaluator instructions both come from here, so
 * they cannot drift.
 */
export const DISPOSITION_GUIDANCE = {
  [ATTENTION_DISPOSITION.SILENT]: "say nothing. This is the correct answer for most updates.",
  [ATTENTION_DISPOSITION.SPEAK_DURING_TURN]:
    "interrupt now, only when the session cannot progress until the developer acts.",
  [ATTENTION_DISPOSITION.SPEAK_AT_TURN_END]:
    "wait for a natural pause, then report a session that reached a resting point.",
} as const satisfies Record<AttentionDisposition, string>;

/** The judgment-only decision schema the versioned contract asks the model for. */
export const ATTENTION_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["disposition"],
  properties: {
    disposition: {
      type: "string",
      enum: ATTENTION_DISPOSITIONS,
      description: ATTENTION_DISPOSITIONS.map(
        (disposition) => `${disposition}: ${DISPOSITION_GUIDANCE[disposition]}`,
      ).join(" "),
    },
  },
};

/**
 * The part of a session's context a review is given: what the decision turns
 * on and nothing that only the local surface needs. The session's own
 * address and the change it published are identifiers, not evidence, so they
 * stay behind.
 */
export interface AttentionContext {
  repository?: string;
  branch?: string;
  activity?: string;
  error?: string;
}

/**
 * Validates untrusted model output against the decision contract. A malformed
 * response is discarded rather than repaired.
 */
export function attentionDecisionFromModel(
  value: UnparsedWireValue,
  decidedAt: number,
): AttentionDecision | undefined {
  if (!isRecord(value) || !isWireString(value.disposition)) return undefined;
  const disposition = ATTENTION_DISPOSITIONS.find((candidate) => candidate === value.disposition);
  if (!disposition) return undefined;
  if (!Number.isFinite(decidedAt)) return undefined;
  return { disposition, decidedAt };
}
