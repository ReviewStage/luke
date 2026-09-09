import {
  ACT_RESULT_STATUS,
  type ActResultStatus,
  RECORD_EXTRA_KEYS,
  type Schema,
  s,
  TEXT_ENDS,
} from "@sidecar/wire";
import { writtenText } from "./service-wire.js";

/**
 * What the act endpoints answer: whether the provider took the act, and the
 * one identifier a creation names. The reason travels as written, because it
 * is a sentence a person reads.
 */

/**
 * What the message and workspace-creation act endpoints return. The outcome
 * is `ACT_RESULT_STATUS`, the vocabulary every adapter already answers an act
 * in, under the field name the phone reads. It is the status alone and never
 * the adapter's whole `ActResult`: the reason is optional here, and the
 * workspace form carries a field of its own.
 */
export interface HostedActAnswer {
  result: ActResultStatus;
  /** Human-readable reason; present on rejected and unsupported results. */
  reason?: string;
}

/** What the workspace-creation act endpoint returns. */
export interface HostedActWorkspaceAnswer extends HostedActAnswer {
  /** The created session's provider id, when the provider reports one. */
  providerSessionId?: string;
}

export const hostedActAnswerSchema: Schema<HostedActAnswer> = s.record(
  {
    result: s.enumOf(Object.values(ACT_RESULT_STATUS), { ends: TEXT_ENDS.TRIM }),
    reason: s.dropRefused(writtenText()),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export const hostedActWorkspaceAnswerSchema: Schema<HostedActWorkspaceAnswer> = s.record(
  {
    result: s.enumOf(Object.values(ACT_RESULT_STATUS), { ends: TEXT_ENDS.TRIM }),
    reason: s.dropRefused(writtenText()),
    providerSessionId: s.dropRefused(writtenText()),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
