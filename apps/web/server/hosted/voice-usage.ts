import {
  type UnparsedWireValue,
  VOICE_USAGE_RECORD,
  type VoiceUsageAnswer,
  type VoiceUsageRecord,
  voiceUsageRequestSchema,
} from "../core.js";
import {
  BODY_READ,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readBoundedBody,
} from "./http.js";
import { VOICE_SECONDS_OUTCOME, type VoiceSecondsOutcome } from "./quota.js";
import { refuseUnlessVoiceService, VOICE_INTERNAL_BODY_BYTES } from "./voice-service-secret.js";

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
  record: (input: {
    userId: string;
    sessionId: string;
    seconds: number;
  }) => Promise<VoiceSecondsOutcome>;
}

const ANSWERED_RECORD = {
  [VOICE_SECONDS_OUTCOME.RECORDED]: VOICE_USAGE_RECORD.RECORDED,
  [VOICE_SECONDS_OUTCOME.REPEATED]: VOICE_USAGE_RECORD.REPEATED,
} as const satisfies Record<
  Exclude<VoiceSecondsOutcome, typeof VOICE_SECONDS_OUTCOME.UNKNOWN_USER>,
  VoiceUsageRecord
>;

export async function handleVoiceUsage(options: VoiceUsageOptions): Promise<Response> {
  const { request } = options;
  const refused = refuseUnlessVoiceService(request, options.serviceSecret);
  if (refused) return refused;

  const body = await readBoundedBody(request, VOICE_INTERNAL_BODY_BYTES);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== BODY_READ.READ) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  // SAFETY: JSON.parse returns a runtime value; the wire schema validates it.
  const report = voiceUsageRequestSchema.parse(payload as UnparsedWireValue);
  if (!report) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const outcome = await options.record(report);
  if (outcome === VOICE_SECONDS_OUTCOME.UNKNOWN_USER) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const answer: VoiceUsageAnswer = { record: ANSWERED_RECORD[outcome] };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
