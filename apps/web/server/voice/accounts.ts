import type { HostedSpend, VoiceSecondsOutcome } from "../hosted/quota.js";

/**
 * What the voice functions ask of the account side of this same deployment,
 * as direct calls rather than routes: whose socket this is, whether their
 * allowance covers one more session, and what one closed session cost. The desktop's
 * bearer is resolved exactly as every hosted route resolves the one on its own
 * request, and is held no longer than the handshake it arrived on.
 */
export interface VoiceAccounts {
  /** The account behind an `Authorization` value, or nothing. */
  resolveUserId(authorization: string): Promise<string | undefined>;
  /** Spends one session of the account's daily allowance. */
  spend(userId: string): Promise<HostedSpend>;
  /** Records a closed session's billed seconds once. */
  recordSeconds(input: {
    userId: string;
    sessionId: string;
    seconds: number;
  }): Promise<VoiceSecondsOutcome>;
}
