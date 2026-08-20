import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http";

/**
 * Deletes the signed-in user's account. The bearer token is the whole
 * authority: the same in-process userinfo resolution the other hosted
 * endpoints trust names the one user this request may erase, so nothing a
 * caller sends can choose a different account. The delete itself is one seam —
 * the user row goes, and every dependent row (sessions, provider accounts,
 * OAuth grants, usage counters) cascades with it in the database's own schema.
 * Where the deployment can, the analytics person is asked to be erased first,
 * because nothing after the delete would still name it.
 */

export interface AccountDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** Deletes the user row; every dependent row cascades with it. */
  deleteUser: (userId: string) => Promise<void>;
  /**
   * Erases the analytics person for this account, where a deployment can.
   * Omitted entirely without the environment for it, the same posture the
   * recording endpoint takes when the deployment holds no key.
   */
  forgetAnalytics?: (userId: string) => Promise<void>;
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

  // Asked before the row goes: once the user is deleted nothing names the
  // person to retry with. A refusal or an outage there must not hold up the
  // delete — the account is the user's to erase, and a third party's
  // availability is not a condition of that — so it is logged as a status and
  // the delete proceeds.
  if (options.forgetAnalytics) {
    try {
      await options.forgetAnalytics(userId);
    } catch (error) {
      process.stderr.write(
        `Analytics erasure did not complete: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
    }
  }

  await options.deleteUser(userId);
  return jsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
}
