/**
 * eve-sessions.ts -- the host's three calls into eve's session routes, as effects on the edge's HttpClient.
 */

import { MESSAGE_DELIVERY, type MessageDelivery } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Data, Duration, Effect, Schema as EffectSchema, Redacted, Result, Schedule } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpClient from "effect/unstable/http/HttpClient";
import type * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { TurnPolicy } from "eve/channels";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../../core.js";
import { BRAIN_HOST_HEADER, type BrainHostTurn } from "./bounds.js";

/**
 * The host's own calls into eve's HTTP API, made from a web function on the
 * developer's behalf: open the conversation's session with a first message,
 * follow up on the session it runs in, and cancel one turn by eve's own id
 * for it. eve's `Client` would make the same requests, but its session handle keeps the delivery id an accepted
 * follow-up answers to itself, and that id is what ties an ask to the turn
 * eve later starts, so the requests are made here as eve's own routes
 * document them. The caller is the deployment acting for an account it
 * names — the voice function, which holds no bearer of the account's by the
 * time a delegation arrives — under the deployment's own secret, with the
 * account beside it in the header the door reads it from, so nothing
 * dispatches that the door refuses. The conversation and the kind of turn
 * ride as the headers the door reads them from, and the kinds a client may
 * name are its type parameter. eve answers a follow-up to a session whose
 * command inbox is still starting with a 409 naming `session_not_ready`, and
 * one to a session it no longer runs with a 409 naming `session_not_active`;
 * the SDK's own client tries the first again for up to twenty seconds and
 * reads the second as terminal at once, and the same stands here. A session
 * still not ready past the last wait is answered as such, which the
 * planning ask reads as a retirement and a coding agent's message answers as
 * a conflict the desktop tries again. The retry is what makes a wrong
 * "retired" rare; it is not what makes one safe. That
 * is the conversation row's forward-only claim: an inbox slower than the
 * last wait costs a session opened for nothing, which the claim lets the
 * older one lose, and never two sessions writing one conversation. Reopening
 * is never eve's: the host decides it, under that claim. A follow-up may
 * name how it reaches a turn under way, in eve's own two words for it
 * (`turnPolicy`): a message naming none takes the channel's policy.
 *
 * Every call is an effect on the `HttpClient` the web runtime builds once
 * per instance, read here once at composition rather than on each call, so
 * the client a caller holds answers `Effect<Outcome, EveUnreachable>` and
 * requires nothing, and the tests that hand a fake eve stand on no client
 * at all. A call eve answered, whatever
 * the status, is an outcome; a call that never reached eve or was never
 * answered whole — no address, a refused connection, a failed handshake, a
 * redirect, a dropped body — is `EveUnreachable`, typed so each caller
 * decides against its own refusal rather than dying mid-transaction.
 */

/**
 * Where an eve service's routes stand under its origin: the planning brain's
 * at eve's own `/eve`, and the coding-agent service's at the named mount
 * `/eve/coder`, which the deployment's rewrite carries into that service and
 * whose own route transform turns back into `/eve/v1/*` before the door
 * reads it (`door.ts` spells the paths the door sees).
 */
export const EVE_MOUNT = {
  PLANNING: "/eve",
  CODER: "/eve/coder",
} as const;

export type EveMount = (typeof EVE_MOUNT)[keyof typeof EVE_MOUNT];

/** eve's session routes under a mount; a path is composed from these and nothing else. */
const SESSION_ROUTE = "/v1/session";

function sessionsPath(mount: EveMount): string {
  return `${mount}${SESSION_ROUTE}`;
}

function sessionPath(mount: EveMount, sessionId: string): string {
  return `${sessionsPath(mount)}/${encodeURIComponent(sessionId)}`;
}

/** eve's id for a session's first turn, the one the opening message runs: `turn_<sequence>` from zero. */
export const EVE_FIRST_TURN_ID = "turn_0";

/** The codes eve's follow-up route answers beside a 409: a session whose inbox is still starting, and one eve no longer runs. */
const EVE_SESSION_REFUSAL = {
  NOT_READY: "session_not_ready",
  NOT_ACTIVE: "session_not_active",
} as const;

/**
 * The waits before a not-ready follow-up is tried again: a copy of the loop
 * eve 0.74.0's own client runs, not a number of ours to tune, so a dependency
 * bump is the moment to check it still matches. The first wait is 250
 * milliseconds, each wait after it is double the last up to two seconds, and
 * the tries end twenty seconds after the first. A session still not ready
 * past the last wait is answered `not_ready`.
 */
const NOT_READY_WAIT = { FIRST: Duration.millis(250), LONGEST: Duration.seconds(2) } as const;
const NOT_READY_TRIES = Duration.seconds(20);
const SESSION_NOT_READY_RETRY = Schedule.exponential(NOT_READY_WAIT.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, NOT_READY_WAIT.LONGEST)),
  ),
  Schedule.upTo({ duration: NOT_READY_TRIES }),
);

const ACCEPTED_STATUS = 202;
/** The statuses `Response.ok` names, which is what a cancel's answer was read under. */
const OK_STATUS = { FIRST: 200, LAST: 299 } as const;
const CONFLICT_STATUS = 409;
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

/** A follow-up eve answered `session_not_ready`; the retry schedule's own input, and never a caller's. */
class EveSessionNotReady extends Data.TaggedError("EveSessionNotReady") {}

