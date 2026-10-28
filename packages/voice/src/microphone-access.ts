import { VOICE_FAILURE, type VoiceFailure } from "@luke/features/words";
import { LIVE_SESSION_OUTCOME, type LiveDiagnostics } from "@luke/live";

/**
 * The failure a session the service refused is said as, where the reason is
 * one the developer can read: the hosted emergency brake, a call into an
 * agent that runs natively, which takes no call yet, a call with no OpenAI
 * key saved, or one whose saved key OpenAI refused or found unfunded, or one
 * into an agent no credential of its starter's pays for.
 */
export function hostedVoiceFailure(
  diagnostics: LiveDiagnostics | undefined,
): VoiceFailure | undefined {
  switch (diagnostics?.lastOutcome) {
    case LIVE_SESSION_OUTCOME.QUOTA_EXHAUSTED:
      return VOICE_FAILURE.VOICE_UNAVAILABLE;
    case LIVE_SESSION_OUTCOME.NATIVE_AGENT_NOT_HERE:
      return VOICE_FAILURE.NATIVE_AGENT;
    case LIVE_SESSION_OUTCOME.OPENAI_KEY_MISSING:
      return VOICE_FAILURE.OPENAI_KEY_MISSING;
    case LIVE_SESSION_OUTCOME.OPENAI_KEY_REFUSED:
      return VOICE_FAILURE.OPENAI_KEY_REFUSED;
    case LIVE_SESSION_OUTCOME.OPENAI_KEY_UNFUNDED:
      return VOICE_FAILURE.OPENAI_KEY_UNFUNDED;
    case LIVE_SESSION_OUTCOME.AGENT_CREDENTIAL_MISSING:
      return VOICE_FAILURE.AGENT_KEY_MISSING;
    default:
      return undefined;
  }
}
