import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/**
 * Deletes the signed-in user's account. The bearer token is the whole
 * authority: the same in-process userinfo resolution the other hosted
 * endpoints trust names the one user this request may erase, so nothing a
 * caller sends can choose a different account. The delete itself is one seam —
 * the user row goes, and every dependent row (sessions, provider accounts,
 * OAuth grants, usage counters) cascades with it in the database's own schema.
 */

export interface AccountDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** Deletes the user row; every dependent row cascades with it. */
  deleteUser: (userId: string) => Promise<void>;
}

export async function handleAccountDelete(options: AccountDeleteOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  await options.deleteUser(userId);
  return jsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
}
