import { type AuthFn, withAuthChallenges } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { isWireString } from "../../core.js";
import type { UserInfoEndpoint } from "../bearer.js";
import { hostedUserId } from "../bearer.js";
import {
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
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
 */

const BEARER_CHALLENGE = [{ scheme: "Bearer" }] as const;

/** The two request headers as attributes, each only when it is well formed; a malformed one names nothing. */
export function requestAttributes(headers: Headers): SessionAuthContext["attributes"] {
  const attributes: Record<string, string> = {};
  const conversation = headers.get(BRAIN_HOST_HEADER.CONVERSATION)?.trim();
  if (conversation && CONVERSATION_ID_PATTERN.test(conversation)) {
    attributes[BRAIN_HOST_ATTRIBUTE.CONVERSATION] = conversation;
  }
  const turn = headers.get(BRAIN_HOST_HEADER.TURN)?.trim();
  if (turn && isBrainHostTurn(turn)) attributes[BRAIN_HOST_ATTRIBUTE.TURN] = turn;
  return attributes;
}

/** The route authenticator: a Luke account bearer, or nothing so the walk moves on. */
export function lukeAccount(userInfo: UserInfoEndpoint): AuthFn<Request> {
  return withAuthChallenges(async (request) => {
    const userId = await hostedUserId(request, userInfo);
    if (!userId) return null;
    return {
      principalId: userId,
      principalType: BRAIN_HOST_PRINCIPAL_TYPE,
      authenticator: BRAIN_HOST_AUTHENTICATOR,
      attributes: requestAttributes(request.headers),
    };
  }, BEARER_CHALLENGE);
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

/** The kind of turn the current request opened, or nothing for a request that named none. */
export function turnKindOf(current: SessionAuthContext | null): BrainHostTurn | undefined {
  const turn = attribute(current, BRAIN_HOST_ATTRIBUTE.TURN);
  return turn !== undefined && isBrainHostTurn(turn) ? turn : undefined;
}
