import type { HostedUsageAnswer } from "../core";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http";

/**
 * Answers where today's allowance stands, spending nothing. This is the one
 * hosted endpoint that involves no OpenAI key: it reads Luke's own counters
 * for the signed-in account, so the panel can show what remains before the
 * first call of the day rather than only after one has answered.
 */

export interface UsageOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  readUsage: (userId: string) => Promise<HostedUsageAnswer>;
}

export async function handleUsage(options: UsageOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, await options.readUsage(userId));
}
