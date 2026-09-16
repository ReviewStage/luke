import { readEither } from "@sidecar/wire/effect";
import { Effect, Result, type Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  type ChangesAnswer,
  type ChangesRequest,
  changesRequestSchema,
  encodeAgentsHead,
  encodeChildrenHead,
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
import { makeRateBrake } from "./rate-brake.js";
import type { HostedStore } from "./store/index.js";

/**
 * The change signal a device polls between reads: where each resource's
 * read stands now, as the cursor a device that read it to the end would
 * hold, so a device compares each against its own and reads only what moved.
 * The heads come from the counters on the conversation rows and one ordered
 * look each at the turns, the children, and the agents, never from the rows themselves,
 * so a poll is one small read however long the Conversation has grown. The messages head is two
 * counters: the last sequence handed out and the journal revision, which
 * every write to a numbered row in place moves, so a caught-up device's
 * cursor reads equal to the head while nothing is numbered or written, an
 * open journal standing idle included.
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

const changesBrake = makeRateBrake({
  windowMs: CHANGES_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: CHANGES_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: CHANGES_RATE_LIMIT.MAX_TRACKED_USERS,
});

const CHANGES_METHOD = "POST";

/** A poll's body is a device id and two instants; anything heavier is not a poll. */
const MAXIMUM_CHANGES_BODY_BYTES = 4_096;

interface ChangeSignalOptions {
  request: Request;
  resolveUserId: (request: Request) => Effect.Effect<string | undefined>;
  store: Pick<HostedStore, "directory" | "turns" | "roster">;
  touchDevice: DeviceSeams["touchDevice"];
  now?: () => number;
}

/** An instant as the request carried it: a date, `null` to clear, absent to leave. */
function reportedInstant(value: number | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return new Date(value);
}

export const handleChanges = /* @__PURE__ */ Effect.fn("handleChanges")(function* (
  options: ChangeSignalOptions,
): Effect.fn.Return<Response, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const { request, resolveUserId, store } = options;
  const now = options.now ?? Date.now;

  if (request.method !== CHANGES_METHOD) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const userId = yield* resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  if (!(yield* changesBrake.check(userId))) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }
  const parsed = yield* Effect.promise(() => readJsonBody(request, MAXIMUM_CHANGES_BODY_BYTES));
  if (parsed instanceof Response) return parsed;
  const body: ChangesRequest | undefined = Result.getOrUndefined(
    readEither(changesRequestSchema)(parsed),
  );
  if (!body) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const seen = yield* options.touchDevice(
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

  const [standing, latestTurn, childrenHead, agentsHead, rosterObservedAt] = yield* Effect.all([
    store.directory.standing(userId),
    store.turns.latest(userId),
    store.directory.childrenHead(userId),
    store.directory.agentsHead(userId),
    store.roster.observedAt(userId),
  ]);
  const answer: ChangesAnswer = {
    seen,
    // A messages head carries the conversation's journal revision beside the
    // last sequence handed out, so a journal written in place moves the head
    // and a journal left open, unwritten, leaves it standing.
    messages: encodeSequenceReadCursor(
      standing.map((conversation) => ({
        conversationId: conversation.id,
        seq: conversation.nextMessageSeq - 1,
        revision: conversation.journalRevision,
      })),
    ),
    events: encodeSequenceReadCursor(
      standing.map((conversation) => ({
        conversationId: conversation.id,
        seq: conversation.nextEventSeq - 1,
      })),
    ),
    ...(latestTurn !== undefined ? { turns: encodeTurnReadCursor(latestTurn) } : undefined),
    // The children read takes no cursor, so its head is the instant the
    // children last changed: a device compares it to the one it last saw.
    ...(childrenHead !== undefined ? { children: encodeChildrenHead(childrenHead) } : undefined),
    ...(agentsHead !== undefined ? { agents: encodeAgentsHead(agentsHead) } : undefined),
    ...(rosterObservedAt !== undefined ? { rosterObservedAt } : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});
