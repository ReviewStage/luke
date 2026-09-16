import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result, type Schema, Stream } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  BRAIN_TURN_TRIGGER,
  type BrainTurnTrigger,
  encodeTurnEventFrame,
  isStoredToolPart,
  READ_QUERY,
  replySentences,
  type SlowStepKind,
  type StoredUIMessage,
  slowStepOf,
  storedToolName,
  TURN_END,
  TURN_EVENT_KIND,
  TURN_EVENT_STREAM,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnEnd,
  type TurnEvent,
  type TurnEventBody,
  type TurnOrigin,
  type TurnStatus,
  turnEventCursorSchema,
  UI_PART_TYPE,
  unparsedWire,
  wireUuidSchema,
} from "../core.js";
import { hostedTurnPolicy } from "./brain-host/tools.js";
import { CATALOG_TOOL_SET } from "./brain-tool-set.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "./http.js";
import { makeRateBrake } from "./rate-brake.js";
import type { HostedStore, StoredTurnRecord } from "./store/index.js";

/**
 * `GET /api/brain/turns/{id}/events`: one turn's run seams as Server-Sent
 * Events, for the voice session that just asked the turn and wants to speak
 * commentary while it runs. The four events the stream carries — a slow step
 * began, every action settled, one sentence of the reply, the turn ended —
 * are not rows of their own: the store keeps the turn row and the turn's
 * journal, the assistant message the writer opens under the turn's id and
 * amends as each call is written ahead of its run, and the stream is a
 * projection over those two, read again on every poll. The projection only
 * grows while the turn runs, because the journal only gains parts and the
 * turn row only moves forward, and the turn's completed answer carries the
 * same calls the journal held, so the events a client heard stay where they
 * were numbered and the ones it has not heard come after: a client that
 * attaches again with the number of the last event it took hears the rest
 * exactly once. The end is the last event of every turn, and the stream
 * closes after it; a client attached after the end hears the terminal events
 * and the stream closes at once, and one that already took the end hears
 * nothing and closes.
 *
 * The turn has to be the caller's, refused before anything streams: another
 * account's turn and no turn at all read alike as not found. One attachment
 * lives inside the function's own duration and closes without an end when it
 * lapses, for the client to attach again from its cursor; a heartbeat frame
 * says the connection stands while nothing has happened.
 */

/** The function's own path, as the bundle names it; the client's path carries the turn id inside it and is rewritten here. */
export const TURN_EVENT_STREAM_PATH = "/api/brain/turns/events";

export const TURN_EVENT_STREAM_BOUNDS = {
  /** The function's duration: past eve's own turn deadline, so a stream that lives for one turn fits. */
  MAX_DURATION_SECONDS: 300,
  /** How long one attachment stands before the stream closes without the end, inside the function's duration. */
  ATTACHMENT_MS: 270_000,
  /** How often the record is read again: the measured step boundary hosted is about 300 ms. */
  POLL_MS: 250,
  /** How long the stream stays silent before a heartbeat frame says it stands. */
  HEARTBEAT_MS: 15_000,
} as const;

type TurnEventStreamBounds = Readonly<Record<keyof typeof TURN_EVENT_STREAM_BOUNDS, number>>;

/** The query parameter the route rewrite hands the path's turn id over as. */
const TURN_ID_QUERY = "id";

/** The cursor as the query spells it: decimal digits and nothing else, so a form `Number` would read another way is refused. */
const CURSOR_DIGITS = /^\d+$/;

/**
 * Generous enough for every voice session an account holds to attach to each
 * turn it asks and to attach again when an attachment lapses, tight enough
 * that a client reconnecting in a loop is a trickle.
 */
const STREAM_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 60,
  MAX_TRACKED_USERS: 10_000,
} as const;

const streamBrake = makeRateBrake({
  windowMs: STREAM_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: STREAM_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: STREAM_RATE_LIMIT.MAX_TRACKED_USERS,
});

/** The trigger a turn ran under, read back from the origin its row records, for the tool policy that classifies its slow steps. */
const TRIGGER_OF_TURN_ORIGIN = {
  [TURN_ORIGIN.TYPED]: BRAIN_TURN_TRIGGER.ASK,
  [TURN_ORIGIN.SPOKEN]: BRAIN_TURN_TRIGGER.ASK,
  [TURN_ORIGIN.TRANSCRIPT_CHANGE]: BRAIN_TURN_TRIGGER.ROSTER,
  [TURN_ORIGIN.CHILD]: BRAIN_TURN_TRIGGER.CHILD_TASK,
  [TURN_ORIGIN.CHILD_COMPLETION]: BRAIN_TURN_TRIGGER.CHILD_COMPLETION,
} as const satisfies Record<TurnOrigin, BrainTurnTrigger>;

