import {
  type HostedMessageRatingRequest,
  hostedMessageRatingRequestSchema,
  unparsedWire,
  wireUuidSchema,
} from "../core.js";
import {
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readJsonBody,
} from "./http.js";
import { RATING_REFUSAL, type RatingWriteResult } from "./store/ratings.js";

/**
 * `PUT /api/conversation/messages/{id}/rating`: the developer rates one of
 * Luke's stored messages from a device. The route rewrite hands the path's id
 * over as the one `id` query parameter — two would leave the path and the
 * effect disagreeing, so two is refused — and the handler holds the id to the
 * wire's UUID shape and the body to the hosted wire schema before the store
 * sees either; an id that is not a UUID names no row, and answers as none. The two refusals the store
 * answers are two statuses: a message the account does not hold is not found
 * — another account's row and none at all answer the same, so nothing is
 * learned about rows the caller does not own — and a message the account
 * holds but Luke did not write is forbidden, since only Luke's words take a
 * rating. A rating never changes a message: it is a fact appended beside it.
 */

/** A rating request is a verdict, a bounded note, and a device id, so a body past this is not one. */
const MAXIMUM_RATING_BODY_BYTES = 8_192;

const MESSAGE_ID_QUERY = "id";

export interface MessageRatingOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** Records the rating on the message where the account holds it and Luke wrote it. */
  rate: (
    userId: string,
    messageId: string,
    rating: HostedMessageRatingRequest,
  ) => Promise<RatingWriteResult>;
}

export async function handleMessageRating(options: MessageRatingOptions): Promise<Response> {
  const { request, resolveUserId, rate } = options;
  if (request.method !== "PUT") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const ids = new URL(request.url).searchParams.getAll(MESSAGE_ID_QUERY);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const messageId = wireUuidSchema.read(unparsedWire(id));
  if (!messageId.ok) {
    return errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const parsed = await readJsonBody(request, MAXIMUM_RATING_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const rating = hostedMessageRatingRequestSchema.read(parsed);
  if (!rating.ok) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const written = await rate(userId, messageId.value, rating.value);
  if (written.ok) return jsonResponse(HOSTED_HTTP_STATUS.OK, { id: written.id, seq: written.seq });
  switch (written.refusal) {
    case RATING_REFUSAL.NOT_FOUND:
      return errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
    case RATING_REFUSAL.NOT_LUKES:
      return errorResponse(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_RATEABLE);
  }
}
