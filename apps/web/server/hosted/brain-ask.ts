import { readEither } from "@sidecar/wire/effect";
import { Effect, Schema as EffectSchema, Either } from "effect";
import {
  ASK_BOUNDS,
  ASK_ORIGIN,
  type AskOrigin,
  type HostedBrainAskAnswer,
  type HostedBrainAskRequest,
  type HostedBrainTurnAnswer,
  hostedBrainAskRequestSchema,
  TURN_STATUS,
  TURN_WAIT_QUERY,
  type TurnStatus,
  unparsedWire,
  wireUuidSchema,
} from "../core.js";
import { BRAIN_HOST_TURN, type BrainHostTurn } from "./brain-host/bounds.js";
import {
  EVE_CANCEL_OUTCOME,
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
import { ASK_DISPATCH_REFUSAL, type AskRecord, type AskRow } from "./store/asks.js";
import type { HostedStoreRun } from "./store/database.js";
import type { HostedStore, StoredTurnRecord } from "./store/index.js";
import type { StoreWriter } from "./store/writer.js";

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

const waitSchema = EffectSchema.Int.pipe(
  EffectSchema.greaterThanOrEqualTo(0),
  EffectSchema.lessThanOrEqualTo(ASK_BOUNDS.MAX_WAIT_MS),
);

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
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  return Either.isRight(read)
    ? read.right
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
export type AskStanding =
  | {
      readonly answer: HostedBrainTurnAnswer;
      /** The ask the id named, where it was an ask's id; a turn's own id names no ask. */
      readonly ask: AskRow | undefined;
      readonly turn: StoredTurnRecord;
    }
  | {
      readonly answer: HostedBrainTurnAnswer;
      readonly ask: AskRow;
      /** An ask eve has not started a turn for stands on its own record alone. */
      readonly turn: undefined;
    };

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
  const [turn] = await reads.run(reads.store.turns.named(userId, [id]));
  if (turn) return { answer: turnAnswer(id, turn), ask: undefined, turn };
  const ask = await reads.asks.named(userId, id);
  if (!ask || !(await reads.run(conversationOwnedBy(userId, ask.conversationId)))) {
    return undefined;
  }
  if (ask.turnId !== undefined) {
    const [started] = await reads.run(reads.store.turns.named(userId, [ask.turnId]));
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

  // The dispatch runs under the conversation's lock, so one dispatch at a time runs in a
  // conversation: of two retries for one client id the second finds the session written and
  // hands eve nothing, and of two first asks the second reads the session the first opened and
  // sends into it rather than opening a second the forward-only claim would lose. A Clear that
  // lands between the admission above and this lock finds no conversation to dispatch in, and the
  // ask is refused as not found rather than dispatched into a conversation the account has cleared.
  let failed: AskOutcome | undefined;
  const dispatched = await seams.asks.dispatchOnce(
    { userId, conversationId },
    ask.id,
    async (sessionId) => {
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
      return {
        sessionId: opened.sessionId,
        turnId: hostTurnId(opened.sessionId, EVE_FIRST_TURN_ID),
      };
    },
  );
  if (dispatched === ASK_DISPATCH_REFUSAL.NO_CONVERSATION) {
    return { ok: false, refusal: ASK_REFUSAL.NOT_FOUND };
  }
  return failed ?? accepted;
}

/** `POST /api/brain/ask`: the gate and the body, then `acceptAsk` under the caller's own bearer. */
export async function handleBrainAsk(options: BrainAskOptions): Promise<Response> {
  const admitted = await gate(options, "POST");
  if (admitted instanceof Response) return admitted;
  const parsed = await readJsonBody(options.request, MAXIMUM_ASK_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  const request = readEither(hostedBrainAskRequestSchema)(parsed);
  if (Either.isLeft(request)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const outcome = await acceptAsk(
    {
      run: options.run,
      asks: options.asks,
      eve: options.eve(admitted.authorization),
      now: options.now ?? Date.now,
    },
    { ...request.right, userId: admitted.userId },
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
      ? Either.right(0)
      : readEither(waitSchema)(unparsedWire(waitText === "" ? Number.NaN : Number(waitText)));
  if (Either.isLeft(wait)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + wait.right;
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

/** Why a Stop was not carried: nothing of the caller's stands under the id, no session runs the turn, or eve did not take the cancel. */
export const STOP_REFUSAL = {
  NOT_FOUND: "not_found",
  NOT_RUNNING: "not_running",
  UPSTREAM: "upstream",
} as const;

export type StopOutcome =
  | { readonly ok: true; readonly answer: HostedBrainTurnAnswer }
  | { readonly ok: false; readonly refusal: typeof STOP_REFUSAL.NOT_FOUND }
  | { readonly ok: false; readonly refusal: typeof STOP_REFUSAL.NOT_RUNNING }
  | { readonly ok: false; readonly refusal: typeof STOP_REFUSAL.UPSTREAM; readonly status: number };

/** What a Stop needs: the standing reads, the record's stamp, the writer's stamp, eve as the caller reaches it, and the clock. */
export interface StopSeams extends AskStandingReads {
  readonly asks: Pick<AskRecord, "named" | "cancelRequested">;
  readonly writer: Pick<StoreWriter, "requestTurnCancel">;
  readonly eve: EveSessions;
  readonly now: () => number;
}

/**
 * Stops one ask over plain arguments, so the route and the voice function
 * carry the same Stop. A turn already settled is answered as it stands and
 * nothing is asked of eve. An ask eve has not yet started a turn for takes
 * the stamp on its record, for the start that names its delivery to honour.
 * A turn under way is eve's cancel of the session's turn, which is the one
 * the row says is running since a conversation runs one session and one
 * turn at a time, and then the stamp on the row; a conversation that records
 * no session has nothing running to stop and is refused as such.
 */
export async function stopAsk(seams: StopSeams, userId: string, id: string): Promise<StopOutcome> {
  const standing = await askStanding(seams, userId, id);
  if (standing === undefined) return { ok: false, refusal: STOP_REFUSAL.NOT_FOUND };
  if (TERMINAL_TURN_STATUSES.has(standing.answer.status))
    return { ok: true, answer: standing.answer };
  const at = new Date(seams.now());
  let turn: StoredTurnRecord;
  if (standing.turn === undefined) {
    await seams.asks.cancelRequested(standing.ask.id, at);
    // The stamp and the start's binding are two writes with no lock between them, so the ask is
    // read again once the stamp stands: a start that bound it meanwhile has read the row before
    // the stamp and carries nothing, and the Stop is then eve's cancel of that turn from here. A
    // start that binds it after this read finds the stamp and carries it. Either order stops the
    // turn once; neither leaves a turn running that its client was told is stopped.
    const stampedAt = standing.ask.cancelRequestedAt ?? at;
    const stampedAnswer: StopOutcome = {
      ok: true,
      answer: { ...standing.answer, cancelRequestedAt: stampedAt.getTime() },
    };
    const bound = await seams.asks.named(userId, standing.ask.id);
    if (bound?.turnId === undefined) return stampedAnswer;
    const [started] = await seams.run(seams.store.turns.named(userId, [bound.turnId]));
    if (started === undefined) return stampedAnswer;
    turn = started;
  } else {
    turn = standing.turn;
  }
  // A turn already settled, or already carrying a Stop (the start's honour, or an earlier Stop),
  // is answered as it stands: the route's cancel names eve's session and not its turn, so a
  // second cancel could reach the turn queued after this one. Recording eve's turn id on the row
  // (LUKE-180) is what scopes it; until then a stamp that stands is the one cancel this turn gets.
  const answer = turn === standing.turn ? standing.answer : turnAnswer(id, turn);
  if (TERMINAL_TURN_STATUSES.has(turn.status)) return { ok: true, answer };
  if (turn.cancelRequestedAt) {
    return { ok: true, answer: { ...answer, cancelRequestedAt: turn.cancelRequestedAt.getTime() } };
  }
  const target = { userId, conversationId: turn.conversationId };
  const sessionId = await seams.run(recordedRuntimeSession(target));
  if (sessionId === undefined) return { ok: false, refusal: STOP_REFUSAL.NOT_RUNNING };
  const cancelled = await seams.eve.cancel(sessionId);
  if (cancelled.outcome === EVE_CANCEL_OUTCOME.FAILED) {
    return { ok: false, refusal: STOP_REFUSAL.UPSTREAM, status: cancelled.status };
  }
  const stamped = await seams.writer.requestTurnCancel(target, { turnId: turn.id, at });
  if (!stamped.ok) return { ok: false, refusal: STOP_REFUSAL.NOT_FOUND };
  return { ok: true, answer: { ...answer, cancelRequestedAt: at.getTime() } };
}

/** `POST /api/brain/turns/{id}/cancel`: the gate and the path's id, then `stopAsk` under the caller's own bearer. */
/** What the Stop route holds beyond the ask routes: the writer, for the one write a Stop makes on a turn's row. Only the cancel function composes it, so the read routes' bundles never reach the writer. */
export interface BrainTurnCancelOptions extends BrainAskOptions {
  writer: Pick<StoreWriter, "requestTurnCancel">;
}

export async function handleBrainTurnCancel(options: BrainTurnCancelOptions): Promise<Response> {
  const admitted = await gate(options, "POST");
  if (admitted instanceof Response) return admitted;
  const id = pathId(options.request);
  if (id instanceof Response) return id;
  const outcome = await stopAsk(
    {
      store: options.store,
      run: options.run,
      asks: options.asks,
      writer: options.writer,
      eve: options.eve(admitted.authorization),
      now: options.now ?? Date.now,
    },
    admitted.userId,
    id,
  );
  if (outcome.ok) return jsonResponse(HOSTED_HTTP_STATUS.OK, outcome.answer);
  switch (outcome.refusal) {
    case STOP_REFUSAL.NOT_FOUND:
      return notFound();
    case STOP_REFUSAL.NOT_RUNNING:
      return errorResponse(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.NOT_RUNNING);
    case STOP_REFUSAL.UPSTREAM:
      return upstream(outcome.status);
  }
}
