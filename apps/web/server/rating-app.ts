import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { HOSTED_REFUSAL, hostedRefusalResponse } from "./hosted/http-effect.js";
import { handleMessageRating } from "./hosted/message-rating.js";
import { rateMessage, storeWriter } from "./hosted/store/index.js";
import { hostedVaultSeams } from "./hosted/vault-route.js";

/**
 * `PUT /api/conversation/messages/{id}/rating` as the one route this
 * function serves: the id the path rewrite moved into the query is still
 * `handleMessageRating`'s own to read, so the router below only decides
 * whether the request is this endpoint at all, the same refusal every other
 * group answers a path it does not own with.
 */

const RATING_PATH = "/api/conversation/messages/rating";

/** What this group answers against: the connection the rating write runs on. */
type RatingServices = SqlClient.SqlClient;

/**
 * Carries the handler's own `Response` back unchanged, on the group's own
 * fiber rather than through a `Route` whose promise a runtime would have to
 * be read to settle. The write it names no tool, so its writer stands over no
 * registry.
 */
function ratingPassthrough(): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  RatingServices | HttpServerRequest.HttpServerRequest
> {
  return Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const answer = yield* Effect.orDie(
      handleMessageRating({
        request,
        resolveUserId: hostedVaultSeams.resolveUserId,
        rate: (userId, messageId, rating) =>
          Effect.gen(function* () {
            const writer = yield* storeWriter({ tools: {} });
            return yield* rateMessage({ writer }, userId, messageId, rating);
          }),
      }),
    );
    return HttpServerResponse.raw(answer);
  });
}

/** The group, over the one path this function's rewrite ever sends here. */
export function ratingApp(): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  RatingServices | HttpServerRequest.HttpServerRequest
> {
  return HttpRouter.empty.pipe(
    HttpRouter.all(RATING_PATH, ratingPassthrough()),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(hostedRefusalResponse(HOSTED_REFUSAL.NOT_FOUND)),
    ),
  );
}
