/**
 * eve-sessions.ts -- the host's three calls into eve's session routes, as effects on the edge's HttpClient.
 */

import { delayLadder } from "@sidecar/runtime/effect";
import { readEither } from "@sidecar/wire/effect";
import { Data, Duration, Effect, Schema as EffectSchema, Result } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../../core.js";
import { BRAIN_HOST_HEADER, type BrainHostTurn } from "./bounds.js";

/**
 * The host's own calls into eve's HTTP API, made from a web function on the
 * developer's behalf: open the conversation's session with a first message,
 * follow up on the session it runs in, and cancel one turn by eve's own id
 * for it. eve's
 * `Client` would make the same three requests, but its session handle keeps
 * the delivery id an accepted follow-up answers to itself, and that id is
 * what ties an ask to the turn eve later starts, so the requests are made
 * here as eve's own routes document them. Who is calling is one of two typed
 * callers, never a bare header value: an account's own bearer, which travels
 * unchanged so eve's door admits the same account against the same
 * conversation this route already admitted, or the deployment acting for an
 * account it names — the scheduled observation, which holds no bearer — under
 * the deployment's own secret, with the account beside it in the header the
 * door reads it from. Either way nothing dispatches that the door refuses.
 * The conversation and the kind of turn ride as the headers the door reads
 * them from, and the kinds a client may name are its type parameter, so a
 * client composed for the tick cannot be handed an ask to send. eve answers a follow-up to an unknown, terminal, or
 * not-yet-active session with one 409, so the code alone cannot tell a
 * session whose command inbox is still starting from one eve has retired;
 * the SDK's own client tries three more times, at 250, 500, and 1,000
 * milliseconds, and reads the session as terminal only after the last, and
 * the same schedule stands here. The retry is what makes a wrong "retired"
 * rare; it is not what makes one safe. That is the conversation row's
 * forward-only claim: an inbox slower than the last wait costs a session
 * opened for nothing, which the claim lets the older one lose, and never two
 * sessions writing one conversation. Reopening is never eve's: the host
 * decides it, under that claim.
 *
 * Every call is an effect on the `HttpClient` the web runtime builds once
 * per instance, read here once at composition rather than on each call, so
 * the client a caller holds answers `Effect<Outcome, EveUnreachable>` and
 * requires nothing: the seams that take a constructor (the children, the
 * child opener, the child completion) stay synchronous, and the tests that
 * hand a fake eve stand on no client at all. A call eve answered, whatever
 * the status, is an outcome; a call that never reached eve or was never
 * answered whole — no address, a refused connection, a failed handshake, a
 * redirect, a dropped body — is `EveUnreachable`, typed so each caller
 * decides against its own refusal rather than dying mid-transaction.
 */

/** eve's session routes, as `door.ts` also spells them; a path is composed from these and nothing else. */
const EVE_SESSION_PATH = "/eve/v1/session";

function sessionPath(sessionId: string): string {
  return `${EVE_SESSION_PATH}/${encodeURIComponent(sessionId)}`;
}

/** eve's id for a session's first turn, the one the opening message runs: `turn_<sequence>` from zero. */
export const EVE_FIRST_TURN_ID = "turn_0";

/** The code eve's follow-up route answers for a session it does not run now, beside its 409. */
const EVE_SESSION_NOT_ACTIVE = "session_not_active";

/**
 * The waits before a not-active follow-up is tried again: a copy of the
 * schedule eve 0.53.1's own client keeps, not a number of ours to tune, so a
 * dependency bump is the moment to check the table still matches. A session
 * not active past the last wait is retired.
 */
const SESSION_NOT_ACTIVE_RETRY = delayLadder([
  Duration.millis(250),
  Duration.millis(500),
  Duration.millis(1_000),
]);

const ACCEPTED_STATUS = 202;
const CONFLICT_STATUS = 409;
/** The statuses `Response.ok` names, which is what a cancel's answer was read under. */
const OK_STATUS = { FIRST: 200, LAST: 299 } as const;
const JSON_CONTENT_TYPE = "application/json";

