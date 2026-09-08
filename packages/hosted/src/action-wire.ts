import {
  ACTION_RESULT_STATUS,
  type ActionResultStatus,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  TEXT_ENDS,
} from "@sidecar/wire";
import { writtenText } from "./service-wire.js";

/**
 * What the action endpoints answer: whether the provider took the action, and the
 * one identifier a creation names. The reason travels as written, because it
 * is a sentence a person reads.
 */

/**
 * What the message and workspace-creation action endpoints return. The outcome
 * is `ACTION_RESULT_STATUS`, the vocabulary every adapter already answers an action
 * in, under the field name the phone reads. It is the status alone and never
 * the adapter's whole `ActionResult`: the reason is optional here, and the
 * workspace form carries a field of its own.
 */
export interface HostedActionAnswer {
  result: ActionResultStatus;
  /** Human-readable reason; present on rejected and unsupported results. */
  reason?: string;
}

/** What the workspace-creation action endpoint returns. */
export interface HostedActionWorkspaceAnswer extends HostedActionAnswer {
  /** The created session's provider id, when the provider reports one. */
  providerSessionId?: string;
}

/** What every action answer carries: the outcome, and the sentence a rejection is worded in. */
const ACTION_FIELDS = {
  result: s.enumOf(Object.values(ACTION_RESULT_STATUS), { ends: TEXT_ENDS.TRIM }),
  reason: s.dropRefused(writtenText),
} as const;

export const hostedActionAnswerSchema: Schema<HostedActionAnswer> = s.record(ACTION_FIELDS, {
  extraKeys: RECORD_EXTRA_KEYS.IGNORE,
});

export const hostedActionWorkspaceAnswerSchema: Schema<HostedActionWorkspaceAnswer> = s.record(
  { ...ACTION_FIELDS, providerSessionId: s.dropRefused(writtenText) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
