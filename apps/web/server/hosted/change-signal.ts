import { readEither } from "@sidecar/wire/effect";
import { Either } from "effect";
import {
  type ChangesAnswer,
  type ChangesRequest,
  changesRequestSchema,
  encodeSequenceReadCursor,
  encodeTurnReadCursor,
} from "../core.js";
import type { DeviceSeams } from "./devices.js";
import {
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readJsonBody,
} from "./http.js";
import { createRateBrake } from "./rate-brake.js";
import type { HostedStore } from "./store/index.js";

/**
 * The change signal a device polls between reads: where each resource's
 * read stands now, as the cursor a device that read it to the end would
 * hold, so a device compares each against its own and reads only what moved.
 * The heads come from the counters on the conversation rows and one ordered
 * look at the turns, never from the rows themselves, so a poll is one small
 * read however long the Conversation has grown.
 *
 * The same call is the device's heartbeat: its row takes the last-seen
 * instant, and the presence and quiet instants it reported, exactly as the
 * devices route's heartbeat moves them. The service records what the device
 * said and decides nothing from it here; a quiet instant holds speech, and
 * holding is the whole of its power. The brake is per account, generous
 * enough for every device a person owns to poll every few seconds.
 */
const CHANGES_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 180,
  MAX_TRACKED_USERS: 10_000,
} as const;

const changesRateLimited = createRateBrake({
  windowMs: CHANGES_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: CHANGES_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: CHANGES_RATE_LIMIT.MAX_TRACKED_USERS,
});

const CHANGES_METHOD = "POST";

/** A poll's body is a device id and two instants; anything heavier is not a poll. */
const MAXIMUM_CHANGES_BODY_BYTES = 4_096;

export interface ChangeSignalOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  store: Pick<HostedStore, "directory" | "turns" | "roster">;
  touchDevice: DeviceSeams["touchDevice"];
  now?: () => number;
}

/** An instant as the request carried it: a date, `null` to clear, absent to leave. */
function reportedInstant(value: number | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return new Date(value);
}

export async function handleChanges(options: ChangeSignalOptions): Promise<Response> {
  const { request, resolveUserId, store } = options;
  const now = options.now ?? Date.now;

  if (request.method !== CHANGES_METHOD) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  if (await changesRateLimited(userId)) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }
  const parsed = await readJsonBody(request, MAXIMUM_CHANGES_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const body: ChangesRequest | undefined = Either.getOrUndefined(
    readEither(changesRequestSchema)(parsed),
  );
  if (!body) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const seen = await options.touchDevice(
    userId,
    {
      deviceId: body.deviceId,
      activeUntil: reportedInstant(body.activeUntil),
      ...(body.quietUntil !== undefined
        ? { quietUntil: reportedInstant(body.quietUntil) }
        : undefined),
      push: undefined,
    },
    new Date(now()),
  );

  const [standing, latestTurn, rosterObservedAt] = await Promise.all([
    store.directory.standing(userId),
    store.turns.latest(userId),
    store.roster.observedAt(userId),
  ]);
  const answer: ChangesAnswer = {
    seen,
    messages: encodeSequenceReadCursor(
      standing.map((conversation) => ({
        conversationId: conversation.id,
        seq: conversation.nextMessageSeq - 1,
      })),
    ),
    events: encodeSequenceReadCursor(
      standing.map((conversation) => ({
        conversationId: conversation.id,
        seq: conversation.nextEventSeq - 1,
      })),
    ),
    ...(latestTurn !== undefined ? { turns: encodeTurnReadCursor(latestTurn) } : undefined),
    ...(rosterObservedAt !== undefined ? { rosterObservedAt } : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