/**
 * What the fetch under the runtime's client is handed for an eve call: a
 * redirect is an error, never followed, because the caller's bearer travels
 * on the request and a followed redirect would carry it to whatever answered.
 * The service is read from the calling fiber at each request, so it is
 * provided around each call rather than to the client the runtime built.
 */
const EVE_REQUEST_INIT: RequestInit = { redirect: "error" };

const trimmedText = EffectSchema.Trim.check(EffectSchema.isNonEmpty());

/**
 * Each answer names what this build reads of it and nothing more; every read
 * below drops the keys eve names beside them, so a newer eve that widens an
 * answer is still read here. The tolerance stands at the read rather than on
 * the declaration, because v4 settles parse options there.
 */
const openedSession = EffectSchema.Struct({ sessionId: trimmedText });
const acceptedDelivery = EffectSchema.Struct({
  sessionId: trimmedText,
  deliveryId: trimmedText,
});
const refusedSend = EffectSchema.Struct({ code: trimmedText });

const EVE_CANCEL_STATUS = { ACCEPTED: "accepted", NO_ACTIVE_TURN: "no_active_turn" } as const;
const cancelAnswer = EffectSchema.Struct({
  status: EffectSchema.Literals(Object.values(EVE_CANCEL_STATUS)),
});

/** Every answer eve hands back is read with the keys this build does not name dropped. */
const DROPPING_EXCESS = { excess: EXCESS_KEYS.DROP } as const;

/** eve was not reached, or never answered whole; the client's own error says which, for the operator. */
export class EveUnreachable extends Data.TaggedError("EveUnreachable")<{
  readonly cause: HttpClientError.HttpClientError;
}> {}

/**
 * The failure in the words a report carries: the client's own, and beneath a
 * transport failure the platform's, which is where a refused connection or a
 * failed handshake says what it was.
 */
export function describeUnreachable(failure: EveUnreachable): string {
  const reason = failure.cause.reason;
  const beneath =
    reason._tag === "TransportError" && reason.cause !== undefined
      ? `: ${String(reason.cause)}`
      : "";
  return `${failure.cause.message}${beneath}`;
}

/** A follow-up eve answered `session_not_active`; the retry schedule's own input, and never a caller's. */
class EveSessionNotActive extends Data.TaggedError("EveSessionNotActive") {}

/** How eve answered a call: what it accepted, a session it no longer runs, or an answer this build cannot read as either. */
export const EVE_SEND_OUTCOME = {
  ACCEPTED: "accepted",
  /** eve does not run the session, and did not come to after the retry schedule; the conversation needs a new one. */
  RETIRED: "retired",
  /** eve refused or answered outside its documented shape; the status travels for the operator. */
  FAILED: "failed",
} as const;

type EveOpened =
  | { readonly outcome: typeof EVE_SEND_OUTCOME.ACCEPTED; readonly sessionId: string }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.FAILED; readonly status: number };

type EveSent =
  | {
      readonly outcome: typeof EVE_SEND_OUTCOME.ACCEPTED;
      readonly sessionId: string;
      readonly deliveryId: string;
    }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.RETIRED }
  | { readonly outcome: typeof EVE_SEND_OUTCOME.FAILED; readonly status: number };

/** How eve answered a cancel: its own two words, or an answer this build cannot read as either. */
export const EVE_CANCEL_OUTCOME = {
  ACCEPTED: EVE_CANCEL_STATUS.ACCEPTED,
  NO_ACTIVE_TURN: EVE_CANCEL_STATUS.NO_ACTIVE_TURN,
  FAILED: "failed",
} as const;

type EveCancelled =
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.ACCEPTED }
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN }
  | { readonly outcome: typeof EVE_CANCEL_OUTCOME.FAILED; readonly status: number };

export interface EveMessage<Turn extends BrainHostTurn = BrainHostTurn> {
  readonly conversationId: string;
  readonly turn: Turn;
  readonly message: string;
}

