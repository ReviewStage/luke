import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { writtenText } from "./service-wire.js";

/**
 * What the act endpoints answer: whether the provider took the act, and the
 * one identifier a creation names. The reason travels as written, because it
 * is a sentence a person reads.
 */

/**
 * The three outcomes a hosted act endpoint can return. Values match
 * `ACT_RESULT_STATUS` in `@sidecar/acts` so the mobile client and the desktop
 * can share the same vocabulary without a direct dependency on that package.
 */
export const HOSTED_ACT_RESULT = {
  /** The provider accepted the act. */
  ACCEPTED: "accepted",
  /** The provider or server refused the act; `reason` says why. */
  REJECTED: "rejected",
  /** The act is not available for this provider via mobile yet. */
  UNSUPPORTED: "unsupported",
} as const;

export type HostedActResult = (typeof HOSTED_ACT_RESULT)[keyof typeof HOSTED_ACT_RESULT];

/** What the message and workspace-creation act endpoints return. */
export interface HostedActAnswer {
  result: HostedActResult;
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
    result: s.enumOf(Object.values(HOSTED_ACT_RESULT), { ends: TEXT_ENDS.TRIM }),
    reason: s.dropRefused(writtenText()),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export const hostedActWorkspaceAnswerSchema: Schema<HostedActWorkspaceAnswer> = s.record(
  {
    result: s.enumOf(Object.values(HOSTED_ACT_RESULT), { ends: TEXT_ENDS.TRIM }),
    reason: s.dropRefused(writtenText()),
    providerSessionId: s.dropRefused(writtenText()),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);