/** How eve answered a call: what it accepted, a session it no longer runs, one still coming up, or an answer this build cannot read as any. */
export const EVE_SEND_OUTCOME = {
  ACCEPTED: "accepted",
  /** eve does not run the session: unknown to it, or ended; the conversation needs a new one. */
  RETIRED: "retired",
  /** eve runs the session but its inbox was not up within the retry schedule; the same message later may be taken. */
  NOT_READY: "not_ready",
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
  | { readonly outcome: typeof EVE_SEND_OUTCOME.NOT_READY }
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

/** eve's own word for each way a follow-up reaches a turn under way; the two vocabularies are held to one another here. */
const TURN_POLICY_OF_DELIVERY = {
  [MESSAGE_DELIVERY.STEER]: "steer",
  [MESSAGE_DELIVERY.QUEUE]: "queue",
} as const satisfies Record<MessageDelivery, TurnPolicy>;

export interface EveMessage<Turn extends BrainHostTurn = BrainHostTurn> {
  readonly conversationId: string;
  readonly turn: Turn;
  readonly message: string;
  /** How the message reaches a turn under way, where the caller names it; the channel's own policy otherwise. A first message opens a turn and names none. */
  readonly delivery?: MessageDelivery;
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
   * turn can be the one queued after the one the caller meant. eve's cancel
   * takes every task the session has working with it, which is what a Stop
   * means: a subagent the stopped turn handed work to does not go on.
   */
  cancel(sessionId: string, eveTurnId: string): Effect.Effect<EveCancelled, EveUnreachable>;
}

/** What the host posts to eve: the message a turn opens with and how it reaches a turn under way, or the turn a cancel is scoped to. */
interface EvePostBody {
  readonly message?: string;
  readonly turnPolicy?: TurnPolicy;
  readonly turnId?: string;
}

/**
 * Who reaches eve: the deployment acting for an account it names, under its
 * own secret, or the account itself, under the bearer its request carried,
 * which the door resolves the way every hosted route does. The planning
 * brain's asks come from the voice function as the deployment; a coding
 * agent's Start and Stop come from a route still holding the developer's
 * own bearer and reach eve as that developer.
 */
export type EveCaller =
  | {
      /** The deployment's own secret, the one the door's deployment actor was composed with; revealed onto the bearer alone. */
      readonly secret: Redacted.Redacted;
      /** The account acted for: one the caller already established, never one a request named. */
      readonly account: string;
    }
  | {
      /** The account's own `Authorization` value, as its request carried it; revealed onto the bearer alone. */
      readonly authorization: Redacted.Redacted;
    };

export interface EveSessionsOptions {
  /** The origin eve answers on; the deployment's own, where its rewrites carry the mount's `/v1/*` into the eve service. */
  readonly origin: string;
  readonly caller: EveCaller;
  /** Which eve service's routes are reached; the planning brain's when unsaid. */
  readonly mount?: EveMount;
}

/** The constructor over one fiber's client: every seam handed eve's client composes it for a caller through this. */
export type EveSessionsComposer = <Turn extends BrainHostTurn = BrainHostTurn>(
  options: EveSessionsOptions,
) => EveSessions<Turn>;

/** The headers the caller's identity travels as: the deployment's bearer with the account beside it, or the account's own authorization as it came. */
function callerHeaders(caller: EveCaller) {
  if ("authorization" in caller) return { authorization: Redacted.value(caller.authorization) };
  return {
    authorization: `Bearer ${Redacted.value(caller.secret)}`,
    [BRAIN_HOST_HEADER.ACCOUNT]: caller.account,
  };
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

/** A follow-up as eve answered it: a not-ready session is the retry's failure rather than an outcome, and a not-active one is retired. */
function readSent({ status, body }: EveAnswer): Effect.Effect<EveSent, EveSessionNotReady> {
  if (status === CONFLICT_STATUS) {
    const refused = readEither(refusedSend, DROPPING_EXCESS)(body);
    const code = Result.isSuccess(refused) ? refused.success.code : undefined;
    if (code === EVE_SESSION_REFUSAL.NOT_READY) return Effect.fail(new EveSessionNotReady());
    if (code === EVE_SESSION_REFUSAL.NOT_ACTIVE) {
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.RETIRED });
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
  const mount = options.mount ?? EVE_MOUNT.PLANNING;
  const post = (path: string, headers: Readonly<Record<string, string>>, body: EvePostBody) =>
    postToEve(client, new URL(path, options.origin), { ...identity, ...headers }, body);
  const turnHeaders = (message: EveMessage<Turn>) => ({
    [BRAIN_HOST_HEADER.CONVERSATION]: message.conversationId,
    [BRAIN_HOST_HEADER.TURN]: message.turn,
  });
  return {
    open: (message) =>
      Effect.map(
        post(sessionsPath(mount), turnHeaders(message), { message: message.message }),
        readOpened,
      ),
    // The not-ready follow-up is tried again on the schedule above, and one still not ready past
    // its last wait is the not-ready the caller reads; an unreachable eve is retried nowhere.
    send: (sessionId, message) =>
      post(sessionPath(mount, sessionId), turnHeaders(message), {
        message: message.message,
        ...(message.delivery !== undefined
          ? { turnPolicy: TURN_POLICY_OF_DELIVERY[message.delivery] }
          : undefined),
      }).pipe(
        Effect.flatMap(readSent),
        Effect.retry({
          schedule: SESSION_NOT_READY_RETRY,
          while: (failure) => failure._tag === "EveSessionNotReady",
        }),
        Effect.catchTag("EveSessionNotReady", () =>
          Effect.succeed({ outcome: EVE_SEND_OUTCOME.NOT_READY }),
        ),
      ),
    cancel: (sessionId, eveTurnId) =>
      Effect.map(
        post(`${sessionPath(mount, sessionId)}/cancel`, {}, { turnId: eveTurnId }),
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
