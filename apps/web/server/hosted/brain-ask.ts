import { Effect, Either } from "effect";
import {
  ASK_BOUNDS,
  ASK_ORIGIN,
  type AskOrigin,
  type HostedBrainAskAnswer,
  type HostedBrainAskRequest,
  type HostedBrainTurnAnswer,
  hostedBrainAskRequestSchema,
  s,
  TURN_STATUS,
  TURN_WAIT_QUERY,
  type TurnStatus,
  unparsedWire,
  wireUuidSchema,
} from "../core.js";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "./brain-host/bounds.js";
import {
  EVE_FIRST_TURN_ID,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "./brain-host/eve-sessions.js";
import { hostTurnId } from "./brain-host/ids.js";
import { standingMain } from "./brain-host/main.js";
import { conversationOwnedBy, recordedRuntimeSession } from "./brain-host/recorded-session.js";
import {
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
  readJsonBody,
} from "./http.js";
import { createRateBrake } from "./rate-brake.js";
import type { AskRecord, AskRow } from "./store/asks.js";
import type { HostedStoreRun } from "./store/database.js";
import type { HostedStore, StoredTurnRecord } from "./store/index.js";

export type { AskRecord, AskRow } from "./store/asks.js";

/**
 * The ask routes: `POST /api/brain/ask`, `GET /api/brain/turns/{id}`, and
 * `POST /api/brain/turns/{id}/cancel`. An ask is admitted before eve is
 * reached — the conversation it names is the caller's and stands, or it is
 * refused as not found, another account's and none at all answering alike —
 * and then handed to the one eve session the conversation runs in, or the
 * session opened for it. eve folds asks that arrive while a turn runs into
 * the next turn and names no turn at accept time, so the ask stands on its
 * own record from the accept, keyed by the client's id, and the turn read
 * answers that record until eve's `turn.started` names the delivery and the
 * record learns its turn. A retry with the same client id finds the record
 * and dispatches again only where the first dispatch never reached eve: one
 * ask, one delivery. A Stop on a turn eve is running is eve's cancel; a Stop
 * on an ask still waiting is a stamp on the record, honoured when its turn
 * starts. Every id the routes mint or read is one `ids.ts` mints.
 *
 * The ask and the standing read take the store's runner, `HostedStoreRun`,
 * and nothing else of the database: every read they make and the first
 * main they open are effects over the one SQL client, and the record they
 * are handed was built over the same runner, so a caller holds one client
 * and one transaction scope over these rows and never two.
 */

/** An ask carries a bounded question, an origin, and two ids; a body past this is not one. */
const MAXIMUM_ASK_BODY_BYTES = 64 * 1024;

const ASK_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 60,
  MAX_TRACKED_USERS: 10_000,
} as const;

const askRateLimited = createRateBrake({
  windowMs: ASK_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: ASK_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: ASK_RATE_LIMIT.MAX_TRACKED_USERS,
});

const TURN_ID_QUERY = "id";

/** How often a held turn read looks again; eve's step boundaries land at a few hundred milliseconds apart. */
const TURN_WAIT_POLL_MS = 500;

const waitSchema = s.wholeNumber({ minimum: 0, maximum: ASK_BOUNDS.MAX_WAIT_MS });

const TERMINAL_TURN_STATUSES: ReadonlySet<TurnStatus> = new Set([
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELLED,
  TURN_STATUS.FAILED,
]);

/** The kind of turn each ask origin opens, as the header eve's door reads names it. */
const HOST_TURN_OF_ASK_ORIGIN = {
  [ASK_ORIGIN.TYPED]: BRAIN_HOST_TURN.TYPED,
  [ASK_ORIGIN.SPOKEN]: BRAIN_HOST_TURN.SPOKEN,
} as const satisfies Record<AskOrigin, BrainHostTurn>;

export interface BrainAskOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The store's runner the route composed, which the store and the ask record were built over too. */
  run: HostedStoreRun;
  store: Pick<HostedStore, "turns">;
  asks: AskRecord;
  /** eve as the caller reaches it, under the caller's own bearer. */
  eve: (authorization: string) => EveSessions;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type Gate = { readonly userId: string; readonly authorization: string } | Response;

/** The gate the three routes share: method, bearer, brake. */
async function gate(options: BrainAskOptions, method: string): Promise<Gate> {
  const { request, resolveUserId } = options;
  if (request.method !== method) {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const userId = await resolveUserId(request);
  const authorization = request.headers.get("authorization")?.trim();
  if (!userId || !authorization) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }
  if (await askRateLimited(userId)) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }
  return { userId, authorization };
}

/** The path's id as the route rewrite hands it over: the one `id` query parameter, held to the uuid shape. */
function pathId(request: Request): string | Response {
  const ids = new URL(request.url).searchParams.getAll(TURN_ID_QUERY);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const read = wireUuidSchema.read(unparsedWire(id));
  return read.ok
    ? read.value
    : errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
}

function notFound(): Response {
  return errorResponse(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
}

function upstream(status: number): Response {
  return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, {
    upstreamStatus: status,
  });
}

