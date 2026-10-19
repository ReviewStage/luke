import { timeZoneSchema } from "@luke/features/date-mention";
import { type Redacted, Schema } from "effect";
import { type AuthFn, ForbiddenError, withAuthChallenges } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { isWireString } from "../../core.js";
import { bearerMatchesSecret } from "../../http/http.js";
import {
  ACCOUNT_ID_PATTERN,
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_REFUSAL,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
  CONVERSATION_ID_PATTERN,
  isBrainHostTurn,
} from "./bounds.js";

/**
 * Who is asking, decided at the door and pinned to the session. A Luke
 * account's bearer is resolved the way every hosted route resolves it, through
 * the auth service's own userinfo answer, and becomes the eve principal: the
 * account id, and nothing else about the person. The request may name the
 * conversation it is for and the kind of turn it opens; both ride as auth
 * attributes, so the conversation an eve session was opened for is the
 * initiator's attribute for the session's life and the kind of turn is the
 * current request's. Neither is a permission: the host reads them back and
 * checks the conversation's owner against the principal before anything runs.
 *
 * The deployment itself is the other caller. The voice function holds no
 * account's bearer by the time a delegation arrives, so it reaches eve under
 * the deployment's own secret and
 * names the account it acts for in a header; the door mints a principal of
 * another type for it — the deployment's one id, the account as its
 * attribute, the kind of turn as the role it acted in — admitted for exactly
 * the kinds of turn the authenticator's table admits and refused, by that
 * same authenticator, for every other route and kind. There is one such
 * authenticator in the walk, since two under one secret could not coexist:
 * the first would refuse what the second was for. Which account a request acts for is one question with one
 * answer, `actedForAccount`, total over both types: the bearer's account for
 * a person, the attribute for the deployment. Ownership is checked on that
 * answer, so the deployment can open a turn only on a conversation the named
 * account owns, and the deployment's secret can open only the turns the
 * table admits, a row for each of the two things a message does, opening a
 * session or following one up: a spoken ask for the voice function on the
 * brain channel, with the typed ask a comment sent from a browser hands
 * Luke, and on the coder channel (`coder-host/channel.ts`) the typed line
 * the voice brain sends a coding agent and the typed opening that starts
 * one. A typed message presents the account's own principal on either
 * channel (`DEPLOYMENT_PRESENCE`), so it steers, waits, and folds into a
 * turn exactly as the developer's own bearer would: the line steers the
 * agent's running turn, and the ask of Luke never joins a call's spoken one.
 * Ownership is not scope: the kinds of turn the credential may open are the
 * table's, decided before any principal exists. The two other things the
 * secret may do are stop a turn and retire a session. The Stop a spoken ask
 * takes reaches eve as the deployment's cancel, from the voice function or
 * from the hook that carries a waiting ask's Stop at its turn's start, and
 * neither holds a bearer of the account's. A retire is eve's reset of a
 * session for good, which a task's delete and an account's deletion ask of
 * every session of what they delete (`agents/retire-sessions.ts`). Both
 * also come from a hosted route a browser reached on its session cookie,
 * which carries no bearer eve takes, so the route reaches eve as the
 * deployment acting for the account the cookie named (`coder-host/stop.ts`'s
 * `eveFor`), and so does every message such a route sends: a coding agent's
 * start, a message to one, an inbox answer, a manual automation's run, and
 * a comment's ask of Luke. A cancel and a reset open no turn, so the table
 * says nothing about them and they name no kind; what bounds them is the
 * door's ownership check, which admits them only on a session a
 * conversation the named account reaches recorded.
 */

const BEARER_CHALLENGE = [{ scheme: "Bearer" }] as const;

/** Whether a zone is one the service counts days in. */
const isTimeZone = Schema.is(timeZoneSchema);

/** The three request headers as attributes, each only when it is well formed; a malformed one names nothing. */
function requestAttributes(headers: Headers): SessionAuthContext["attributes"] {
  const attributes: Record<string, string> = {};
  const conversation = headers.get(BRAIN_HOST_HEADER.CONVERSATION)?.trim();
  if (conversation && CONVERSATION_ID_PATTERN.test(conversation)) {
    attributes[BRAIN_HOST_ATTRIBUTE.CONVERSATION] = conversation;
  }
  const turn = headers.get(BRAIN_HOST_HEADER.TURN)?.trim();
  if (turn && isBrainHostTurn(turn)) attributes[BRAIN_HOST_ATTRIBUTE.TURN] = turn;
  // Note that a zone the service does not know names none, and the turn reads UTC, rather than refusing the message.
  const timeZone = headers.get(BRAIN_HOST_HEADER.TIME_ZONE)?.trim();
  if (timeZone && isTimeZone(timeZone)) attributes[BRAIN_HOST_ATTRIBUTE.TIME_ZONE] = timeZone;
  return attributes;
}

