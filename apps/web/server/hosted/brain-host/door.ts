import { type AuthFn, ForbiddenError, routeAuth } from "eve/channels/auth";
import type { EveMessageContext } from "eve/channels/eve";
import type { SessionAuthContext } from "eve/context";
import { conversationIdOf, sessionAuthFor, turnKindOf } from "./auth.js";
import { BRAIN_HOST_REFUSAL } from "./bounds.js";

/**
 * Ownership enforced at the door, before eve accepts a request. eve's route
 * auth says who is signed in and nothing about whose session a route names:
 * once signed in, any account may follow up on or stream any session id it
 * holds. The host refuses that here. A route naming a session is admitted
 * only when the conversation that recorded the session as its runtime
 * session belongs to the caller; a request naming a conversation only when
 * that conversation is the caller's; and a message names the kind of turn it
 * opens or is refused before it dispatches. A session the store attributes to
 * nobody is refused too, not admitted: that is a session whose first event
 * has not yet recorded it, which a client reaches once the record stands, or
 * one a conversation has since rotated away from, which nobody reaches again.
 * A request to open a session must name a conversation of the caller's at
 * the door as well: eve dispatches a durable run before the host's first
 * resolver could refuse it, and a run no conversation records is one nobody
 * can attach to, meter, or retire.
 */

/** What the store answers about who a session or a conversation belongs to. */
export interface SessionOwnership {
  /** The account whose conversation recorded this runtime session; nothing while none has. */
  sessionOwner(sessionId: string): Promise<string | undefined>;
  /** Whether the conversation stands and belongs to the account. */
  ownsConversation(userId: string, conversationId: string): Promise<boolean>;
}

const SESSION_ROUTE = /^\/eve\/v1\/session\/([^/]+)(?:\/|$)/;
const OPEN_ROUTE = /^\/eve\/v1\/session\/?$/;

/** The session id a route names, or nothing for the routes that name none. */
export function sessionIdOf(request: Request): string | undefined {
  const match = SESSION_ROUTE.exec(new URL(request.url).pathname);
  const id = match?.[1];
  return id ? decodeURIComponent(id) : undefined;
}

/** Whether the route opens a session, the one route that dispatches a run before any record names it. */
export function opensSession(request: Request): boolean {
  return request.method === "POST" && OPEN_ROUTE.test(new URL(request.url).pathname);
}

/**
 * The route authenticator with ownership behind it: the inner walk decides
 * who is asking, and the caller is admitted only for what is theirs. A
 * refusal here is eve's own 403, before any route runs.
 */
export function ownedAuth(
  inner: readonly AuthFn<Request>[],
  ownership: SessionOwnership,
): AuthFn<Request> {
  return async (request) => {
    const caller = await routeAuth(request, inner);
    if (caller instanceof Response) return null;
    const sessionId = sessionIdOf(request);
    if (
      sessionId !== undefined &&
      (await ownership.sessionOwner(sessionId)) !== caller.principalId
    ) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NOT_OWNER });
    }
    const conversationId = conversationIdOf(sessionAuthFor(caller, request));
    if (conversationId === undefined) {
      if (opensSession(request)) {
        throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NO_CONVERSATION });
      }
      return caller;
    }
    if (!(await ownership.ownsConversation(caller.principalId, conversationId))) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NOT_OWNER });
    }
    return caller;
  };
}

/**
 * The session auth a message runs under, once the door admitted the caller:
 * the caller with the request's attributes, refused where the message names
 * no kind of turn, so no inference runs for a turn the record cannot name.
 */
export function messageAuth(context: EveMessageContext): SessionAuthContext | null {
  const auth = sessionAuthFor(context.eve.caller, context.eve.request);
  if (auth !== null && turnKindOf(auth) === undefined) {
    throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NO_TURN_KIND });
  }
  return auth;
}