export interface EveSessions<Turn extends BrainHostTurn = BrainHostTurn> {
  /** Opens a session over the conversation with its first message; eve's answer names the session, whose first turn is the message's. */
  open(message: EveMessage<Turn>): Effect.Effect<EveOpened, EveUnreachable>;
  /** Hands a message to the session the conversation runs in; eve's answer names the delivery its turn's events will carry. */
  send(sessionId: string, message: EveMessage<Turn>): Effect.Effect<EveSent, EveUnreachable>;
  /**
   * Asks eve to cancel exactly the turn named, by eve's own id for it. A turn
   * no longer under way answers `no_active_turn` and the session's next turn
   * is left running; there is no form of the call that names the session's
   * turn under way, because between a caller's read and eve's answer that
   * turn can be the one queued after the one the caller meant.
   */
  cancel(sessionId: string, eveTurnId: string): Effect.Effect<EveCancelled, EveUnreachable>;
}

/** What the host posts to eve: the message a turn opens with, or the turn a cancel is scoped to. */
interface EvePostBody {
  readonly message?: string;
  readonly turnId?: string;
}

/** Who is calling eve: a person by their own bearer, or the deployment for an account it names. */
export const EVE_CALLER = {
  ACCOUNT: "account",
  DEPLOYMENT: "deployment",
} as const;

export type EveCaller =
  | {
      readonly kind: typeof EVE_CALLER.ACCOUNT;
      /** The caller's own `Authorization` value, forwarded so eve's door admits the same account. */
      readonly authorization: string;
    }
  | {
      readonly kind: typeof EVE_CALLER.DEPLOYMENT;
      /** The deployment's own secret, the one the door's deployment actor was composed with. */
      readonly secret: string;
      /** The account acted for: one the caller already established, never one a request named. */
      readonly account: string;
    };

export interface EveSessionsOptions {
  /** The origin eve answers on; the deployment's own, where its rewrites carry `/eve/v1/*` into the eve service. */
  readonly origin: string;
  readonly caller: EveCaller;
}

/** The constructor over one fiber's client: every seam handed eve's client composes it for a caller through this. */
export type EveSessionsComposer = <Turn extends BrainHostTurn = BrainHostTurn>(
  options: EveSessionsOptions,
) => EveSessions<Turn>;

/** The headers a caller's identity travels as: the bearer, and for the deployment the account beside it. */
function callerHeaders(caller: EveCaller) {
  switch (caller.kind) {
    case EVE_CALLER.ACCOUNT:
      return { authorization: caller.authorization };
    case EVE_CALLER.DEPLOYMENT:
      return {
        authorization: `Bearer ${caller.secret}`,
        [BRAIN_HOST_HEADER.ACCOUNT]: caller.account,
      };
  }
}

/** The whole body as eve wrote it, or nothing for one that is not JSON or was not read whole. */
function bodyOf(response: HttpClientResponse.HttpClientResponse): Effect.Effect<UnparsedWireValue> {
  return response.json.pipe(
    Effect.map((body) => unparsedWire(body)),
    Effect.orElseSucceed(() => unparsedWire(undefined)),
  );
}

/** The status and the body of one call eve answered; a call it did not answer is `EveUnreachable`. */
interface EveAnswer {
  readonly status: number;
  readonly body: UnparsedWireValue;
}

/** One POST to eve as the client answers it; a call it did not answer is `EveUnreachable`. */
function postToEve(
  client: HttpClient.HttpClient,
  url: URL,
  headers: Readonly<Record<string, string>>,
  body: EvePostBody,
): Effect.Effect<EveAnswer, EveUnreachable> {
  return client
    .execute(
      HttpClientRequest.post(url, { headers }).pipe(
        HttpClientRequest.bodyText(JSON.stringify(body), JSON_CONTENT_TYPE),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.map(bodyOf(response), (read) => ({ status: response.status, body: read })),
      ),
      Effect.scoped,
      Effect.provideService(FetchHttpClient.RequestInit, EVE_REQUEST_INIT),
      Effect.mapError((cause) => new EveUnreachable({ cause })),
    );
}

function readOpened({ status, body }: EveAnswer): EveOpened {
  const opened = readEither(openedSession, DROPPING_EXCESS)(body);
  if (status !== ACCEPTED_STATUS || Result.isFailure(opened)) {
    return { outcome: EVE_SEND_OUTCOME.FAILED, status };
  }
  return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: opened.success.sessionId };
}