/** The turn answer over a turn row, under the id the caller asked by. */
function turnAnswer(id: string, turn: StoredTurnRecord): HostedBrainTurnAnswer {
  return {
    id,
    turnId: turn.id,
    conversationId: turn.conversationId,
    origin: turn.origin,
    status: turn.status,
    queuedAt: turn.queuedAt.getTime(),
    ...(turn.startedAt ? { startedAt: turn.startedAt.getTime() } : undefined),
    ...(turn.settledAt ? { settledAt: turn.settledAt.getTime() } : undefined),
    ...(turn.failure !== null ? { failure: turn.failure } : undefined),
    ...(turn.cancelRequestedAt
      ? { cancelRequestedAt: turn.cancelRequestedAt.getTime() }
      : undefined),
  };
}

/** The turn answer over an ask eve has not yet started a turn for: queued, from the ask's own record. */
function queuedAnswer(ask: AskRow): HostedBrainTurnAnswer {
  return {
    id: ask.id,
    conversationId: ask.conversationId,
    origin: ask.origin,
    status: TURN_STATUS.QUEUED,
    queuedAt: ask.createdAt.getTime(),
    ...(ask.cancelRequestedAt ? { cancelRequestedAt: ask.cancelRequestedAt.getTime() } : undefined),
  };
}

/** Where an id stands, as the turn read answers it, with the record and the row it was read from. */
export interface AskStanding {
  readonly answer: HostedBrainTurnAnswer;
  readonly ask: AskRow | undefined;
  readonly turn: StoredTurnRecord | undefined;
}

/** What the standing read needs: the turn rows, the runner the conversation's standing is read on, and the ask record. */
export interface AskStandingReads {
  readonly store: Pick<HostedStore, "turns">;
  readonly run: HostedStoreRun;
  readonly asks: Pick<AskRecord, "named">;
}

/**
 * Where the id stands: a turn row the account holds over a standing
 * conversation, or an ask the account holds whose conversation stands, read
 * through to its turn where one has started. Anything else is not found,
 * another account's and none at all alike. This is the read the turn route
 * answers with, and it is exported as the same read in process: the voice
 * function keys an exchange by the ask's id and holds no bearer to call the
 * route with, so it reads the standing here until the turn's own id is set
 * and projects the turn's events from there.
 */
export async function askStanding(
  reads: AskStandingReads,
  userId: string,
  id: string,
): Promise<AskStanding | undefined> {
  const [turn] = await reads.store.turns.named(userId, [id]);
  if (turn) return { answer: turnAnswer(id, turn), ask: undefined, turn };
  const ask = await reads.asks.named(userId, id);
  if (!ask || !(await reads.run(conversationOwnedBy(userId, ask.conversationId)))) {
    return undefined;
  }
  if (ask.turnId !== undefined) {
    const [started] = await reads.store.turns.named(userId, [ask.turnId]);
    if (started) return { answer: turnAnswer(id, started), ask, turn: started };
  }
  return { answer: queuedAnswer(ask), ask, turn: undefined };
}

/**
 * Why an ask was not accepted: the conversation is not the caller's or does
 * not stand; eve did not take the dispatch; or the store could not open the
 * account's first main, which is the store's own failure and not the
 * caller's, answered as the service being unavailable rather than as a
 * refusal of the ask.
 */
export const ASK_REFUSAL = {
  NOT_FOUND: "not_found",
  UPSTREAM: "upstream",
  STORE: "store",
} as const;

export type AskOutcome =
  | { readonly ok: true; readonly answer: HostedBrainAskAnswer }
  | { readonly ok: false; readonly refusal: typeof ASK_REFUSAL.NOT_FOUND }
  | { readonly ok: false; readonly refusal: typeof ASK_REFUSAL.UPSTREAM; readonly status: number }
  | { readonly ok: false; readonly refusal: typeof ASK_REFUSAL.STORE; readonly cause: unknown };

/** An ask as a caller that has already resolved the account hands it over. */
export interface AskInput extends HostedBrainAskRequest {
  readonly userId: string;
}

/** What accepting an ask needs: the store's runner, the ask record built over it, eve as the caller reaches it, and the clock. */
export interface AskSeams {
  readonly run: HostedStoreRun;
  readonly asks: AskRecord;
  /** eve under whatever credential the caller holds: the route forwards the account's bearer, the voice function reaches eve as the deployment. */
  readonly eve: EveSessions;
  readonly now: () => number;
}

/**
 * Accepts one ask over plain arguments, so the route and the voice function
 * run the same admission and dispatch: the conversation is the caller's and
 * stands, or the account's main is opened for it; the ask is recorded once
 * per client id; and where eve has not yet taken it, it is handed to the
 * session the conversation runs in, or the session opened for it. A retry
 * with the same client id finds the record and dispatches again only where
 * the first dispatch never reached eve.
 */
