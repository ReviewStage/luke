import type { HostedQuota } from "../core.js";
import type { HostedSpend, VoiceSecondsOutcome } from "../hosted/quota.js";

/**
 * What the voice functions ask of the account side of this same deployment,
 * as direct calls rather than routes: whose socket this is, whether their
 * allowance covers one more session, which account created a session a
 * connection wants back, and what one closed session cost. The desktop's
 * bearer is resolved exactly as every hosted route resolves the one on its own
 * request, and is held no longer than the handshake it arrived on.
 */

export const AUTHORIZE_OUTCOME = {
  AUTHORIZED: "authorized",
  /** No account stands behind the bearer. */
  NOT_SIGNED_IN: "not-signed-in",
  /** The account's daily allowance is spent. */
  QUOTA_EXHAUSTED: "quota-exhausted",
} as const;

export type AuthorizeResult =
  | { outcome: typeof AUTHORIZE_OUTCOME.AUTHORIZED; userId: string; quota: HostedQuota }
  | { outcome: typeof AUTHORIZE_OUTCOME.NOT_SIGNED_IN }
  | { outcome: typeof AUTHORIZE_OUTCOME.QUOTA_EXHAUSTED; quota: HostedQuota };

export interface VoiceAccounts {
  /** The account behind an `Authorization` value, or nothing. */
  resolveUserId(authorization: string): Promise<string | undefined>;
  /** Spends one session of the account's daily allowance. */
  spend(userId: string): Promise<HostedSpend>;
  /** Writes down which account a session was created for. */
  registerSession(input: { userId: string; sessionId: string }): Promise<void>;
  /** The account a session was created for, or nothing. */
  sessionOwner(sessionId: string): Promise<string | undefined>;
  /** Records a closed session's billed seconds once. */
  recordSeconds(input: {
    userId: string;
    sessionId: string;
    seconds: number;
  }): Promise<VoiceSecondsOutcome>;
}

/** Resolves the bearer and spends the allowance, in that order, so a refused account costs no session. */
export async function authorizeSession(
  accounts: VoiceAccounts,
  authorization: string,
): Promise<AuthorizeResult> {
  const userId = await accounts.resolveUserId(authorization);
  if (userId === undefined) return { outcome: AUTHORIZE_OUTCOME.NOT_SIGNED_IN };
  const spend = await accounts.spend(userId);
  if (!spend.allowed) return { outcome: AUTHORIZE_OUTCOME.QUOTA_EXHAUSTED, quota: spend.quota };
  return { outcome: AUTHORIZE_OUTCOME.AUTHORIZED, userId, quota: spend.quota };
}
