import { readEither } from "@sidecar/wire/effect";
import { Schema as EffectSchema, Either } from "effect";
import { type AuthFn, ForbiddenError, routeAuth } from "eve/channels/auth";
import type { EveMessageContext } from "eve/channels/eve";
import type { SessionAuthContext } from "eve/context";
import { unparsedWire, type WireBoundaryInput } from "../../core.js";
import { actedForAccount, conversationIdOf, sessionAuthFor, turnKindOf } from "./auth.js";
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
 * A request to open a session must name a conversation of the caller's and
 * the kind of turn its opening message runs, at the door as well: eve
 * dispatches a durable run before the host's first resolver could refuse it,
 * a run no conversation records is one nobody can attach to, meter, or
 * retire, and a session opened under no turn kind would compose no prompt at
 * its start and then run every later turn under none. Whose a session or a conversation must
 * be is the account the caller acts for — the bearer's own, or the one the
 * deployment's principal names — read through the one accessor for it.
 */

/** What the store answers about who a session or a conversation belongs to. */
export interface SessionOwnership {
  /** The account whose conversation recorded this runtime session; nothing while none has. */
  sessionOwner(sessionId: string): Promise<string | undefined>;
  /** Whether the conversation stands and belongs to the account. */
  ownsConversation(userId: string, conversationId: string): Promise<boolean>;
}

const SESSION_ROUTE = /^\/eve\/v1\/session\/([^/]+)(?:\/|$)/;

const FORBIDDEN_STATUS = 403;

const trimmedText = EffectSchema.transform(EffectSchema.String, EffectSchema.String, {
  strict: true,
  decode: (value) => value.trim(),
  encode: (value) => value,
}).pipe(
  EffectSchema.filter((value) => value.trim().length > 0, {
    schemaId: EffectSchema.MinLengthSchemaId,
    jsonSchema: { minLength: 1 },
  }),
);

const refusalBody = EffectSchema.Struct({ error: trimmedText }).annotations({
  parseOptions: { onExcessProperty: "ignore" },
});

/** The reason a refusal response carries, as eve writes one; the refusal itself where the body cannot be read. */
async function refusalMessageOf(response: Response): Promise<string> {
  // SAFETY: eve's own JSON refusal body; the schema read that follows is what holds it to a shape.
  const body = readEither(refusalBody)(unparsedWire((await response.json()) as WireBoundaryInput));
  return Either.isRight(body) ? body.right.error : BRAIN_HOST_REFUSAL.NOT_OWNER;
}
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
    if (caller instanceof Response) {
      // eve's walk turns a refusal an inner authenticator threw into its
      // response; a 403 is a caller it recognised and refused, whose reason
      // must reach the caller rather than read as nobody signed in.
      if (caller.status === FORBIDDEN_STATUS) {
        throw new ForbiddenError({ message: await refusalMessageOf(caller) });
      }
      return null;
    }
    const account = actedForAccount(caller);
    if (account === undefined) throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NO_ACCOUNT });
    const sessionId = sessionIdOf(request);
    if (sessionId !== undefined && (await ownership.sessionOwner(sessionId)) !== account) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NOT_OWNER });
    }
    const auth = sessionAuthFor(caller, request);
    const conversationId = conversationIdOf(auth);
    const opening = opensSession(request);
    if (conversationId === undefined) {
      if (opening) throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NO_CONVERSATION });
      return caller;
    }
    if (!(await ownership.ownsConversation(account, conversationId))) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NOT_OWNER });
    }
    if (opening && turnKindOf(auth) === undefined) {
      throw new ForbiddenError({ message: BRAIN_HOST_REFUSAL.NO_TURN_KIND });
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