/** How a terminal turn status reads to a client telling a reply from a refusal; nothing for a turn still under way. */
const TURN_END_OF_STATUS = {
  [TURN_STATUS.SETTLED]: TURN_END.COMPLETED,
  [TURN_STATUS.CANCELLED]: TURN_END.CANCELLED,
  [TURN_STATUS.FAILED]: TURN_END.FAILED,
  [TURN_STATUS.QUEUED]: undefined,
  [TURN_STATUS.RUNNING]: undefined,
} as const satisfies Record<TurnStatus, TurnEnd | undefined>;

/** The turn as the projection reads it: what opened it and where it stands. */
export type ProjectedTurn = Pick<StoredTurnRecord, "id" | "origin" | "status">;

type JournalParts = StoredUIMessage["parts"];

/** The first slow step the journal's calls began, in the order the calls were written; the desktop tells one per run and so does this. */
function slowStepOfJournal(
  parts: JournalParts,
  trigger: BrainTurnTrigger,
): SlowStepKind | undefined {
  const policy = hostedTurnPolicy(trigger);
  for (const part of parts) {
    if (!isStoredToolPart(part)) continue;
    const step = slowStepOf(policy, storedToolName(part));
    if (step !== undefined) return step;
  }
  return undefined;
}

/** The reply's text: every text part of the answer, in order; the words the voice speaks. */
function replyTextOf(parts: JournalParts): string {
  return parts.flatMap((part) => (part.type === UI_PART_TYPE.TEXT ? [part.text] : [])).join("\n");
}

/**
 * The turn's events as the record now stands, numbered from one. A slow step
 * is told the moment a slow call is on the journal; the settled mark, the
 * reply's sentences, and the end follow the turn's own end, since the reply
 * is spoken only once everything the turn did is on record, exactly as the
 * desktop's own run stream orders them. A cancelled or failed turn ends
 * without a settled mark or a sentence, because nothing of it is spoken as a
 * reply.
 */
export function projectTurnEvents(
  turn: ProjectedTurn,
  journal: StoredUIMessage | undefined,
): readonly TurnEvent[] {
  const parts = journal?.parts ?? [];
  const bodies: TurnEventBody[] = [];
  const slowStep = slowStepOfJournal(parts, TRIGGER_OF_TURN_ORIGIN[turn.origin]);
  if (slowStep !== undefined) bodies.push({ kind: TURN_EVENT_KIND.SLOW_STEP, step: slowStep });
  const end = TURN_END_OF_STATUS[turn.status];
  if (end === TURN_END.COMPLETED) {
    bodies.push({ kind: TURN_EVENT_KIND.ACTIONS_SETTLED });
    for (const sentence of replySentences(replyTextOf(parts))) {
      bodies.push({ kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence });
    }
  }
  if (end !== undefined) bodies.push({ kind: TURN_EVENT_KIND.ENDED, end });
  return bodies.map((body, index) => ({ ...body, turnId: turn.id, seq: index + 1 }));
}

export interface TurnEventStreamOptions {
  request: Request;
  resolveUserId: (request: Request) => Effect.Effect<string | undefined>;
  store: Pick<HostedStore, "turns" | "messages">;
  now?: () => number;
  sleep?: (ms: number) => Effect.Effect<void>;
  /** The stream's own bounds, narrowed by a test so an attachment lapses in milliseconds rather than minutes. */
  bounds?: Partial<TurnEventStreamBounds>;
}

function invalidRequest(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
}

function notFound(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
}

/** The turn's record and its journal as they stand now, or nothing where the turn is gone or its journal cannot be read. */
const lookAtTurn = /* @__PURE__ */ Effect.fn("lookAtTurn")(function* (
  store: TurnEventStreamOptions["store"],
  userId: string,
  turnId: string,
): Effect.fn.Return<
  readonly TurnEvent[] | undefined,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
> {
  const [turn] = yield* store.turns.named(userId, [turnId]);
  if (turn === undefined) return undefined;
  const journal = yield* store.messages.byClientId(
    userId,
    turn.conversationId,
    CATALOG_TOOL_SET,
    turn.id,
  );
  if (!journal.ok) return undefined;
  return projectTurnEvents(turn, journal.value[0]?.message);
});