/**
 * The account behind a request's bearer, as eve's own promise-shaped `AuthFn`
 * takes it. The resolution itself is an effect (`hostedUserId`), so what
 * crosses into eve is one run of it at eve's own edge rather than a
 * promise-shaped door beside the effect in `server/hosted/`.
 */
export type BearerAccount = (request: Request) => Promise<string | undefined>;

/** The route authenticator: a Luke account bearer, or nothing so the walk moves on. */
export function lukeAccount(resolveUserId: BearerAccount): AuthFn<Request> {
  return withAuthChallenges(async (request) => {
    const userId = await resolveUserId(request);
    if (!userId) return null;
    return {
      principalId: userId,
      principalType: BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
      authenticator: BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
      attributes: requestAttributes(request.headers),
    };
  }, BEARER_CHALLENGE);
}

/**
 * Whose identity the deployment's principal presents once admitted. eve
 * steers a running turn only with a message whose principal is the turn's
 * own, read as the tuple of authenticator, issuer, type, and id, and folds
 * messages that waited into one turn only where they share that tuple, so a
 * principal of the deployment's own type never joins a developer's turn,
 * nor a developer's the deployment's. A typed message is a developer's own
 * line, so on every channel it presents the account, whatever the channel
 * presents otherwise: minted as the developer's own tuple, with the
 * deployment named as its carrier in an attribute, which eve's identity
 * does not read and the record keeps, it joins and waits behind a turn
 * exactly as the developer's own bearer would. That is the voice brain's
 * steer of a coding agent's turn, which runs under the developer's bearer,
 * and the ask of Luke a comment sent from a browser hands over, which waits
 * behind a call's spoken turn as the desktop's does. Everything else
 * presents the channel's own: the brain channel's deployment presents
 * itself, so a spoken ask opens or joins a spoken turn alone and nothing of
 * the voice's joins a typed one, and the coder channel's presents the
 * account.
 */
export const DEPLOYMENT_PRESENCE = {
  /** A principal of the deployment's own type, the account as its attribute. */
  DEPLOYMENT: "deployment",
  /** The account's own principal, the deployment as its carrier attribute. */
  ACCOUNT: "account",
} as const;

type DeploymentPresence = (typeof DEPLOYMENT_PRESENCE)[keyof typeof DEPLOYMENT_PRESENCE];

/** The two things a message under the secret does: open a session, whose first turn is the message's, or follow one up. */
export const DEPLOYMENT_ACT = {
  OPEN: "open",
  FOLLOW_UP: "follow-up",
} as const;

type DeploymentAct = (typeof DEPLOYMENT_ACT)[keyof typeof DEPLOYMENT_ACT];

/** A channel's table: for each act, every kind of turn and whether a message under the secret may do it; a cell admitted nowhere is refused outright. */
export type DeploymentTurnTable = Readonly<
  Record<DeploymentAct, Readonly<Record<BrainHostTurn, boolean>>>
>;

/** The deployment acting for an account: which secret admits it, which turns a message under it may open or follow up, and whose identity it presents for all but a typed message, which presents the account's. */
export interface DeploymentActor {
  /** The deployment's own secret, sealed; nothing while the environment names none, which admits no request. */
  readonly secret: Redacted.Redacted | undefined;
  readonly admits: DeploymentTurnTable;
  readonly presents: DeploymentPresence;
}

/**
 * The routes a deployment actor may reach: a message opening a session or
 * following one up, a cancel of a turn in a session, a reset retiring a
 * session for good, and, for an actor that presents itself, a read of a
 * session's event stream; no other.
 */
const OPEN_ROUTE = /^\/eve\/v1\/session\/?$/;
const MESSAGE_ROUTE = /^\/eve\/v1\/session(?:\/[^/]+)?\/?$/;
const CANCEL_ROUTE = /^\/eve\/v1\/session\/[^/]+\/cancel\/?$/;
const RESET_ROUTE = /^\/eve\/v1\/session\/[^/]+\/reset\/?$/;
const STREAM_ROUTE = /^\/eve\/v1\/session\/[^/]+\/stream\/?$/;

/**
 * The route authenticator for the deployment acting for an account, minted
 * as a principal of the deployment's type with the account as its attribute,
 * so the host's ownership check reads the account and the record of who
 * opened the session reads the deployment, in the role the turn kind names.
 * A request with another bearer is not this caller's and the walk moves on;
 * a request with this secret that names no account, reaches any route but a
 * message, a cancel, a reset, or a stream read, or is a message naming a kind
 * of turn the table does not admit for what it does is refused here, before
 * any later authenticator could admit it as something else. A cancel and a
 * reset are posted on a session the door's ownership check holds to one the
 * named account reaches, on every channel alike. The stream read is the
 * voice function hearing a spoken ask's turn as eve writes it rather than
 * reading the record on a timer, so
 * it is admitted to the actor that presents itself (the brain channel's)
 * and no other, and the door's ownership check still holds it to a session
 * the named account reaches. A typed message, and everything an actor that
 * presents the account is admitted for, is minted as the account's own
 * principal instead, the deployment named as its carrier, so the ownership
 * check reads the same account either way.
 */
