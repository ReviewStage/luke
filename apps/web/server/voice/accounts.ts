import type { Effect } from "effect";
import type {
  HostedSpend,
  IntroductionSpend,
  QuotaEffect,
  VoiceSecondsOutcome,
} from "../hosted/quota.js";

/**
 * What the voice functions ask of the account side of this same deployment,
 * as direct calls rather than routes: whose socket this is, whether their
 * allowance covers one more session, whether the accountless introduction's
 * shared ceiling has room for one more, and what one closed session cost. A
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
  resolveUserId(authorization: string): Effect.Effect<string | undefined>;
  /** Spends one session of the account's daily allowance. */
  spend(userId: string): QuotaEffect<HostedSpend>;
  /** Spends one introduction of the deployment's shared daily ceiling, the one the introduction mint spends. */
  spendIntroduction(): QuotaEffect<IntroductionSpend>;
  /** Records a closed session's billed seconds once. */
  recordSeconds(input: {
    userId: string;
    sessionId: string;
    seconds: number;
  }): QuotaEffect<VoiceSecondsOutcome>;
}
