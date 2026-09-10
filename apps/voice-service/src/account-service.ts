import {
  callAnswered,
  createAccountCall,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  type HostedApiError,
  type HostedQuota,
  hostedErrorSchema,
  NO_CREDENTIAL,
  VOICE_SERVICE_SECRET_HEADER,
  VOICE_USAGE_RECORD,
  type VoiceAuthorizeRequest,
  type VoiceUsageRequest,
  voiceAuthorizeAnswerSchema,
  voiceUsageAnswerSchema,
} from "@sidecar/hosted";
import { type CloudFetch, HTTP_METHOD, HTTP_STATUS } from "@sidecar/wire";

/**
 * The two calls this service makes to the account service, under the shared
 * secret and never under an account of its own. Before a session is spent,
 * authorize says whose socket this is and whether their allowance covers one
 * more; after `session.closed`, usage records the seconds OpenAI billed. The
 * desktop's bearer travels in the authorize body as the thing being asked
 * about, exactly as the route reads it, and is held here no longer than the
 * call.
 */

export const AUTHORIZE_OUTCOME = {
  AUTHORIZED: "authorized",
  /** The account service answered a refusal: no account behind the bearer, or a spent allowance. */
  REFUSED: "refused",
  /** No usable answer: a network fault, a 5xx, or a body the wire schema could not read. */
  UNAVAILABLE: "unavailable",
} as const;

type AuthorizeResult =
  | { outcome: typeof AUTHORIZE_OUTCOME.AUTHORIZED; userId: string; quota: HostedQuota }
  | { outcome: typeof AUTHORIZE_OUTCOME.REFUSED; reason: HostedApiError; status: number }
  | { outcome: typeof AUTHORIZE_OUTCOME.UNAVAILABLE; status: number | undefined };

/** The wire's two records, and the one more this side adds: a report the account service did not take. */
export const USAGE_REPORT_OUTCOME = {
  ...VOICE_USAGE_RECORD,
  /** The seconds stand only in this service's log. */
  FAILED: "failed",
} as const;

type UsageReportOutcome = (typeof USAGE_REPORT_OUTCOME)[keyof typeof USAGE_REPORT_OUTCOME];

interface UsageReportResult {
  outcome: UsageReportOutcome;
  /** The account service's status, or nothing when the call never reached it. */
  status: number | undefined;
}

export interface AccountServiceOptions {
  webOrigin: string;
  serviceSecret: string;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

export interface AccountService {
  authorize(bearer: string): Promise<AuthorizeResult>;
  recordUsage(report: VoiceUsageRequest): Promise<UsageReportResult>;
}

const REFUSAL_BY_STATUS = {
  [HTTP_STATUS.UNAUTHORIZED]: HOSTED_API_ERROR.INVALID_TOKEN,
  [HTTP_STATUS.TOO_MANY_REQUESTS]: HOSTED_API_ERROR.QUOTA_EXHAUSTED,
} as const;

function isRefusalStatus(status: number): status is keyof typeof REFUSAL_BY_STATUS {
  return status === HTTP_STATUS.UNAUTHORIZED || status === HTTP_STATUS.TOO_MANY_REQUESTS;
}

export function createAccountService(options: AccountServiceOptions): AccountService {
  const call = createAccountCall({
    baseUrl: options.webOrigin,
    credential: NO_CREDENTIAL,
    fetch: options.fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  const headers = { [VOICE_SERVICE_SECRET_HEADER]: options.serviceSecret };

  return {
    async authorize(bearer) {
      const body: VoiceAuthorizeRequest = { bearer };
      const answer = await call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.VOICE_AUTHORIZE,
        body: JSON.stringify(body),
        headers,
      });
      if (!callAnswered(answer)) {
        return { outcome: AUTHORIZE_OUTCOME.UNAVAILABLE, status: undefined };
      }
      const { status } = answer.response;
      const payload = await answer.response.json().catch(() => undefined);
      if (answer.response.ok) {
        const authorized = voiceAuthorizeAnswerSchema.parse(payload);
        return authorized
          ? { outcome: AUTHORIZE_OUTCOME.AUTHORIZED, ...authorized }
          : { outcome: AUTHORIZE_OUTCOME.UNAVAILABLE, status };
      }
      if (isRefusalStatus(status)) {
        return {
          outcome: AUTHORIZE_OUTCOME.REFUSED,
          reason: hostedErrorSchema.parse(payload) ?? REFUSAL_BY_STATUS[status],
          status,
        };
      }
      return { outcome: AUTHORIZE_OUTCOME.UNAVAILABLE, status };
    },

    async recordUsage(report) {
      const answer = await call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.VOICE_USAGE,
        body: JSON.stringify(report),
        headers,
      });
      if (!callAnswered(answer)) return { outcome: USAGE_REPORT_OUTCOME.FAILED, status: undefined };
      const { status } = answer.response;
      if (!answer.response.ok) return { outcome: USAGE_REPORT_OUTCOME.FAILED, status };
      const recorded = voiceUsageAnswerSchema.parse(
        await answer.response.json().catch(() => undefined),
      );
      return { outcome: recorded?.record ?? USAGE_REPORT_OUTCOME.FAILED, status };
    },
  };
}