export async function acceptAsk(seams: AskSeams, input: AskInput): Promise<AskOutcome> {
  const { userId, question, origin, clientId } = input;
  const { run } = seams;
  const now = new Date(seams.now());
  let conversationId: string;
  if (input.conversationId !== undefined) {
    if (!(await run(conversationOwnedBy(userId, input.conversationId)))) {
      return { ok: false, refusal: ASK_REFUSAL.NOT_FOUND };
    }
    conversationId = input.conversationId;
  } else {
    const opened = await run(Effect.either(standingMain(userId, now)));
    if (Either.isLeft(opened)) return { ok: false, refusal: ASK_REFUSAL.STORE, cause: opened.left };
    conversationId = opened.right;
  }

  const ask = await seams.asks.record({
    userId,
    conversationId,
    clientId,
    origin,
    question,
    createdAt: now,
  });
  const accepted: AskOutcome = {
    ok: true,
    answer: { id: ask.id, conversationId, queuedAt: ask.createdAt.getTime() },
  };
  if (ask.sessionId !== undefined) return accepted;

  const message = { conversationId, turn: HOST_TURN_OF_ASK_ORIGIN[origin], message: question };
  const sessionId = newestSession(
    await run(recordedRuntimeSession({ userId, conversationId })),
    await seams.asks.latestSession(userId, conversationId),
  );
  // The dispatch runs under the ask row's own lock: of two retries in flight for one client
  // id, the first hands the ask to eve and the second finds the session already written and
  // hands it nothing, so one ask is one delivery however many times it is asked.
  let failed: AskOutcome | undefined;
  await seams.asks.dispatchOnce(ask.id, async () => {
    if (sessionId !== undefined) {
      const sent = await seams.eve.send(sessionId, message);
      if (sent.outcome === EVE_SEND_OUTCOME.ACCEPTED) {
        return { sessionId: sent.sessionId, deliveryId: sent.deliveryId };
      }
      if (sent.outcome === EVE_SEND_OUTCOME.FAILED) {
        failed = { ok: false, refusal: ASK_REFUSAL.UPSTREAM, status: sent.status };
        return undefined;
      }
    }
    const opened = await seams.eve.open(message);
    if (opened.outcome === EVE_SEND_OUTCOME.FAILED) {
      failed = { ok: false, refusal: ASK_REFUSAL.UPSTREAM, status: opened.status };
      return undefined;
    }
    return { sessionId: opened.sessionId, turnId: hostTurnId(opened.sessionId, EVE_FIRST_TURN_ID) };
  });
  return failed ?? accepted;
}

/** `POST /api/brain/ask`: the gate and the body, then `acceptAsk` under the caller's own bearer. */
export async function handleBrainAsk(options: BrainAskOptions): Promise<Response> {
  const admitted = await gate(options, "POST");
  if (admitted instanceof Response) return admitted;
  const parsed = await readJsonBody(options.request, MAXIMUM_ASK_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const request = hostedBrainAskRequestSchema.read(parsed);
  if (!request.ok) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const outcome = await acceptAsk(
    {
      run: options.run,
      asks: options.asks,
      eve: options.eve(admitted.authorization),
      now: options.now ?? Date.now,
    },
    { ...request.value, userId: admitted.userId },
  );
  if (outcome.ok) return jsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, outcome.answer);
  switch (outcome.refusal) {
    case ASK_REFUSAL.NOT_FOUND:
      return notFound();
    case ASK_REFUSAL.UPSTREAM:
      return upstream(outcome.status);
    case ASK_REFUSAL.STORE:
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
}

export async function handleBrainTurn(options: BrainAskOptions): Promise<Response> {
  const admitted = await gate(options, "GET");
  if (admitted instanceof Response) return admitted;
  const id = pathId(options.request);
  if (id instanceof Response) return id;
  const waitText = new URL(options.request.url).searchParams.get(TURN_WAIT_QUERY);
  const wait =
    waitText === null
      ? { ok: true, value: 0 }
      : waitSchema.read(unparsedWire(waitText === "" ? Number.NaN : Number(waitText)));
  if (!wait.ok) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + wait.value;
  let standing = await askStanding(options, admitted.userId, id);
  while (
    standing !== undefined &&
    !TERMINAL_TURN_STATUSES.has(standing.answer.status) &&
    now() < deadline
  ) {
    await sleep(Math.min(TURN_WAIT_POLL_MS, deadline - now()));
    standing = await askStanding(options, admitted.userId, id);
  }
  if (standing === undefined) return notFound();
  return jsonResponse(HOSTED_HTTP_STATUS.OK, standing.answer);
}

/**
 * The session a follow-up goes to: the newest the account's record knows of,
 * whether the conversation row has recorded it yet or only the ask that
 * opened it has. eve's session ids sort by the instant they were minted,
 * the same ordering the row's forward-only claim relies on, so the greater
 * id is the newer session; a row still recording a session the last ask
 * moved on from would otherwise be sent to, retried against, and reopened
 * beside.
 */
function newestSession(
  recorded: string | undefined,
  latestDispatched: string | undefined,
): string | undefined {
  if (recorded === undefined) return latestDispatched;
  if (latestDispatched === undefined) return recorded;
  return latestDispatched > recorded ? latestDispatched : recorded;
}
