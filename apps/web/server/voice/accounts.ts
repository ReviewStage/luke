import type { UserIdResolver } from "../hosted/http-effect.js";
import type { QuotaEffect, VoiceSecondsOutcome } from "../hosted/quota.js";

/**
 * What the voice function asks of the account side of this same deployment,
 * as direct calls rather than routes: whose socket this is, one more session
 * counted against them, and what one closed session cost. A
 * signed-in device's bearer is resolved exactly as every hosted route resolves
 * the one on its own request, and is held no longer than the handshake it
 * arrived on.
 *
 * Each meter answers an effect over the ambient client rather than running
 * one, so the session's own effect yields it on its own fiber and the edge
 * that stood the service is the one place the client behind it is provided.
 */
export interface VoiceAccounts {
  /** The account behind an `Authorization` value, or nothing, yielded on the session's own fiber. */
  resolveUserId: UserIdResolver<string>;
  /** Counts one session against the account's day. */
  spend(userId: string): QuotaEffect<void>;
  /** Records a closed session's billed seconds once. */
  recordSeconds(input: {
    userId: string;
    sessionId: string;
    seconds: number;
  }): QuotaEffect<VoiceSecondsOutcome>;
}
