import { Clock, Effect, Option, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { ConversationClearAnswer } from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { UserIdResolver } from "./http-effect.js";
import { makeRateBrake } from "./rate-brake.js";
import type { HostedStore } from "./store/index.js";

/**
 * `POST /api/conversation/clear`: the Conversation tab's Clear as the soft
 * delete B6 gave the store. Nothing is erased: the account's standing main
 * and every descendant of it are stamped `deleted_at` and a new main opened
 * in one transaction, the per-resource reads stop listing the stamped rows
 * from the next call, and the purge takes them thirty days on. Every Mac
 * signed in to the account sees the same empty main on its next poll, which
 * is how a Clear made on one reaches the other. The request carries nothing:
 * the bearer names the account, and the account has one standing main. A
 * Clear repeated stamps the main the last one opened and opens another,
 * which is the same empty thread, so a retry needs no key. The brake is per
 * account and tight: a Clear is a press, not a poll.
 */
const CLEAR_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 12,
  MAX_TRACKED_USERS: 10_000,
} as const;

const clearBrake = makeRateBrake({
  windowMs: CLEAR_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: CLEAR_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: CLEAR_RATE_LIMIT.MAX_TRACKED_USERS,
});

const CLEAR_METHOD = "POST";

interface ConversationClearOptions {
  request: Request;
  resolveUserId: UserIdResolver;
  store: Pick<HostedStore, "main">;
}

export const handleConversationClear = /* @__PURE__ */ Effect.fn("handleConversationClear")(
  function* (
    options: ConversationClearOptions,
  ): Effect.fn.Return<Response, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
    const { request, resolveUserId, store } = options;
    if (request.method !== CLEAR_METHOD) {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }
    const account = yield* resolveUserId(request);
    if (Option.isNone(account)) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }
    const userId = account.value;
    if (!(yield* clearBrake.check(userId))) {
      return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
    }
    const openedAt = yield* Clock.currentTimeMillis;
    const outcome = yield* store.main.clear(userId, new Date(openedAt));
    const answer: ConversationClearAnswer = {
      opened: outcome.opened,
      openedAt,
      cleared: outcome.cleared.length,
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  },
);
