import type { HostedUsageAnswer } from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/**
 * Answers today's hosted counters without spending either. The endpoint stays
 * available for wire compatibility with desktop builds that read it.
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