/** Where one attachment's polling stands between reads: what the client has been told, and when it last heard anything. */
interface Attachment {
  /** The number of the last event written, which is where the next read's events are taken from. */
  readonly told: number;
  /** When the last frame was written, which the heartbeat is measured from. */
  readonly quietSince: number;
  /** Whether a read has already run, so the first happens at once and every later one waits out the interval. */
  readonly polled: boolean;
  /** Whether this chunk is the attachment's last: the end was told, or the attachment lapsed. */
  readonly last: boolean;
}

/** The number of the last event the client took: absent for the turn's first; a cursor outside the shape is refused. */
function cursorOf(query: URLSearchParams): number | undefined {
  const text = query.get(READ_QUERY.AFTER);
  if (text === null) return 0;
  if (!CURSOR_DIGITS.test(text)) return undefined;
  return Result.getOrUndefined(readEither(turnEventCursorSchema)(unparsedWire(Number(text))));
}

export const handleTurnEventStream = /* @__PURE__ */ Effect.fn("handleTurnEventStream")(function* (
  options: TurnEventStreamOptions,
): Effect.fn.Return<Response, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const { request, resolveUserId, store } = options;
  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const query = new URL(request.url).searchParams;
  const ids = query.getAll(TURN_ID_QUERY);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) return invalidRequest();
  const after = cursorOf(query);
  if (after === undefined) return invalidRequest();

  const userId = yield* resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  const now = options.now ?? Date.now;
  if (!(yield* streamBrake.check(userId))) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }
  // An id that is not a uuid names no row and answers as none, the same as another account's.
  const turnId = Result.getOrUndefined(readEither(wireUuidSchema)(unparsedWire(id)));
  if (turnId === undefined) return notFound();
  const [turn] = yield* store.turns.named(userId, [turnId]);
  if (turn === undefined) return notFound();
  const bounds = { ...TURN_EVENT_STREAM_BOUNDS, ...options.bounds };
  const sleep = options.sleep ?? ((ms: number) => Effect.sleep(ms));
  const encoder = new TextEncoder();
  const attachedAt = now();
  // The client's side of the connection can end two ways: the stream's own
  // cancel, which interrupts the fiber reading below it, and the request's
  // abort, which the next read of the attachment sees and stops on.
  const gone = () => request.signal.aborted;

  const frames = Stream.paginate(
    { told: after, quietSince: attachedAt, polled: false, last: false } satisfies Attachment,
    (attachment: Attachment) =>
      Effect.gen(function* () {
        // Nothing more to write and nothing more to wait for: an empty
        // batch with no next attachment is how a paginated stream ends.
        const none: readonly [ReadonlyArray<string>, Option.Option<Attachment>] = [
          [],
          Option.none(),
        ];
        if (attachment.last || gone()) return none;
        if (attachment.polled) yield* sleep(bounds.POLL_MS);
        if (gone()) return none;
        const events = yield* lookAtTurn(store, userId, turn.id);
        if (events === undefined || gone()) return none;
        const fresh = events.slice(attachment.told);
        const told = fresh.at(-1)?.seq ?? attachment.told;
        const quietSince = fresh.length > 0 ? now() : attachment.quietSince;
        const written = fresh.map((event) => encodeTurnEventFrame(event));
        const last =
          events.at(-1)?.kind === TURN_EVENT_KIND.ENDED ||
          now() - attachedAt >= bounds.ATTACHMENT_MS;
        const heartbeat = !last && now() - quietSince >= bounds.HEARTBEAT_MS;
        if (heartbeat) written.push(TURN_EVENT_STREAM.HEARTBEAT_FRAME);
        return [
          written,
          Option.some({
            told,
            quietSince: heartbeat ? now() : quietSince,
            polled: true,
            last,
          } satisfies Attachment),
        ] as const;
      }),
  );
  // The polling runs inside the stream this handler answers with, so it
  // outlives the handler's own fiber: the reader forks a fiber of its own on
  // the runtime this request runs on, and the stream's cancel interrupts it.
  const body = yield* Stream.toReadableStreamEffect(
    Stream.map(frames, (frame) => encoder.encode(frame)),
  );

  return new Response(body, {
    status: HOSTED_HTTP_STATUS.OK,
    headers: {
      "content-type": `${TURN_EVENT_STREAM.MEDIA_TYPE}; charset=utf-8`,
      "cache-control": "no-cache, no-transform",
    },
  });
});