/** A follow-up as eve answered it; a not-active session is the retry's failure rather than an outcome. */
function readSent({ status, body }: EveAnswer): Effect.Effect<EveSent, EveSessionNotActive> {
  if (status === CONFLICT_STATUS) {
    const refused = readEither(refusedSend, DROPPING_EXCESS)(body);
    if (Result.isSuccess(refused) && refused.success.code === EVE_SESSION_NOT_ACTIVE) {
      return Effect.fail(new EveSessionNotActive());
    }
  }
  const accepted = readEither(acceptedDelivery, DROPPING_EXCESS)(body);
  if (status !== ACCEPTED_STATUS || Result.isFailure(accepted)) {
    return Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status });
  }
  return Effect.succeed({
    outcome: EVE_SEND_OUTCOME.ACCEPTED,
    sessionId: accepted.success.sessionId,
    deliveryId: accepted.success.deliveryId,
  });
}

function readCancelled({ status, body }: EveAnswer): EveCancelled {
  const answer = readEither(cancelAnswer, DROPPING_EXCESS)(body);
  if (status < OK_STATUS.FIRST || status > OK_STATUS.LAST || Result.isFailure(answer)) {
    return { outcome: EVE_CANCEL_OUTCOME.FAILED, status };
  }
  return answer.success.status === EVE_CANCEL_STATUS.ACCEPTED
    ? { outcome: EVE_CANCEL_OUTCOME.ACCEPTED }
    : { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN };
}

function sessionsOver<Turn extends BrainHostTurn>(
  client: HttpClient.HttpClient,
  options: EveSessionsOptions,
): EveSessions<Turn> {
  const identity = callerHeaders(options.caller);
  const post = (path: string, headers: Readonly<Record<string, string>>, body: EvePostBody) =>
    postToEve(client, new URL(path, options.origin), { ...identity, ...headers }, body);
  const turnHeaders = (message: EveMessage<Turn>) => ({
    [BRAIN_HOST_HEADER.CONVERSATION]: message.conversationId,
    [BRAIN_HOST_HEADER.TURN]: message.turn,
  });
  return {
    open: (message) =>
      Effect.map(
        post(EVE_SESSION_PATH, turnHeaders(message), { message: message.message }),
        readOpened,
      ),
    // The not-active follow-up is tried again on the ladder above, and one still not active past
    // its last wait is the retirement the caller reads; an unreachable eve is retried nowhere.
    send: (sessionId, message) =>
      post(sessionPath(sessionId), turnHeaders(message), { message: message.message }).pipe(
        Effect.flatMap(readSent),
        Effect.retry({
          schedule: SESSION_NOT_ACTIVE_RETRY,
          while: (failure) => failure._tag === "EveSessionNotActive",
        }),
        Effect.catchTag("EveSessionNotActive", () =>
          Effect.succeed({ outcome: EVE_SEND_OUTCOME.RETIRED }),
        ),
      ),
    cancel: (sessionId, eveTurnId) =>
      Effect.map(
        post(`${sessionPath(sessionId)}/cancel`, {}, { turnId: eveTurnId }),
        readCancelled,
      ),
  };
}

/**
 * The constructor over the calling fiber's `HttpClient`, read once: a
 * composing edge holds the constructor and hands it to the seams that
 * compose eve's client for one caller at a time.
 */
export const eveSessionsComposer: Effect.Effect<EveSessionsComposer, never, HttpClient.HttpClient> =
  Effect.map(
    HttpClient.HttpClient,
    (client): EveSessionsComposer =>
      (options) =>
        sessionsOver(client, options),
  );

/** eve's client for one caller, over the calling fiber's `HttpClient`. */
export function eveSessions<Turn extends BrainHostTurn = BrainHostTurn>(
  options: EveSessionsOptions,
): Effect.Effect<EveSessions<Turn>, never, HttpClient.HttpClient> {
  return Effect.map(eveSessionsComposer, (compose) => compose<Turn>(options));
}