export function deploymentActor(actor: DeploymentActor): AuthFn<Request> {
  return withAuthChallenges((request) => {
    if (actor.secret === undefined || !bearerMatchesSecret(request, actor.secret)) return null;
    const account = request.headers.get(BRAIN_HOST_HEADER.ACCOUNT)?.trim();
    if (!account || !ACCOUNT_ID_PATTERN.test(account)) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NO_ACCOUNT });
    }
    const attributes = requestAttributes(request.headers);
    const turn = attributes[BRAIN_HOST_ATTRIBUTE.TURN];
    const pathname = new URL(request.url).pathname;
    const posted = request.method === "POST";
    const act = OPEN_ROUTE.test(pathname) ? DEPLOYMENT_ACT.OPEN : DEPLOYMENT_ACT.FOLLOW_UP;
    const message =
      posted &&
      MESSAGE_ROUTE.test(pathname) &&
      isWireString(turn) &&
      isBrainHostTurn(turn) &&
      actor.admits[act][turn];
    const cancel = posted && CANCEL_ROUTE.test(pathname);
    const reset = posted && RESET_ROUTE.test(pathname);
    const stream =
      actor.presents === DEPLOYMENT_PRESENCE.DEPLOYMENT &&
      request.method === "GET" &&
      STREAM_ROUTE.test(pathname);
    if (!message && !cancel && !reset && !stream) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT });
    }
    // Note that a typed message presents the account whatever the channel presents, because it
    // is a developer's own line: eve steers it into, and folds it with, their own turns alone.
    const presents =
      message && turn === BRAIN_HOST_TURN.TYPED ? DEPLOYMENT_PRESENCE.ACCOUNT : actor.presents;
    if (presents === DEPLOYMENT_PRESENCE.ACCOUNT) {
      return {
        principalId: account,
        principalType: BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
        authenticator: BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
        attributes: {
          ...attributes,
          [BRAIN_HOST_ATTRIBUTE.CARRIER]: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
        },
      };
    }
    return {
      principalId: BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
      principalType: BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT,
      authenticator: BRAIN_HOST_AUTHENTICATOR.DEPLOYMENT,
      attributes: { ...attributes, [BRAIN_HOST_ATTRIBUTE.ACCOUNT]: account },
    };
  }, BEARER_CHALLENGE);
}

/**
 * The account a principal acts for: the deployment's named account where the
 * principal is the deployment's, and the principal itself otherwise, since a
 * person's bearer names their own account and the development principal is
 * its own. Nothing for no principal, and nothing for a deployment principal
 * that names no account, which the authenticator never mints.
 */
export function actedForAccount(auth: SessionAuthContext | null): string | undefined {
  if (!auth) return undefined;
  if (auth.principalType !== BRAIN_HOST_PRINCIPAL_TYPE.DEPLOYMENT) return auth.principalId;
  const account = attribute(auth, BRAIN_HOST_ATTRIBUTE.ACCOUNT);
  return account !== undefined && ACCOUNT_ID_PATTERN.test(account) ? account : undefined;
}

/**
 * The session auth a request's message runs under: the route's caller with
 * the request's own conversation and turn attributes laid over whatever the
 * authenticator recorded, so a development principal names a conversation
 * the same way an account's does.
 */
export function sessionAuthFor(
  caller: SessionAuthContext | null,
  request: Request,
): SessionAuthContext | null {
  if (!caller) return null;
  return { ...caller, attributes: { ...caller.attributes, ...requestAttributes(request.headers) } };
}

/** One attribute's single value; a list-valued attribute names nothing here. */
function attribute(auth: SessionAuthContext | null, name: string): string | undefined {
  const value = auth?.attributes[name];
  return isWireString(value) ? value : undefined;
}

/** The conversation a session was opened for: the initiator's attribute, read for the session's life. */
export function conversationIdOf(initiator: SessionAuthContext | null): string | undefined {
  return attribute(initiator, BRAIN_HOST_ATTRIBUTE.CONVERSATION);
}

/** The time zone the current request named, or nothing for one that named none; read again as the turn opens. */
export function timeZoneOf(current: SessionAuthContext | null): string | undefined {
  const timeZone = attribute(current, BRAIN_HOST_ATTRIBUTE.TIME_ZONE);
  return timeZone !== undefined && isTimeZone(timeZone) ? timeZone : undefined;
}

/** The kind of turn the current request opened, or nothing for a request that named none. */
export function turnKindOf(current: SessionAuthContext | null): BrainHostTurn | undefined {
  const turn = attribute(current, BRAIN_HOST_ATTRIBUTE.TURN);
  return turn !== undefined && isBrainHostTurn(turn) ? turn : undefined;
}
