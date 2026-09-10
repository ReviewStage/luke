import {
  type ConversationEntry,
  HOSTED_CONVERSATION_QUERY,
  HOSTED_SERVICE_PATH,
  type HostedConversationClearAnswer,
  type HostedConversationLine,
  type HostedConversationLinesAnswer,
  type HostedLineRatingAnswer,
  hostedLineRatingRequestSchema,
  type LineRating,
  type UnparsedWireValue,
} from "../../core.js";
import {
  BODY_READ,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readBoundedBody,
} from "../http.js";
import { ratingOf } from "../store/index.js";
import {
  admitBrainRoute,
  busyResponse,
  clock,
  HOSTED_CONVERSATION_KEY,
  type HostedBrainRoute,
  leaseWithin,
  pathSegmentAfter,
} from "./route.js";

/**
 * The account's one Conversation as the service serves it: the lines the
 * panel draws, the projection the store already keeps — the most recent
 * lines inside their retention — with a cursor for what is newer than the
 * last read and the rating each of Luke's lines carries; its Clear, the
 * hard delete of the conversation and everything under it, taken under the
 * conversation's lease so no turn is cut mid-thought; and the developer's
 * rating of one line Luke wrote.
 */

const HTTP_METHOD = {
  GET: "GET",
  DELETE: "DELETE",
  PUT: "PUT",
} as const;

/** A rating is a word, a short note, and a device id; anything heavier is not one. */
const MAXIMUM_RATING_BODY_BYTES = 16 * 1024;

const CONVERSATION_LINES_PREFIX = `${HOSTED_SERVICE_PATH.CONVERSATION}/lines`;

function invalidRequest(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
}

/** One stored line as the wire carries it; a line without an instant never left the store and is not drawn. */
export function lineToWire(
  entry: ConversationEntry,
  rating: LineRating | undefined,
): HostedConversationLine | undefined {
  if (entry.recordedAt === undefined) return undefined;
  return {
    kind: entry.kind,
    ...(entry.eventId !== undefined ? { eventId: entry.eventId } : undefined),
    words: entry.words,
    ...(entry.identity ? { identity: { ...entry.identity } } : undefined),
    recordedAt: entry.recordedAt,
    ...(entry.requestId !== undefined ? { requestId: entry.requestId } : undefined),
    ...(rating !== undefined ? { rating } : undefined),
  };
}

function afterOf(request: Request): number | undefined {
  const asked = new URL(request.url).searchParams.get(HOSTED_CONVERSATION_QUERY.AFTER);
  if (asked === null) return undefined;
  const parsed = Number(asked);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** GET: the lines the panel draws, newest last, those newer than `after` when the caller names one. */
export async function handleConversationLines(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.GET);
  if (admission instanceof Response) return admission;
  const { store, userId } = admission;
  const after = afterOf(route.request);
  const [entries, ratings] = await Promise.all([
    store.lines.list(userId, HOSTED_CONVERSATION_KEY, clock(route)()),
    store.ratings.list(userId, HOSTED_CONVERSATION_KEY),
  ]);
  const lines: HostedConversationLine[] = [];
  let cursor: number | undefined;
  for (const entry of entries) {
    const line = lineToWire(entry, ratingOf(ratings, entry));
    if (!line) continue;
    cursor = cursor === undefined ? line.recordedAt : Math.max(cursor, line.recordedAt);
    if (after !== undefined && line.recordedAt <= after) continue;
    lines.push(line);
  }
  const answer: HostedConversationLinesAnswer = {
    lines,
    ...(cursor !== undefined ? { cursor } : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

/**
 * DELETE: the Clear. The conversation's lease is taken first, so a turn
 * under way in another function finishes before its conversation goes rather
 * than writing into a deleted one; then the conversation and every row under
 * it are removed with no archive, and the next ask or wake makes a fresh one.
 */
export async function handleConversationClear(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.DELETE);
  if (admission instanceof Response) return admission;
  const { store, userId } = admission;
  const lease = await leaseWithin(route, store, userId);
  if (!lease) return busyResponse();
  try {
    const cleared = await store.conversations.delete(userId, HOSTED_CONVERSATION_KEY);
    const answer: HostedConversationClearAnswer = { cleared };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  } finally {
    await lease.release();
  }
}

/**
 * PUT: the developer's rating of one line Luke wrote, named in the path by
 * the id its writer minted. Only a line the caller's own conversation holds
 * and Luke authored takes one; anything else is not found.
 */
export async function handleLineRating(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.PUT);
  if (admission instanceof Response) return admission;
  const lineId = pathSegmentAfter(route.request, CONVERSATION_LINES_PREFIX);
  if (!lineId) return invalidRequest();
  const body = await readBoundedBody(route.request, MAXIMUM_RATING_BODY_BYTES);
  if (body.outcome === BODY_READ.TOO_LARGE) {
    return errorResponse(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE);
  }
  if (body.outcome !== BODY_READ.READ) return invalidRequest();
  let payload: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns unknown; the schema below is the validation.
    payload = JSON.parse(body.text) as UnparsedWireValue;
  } catch {
    return invalidRequest();
  }
  const rating = hostedLineRatingRequestSchema.parse(payload);
  if (!rating) return invalidRequest();
  const rated = await admission.store.ratings.rate(admission.userId, HOSTED_CONVERSATION_KEY, {
    eventId: lineId,
    rating: rating.rating,
    ...(rating.note ? { note: rating.note } : undefined),
    deviceId: rating.deviceId,
    ratedAt: clock(route)(),
  });
  if (!rated) return errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
  const answer: HostedLineRatingAnswer = { rated: true };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
