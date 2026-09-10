import { type VoiceUsageAnswer, type VoiceUsageRequest, voiceUsageRequestSchema } from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { VOICE_SECONDS_OUTCOME, type VoiceSecondsOutcome } from "./quota.js";
import { admitVoiceServiceRequest } from "./voice-service-secret.js";

/**
 * Takes the hosted voice service's report of what one closed GPT Live session
 * cost, in the seconds `session.closed` named, and records it once per
 * session id. The service may report the same session again after a lost
 * answer; the second report is answered as repeated and moves nothing.
 */

export interface VoiceUsageOptions {
  request: Request;
  /** The value of VOICE_SERVICE_SECRET; undefined means the env var is absent and the route is off. */
  serviceSecret: string | undefined;
  record: (report: VoiceUsageRequest) => Promise<VoiceSecondsOutcome>;
}

export async function handleVoiceUsage(options: VoiceUsageOptions): Promise<Response> {
  const report = await admitVoiceServiceRequest(
    options.request,
    options.serviceSecret,
    voiceUsageRequestSchema,
  );
  if (report instanceof Response) return report;

  const outcome = await options.record(report);
  if (outcome === VOICE_SECONDS_OUTCOME.UNKNOWN_USER) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const answer: VoiceUsageAnswer = { record: outcome };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
