import { type AuthFn, ForbiddenError, withAuthChallenges } from "eve/channels/auth";
import type { SessionAuthContext } from "eve/context";
import { isWireString } from "../../core.js";
import type { UserInfoEndpoint } from "../bearer.js";
import { hostedUserId } from "../bearer.js";
import { bearerMatchesSecret } from "../http.js";
import {
  ACCOUNT_ID_PATTERN,
  BRAIN_HOST_ATTRIBUTE,
  BRAIN_HOST_AUTHENTICATOR,
  BRAIN_HOST_DEPLOYMENT_PRINCIPAL,
  BRAIN_HOST_HEADER,
  BRAIN_HOST_PRINCIPAL_TYPE,
  BRAIN_HOST_REFUSAL,
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
 * The deployment itself is the other caller. The scheduled observation holds
 * no account's bearer, so it reaches eve under the deployment's own secret and
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
 * table admits: an observation for the tick, never a cancel or a stream.
 * Ownership is not scope: the kinds of turn the credential may open are the
 * table's, decided before any principal exists.
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
      principalType: BRAIN_HOST_PRINCIPAL_TYPE.ACCOUNT,
      authenticator: BRAIN_HOST_AUTHENTICATOR.ACCOUNT,
      attributes: requestAttributes(request.headers),
    };
  }, BEARER_CHALLENGE);
}

/** The deployment acting for an account: which secret admits it, and which kinds of turn a message under it may open. */
export interface DeploymentActor {
  /** The deployment's own secret; nothing while the environment names none, which admits no request. */
  readonly secret: string | undefined;
  /** Every kind of turn, and whether a message under the secret may open it; a kind admitted nowhere is refused outright. */
  readonly admits: Readonly<Record<BrainHostTurn, boolean>>;
}

/** The routes a deployment actor may reach: a message opening a session or following one up, and no other. */
const MESSAGE_ROUTE = /^\/eve\/v1\/session(?:\/[^/]+)?\/?$/;

/**
 * The route authenticator for the deployment acting for an account, minted
 * as a principal of the deployment's type with the account as its attribute,
 * so the host's ownership check reads the account and the record of who
 * opened the session reads the deployment, in the role the turn kind names.
 * A request with another bearer is not this caller's and the walk moves on;
 * a request with this secret that names no account, reaches any route but a
 * message, or names a kind of turn the table does not admit is refused here,
 * before any later authenticator could admit it as something else.
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
    if (
      request.method !== "POST" ||
      !MESSAGE_ROUTE.test(new URL(request.url).pathname) ||
      !isWireString(turn) ||
      !isBrainHostTurn(turn) ||
      !actor.admits[turn]
    ) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NOT_DEPLOYMENT_ACT });
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

/** The kind of turn the current request opened, or nothing for a request that named none. */
export function turnKindOf(current: SessionAuthContext | null): BrainHostTurn | undefined {
  const turn = attribute(current, BRAIN_HOST_ATTRIBUTE.TURN);
  return turn !== undefined && isBrainHostTurn(turn) ? turn : undefined;
}
