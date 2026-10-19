/**
 * base.ts -- the implementer every hosted procedure is built from, and the three ways a caller is resolved.
 *
 * A request reaches a procedure with the web runtime's services as
 * `effect/context`, read once per function instance by the web route, and
 * the request itself, which the caller middlewares below read. Each of them
 * wraps a resolver the old route groups were handed, and refuses as those
 * groups did: a `HostedRefusal` in the failure channel, which the
 * `effect/wrap` in `errors.ts` turns into the declared error.
 *
 * An output is written in its wire encoding, and the convention that keeps it
 * so is the contract's: every procedure's `.output` is its wire schema
 * flipped (`Schema.flip(answerSchema)`), and its handler returns the answer's
 * decoded `Type`, the value the old groups handed `hostedJsonResponse`. oRPC
 * reads an output schema as a transform from what the handler returns (the
 * schema's input) to what the wire carries (its output), and checks every
 * answer through it; flipped, that check is the wire schema's encode, so
 * what the serializer writes is the encoded value a client's decode reads,
 * the same bytes `hostedJsonResponse` wrote. Note that the unflipped schema
 * would decode an already-decoded value, which refuses or re-transforms any
 * field whose `Type` and `Encoded` differ (a date, a number read from a
 * string) and answers a 500. A refusal's extra fields follow the same
 * convention (`@luke/features/contract`'s `errors.ts`).
 */

import "@orpc/experimental-effect/extensions/effect";
import { hostedContract } from "@luke/features/contract";
import { middlewareGen, type WithEffectContext } from "@orpc/experimental-effect";
import { implement } from "@orpc/server";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedCarriesBearer,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";

/** What every hosted procedure is called with: the request, and the web runtime's services. */
export interface HostedContext extends WithEffectContext<WebServices> {
  readonly request: Request;
}

/** The account a caller middleware resolved. */
export interface HostedCaller {
  readonly userId: string;
}

/** A Better Auth session's account, and the headers that carry it on to the plugin. */
interface HostedSessionCaller extends HostedCaller {
  readonly sessionHeaders: Headers;
}

/** The hosted contract to implement, every procedure taking the context above. */
export const hosted = implement(hostedContract).$context<HostedContext>();

/** The caller by its bearer, or with no `Authorization` at all, the browser's session cookie (`auth/bearer.ts`'s `resolveHostedUserId`). */
export function accountMiddleware(resolveUserId: UserIdResolver) {
  return middlewareGen<HostedContext, HostedCaller>(function* ({ context, next }) {
    const account = yield* resolveUserId(context.request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({ context: { userId: account.value } });
  });
}

/** The caller by its bearer alone: a request with no `Authorization`, one only a cookie could name, is refused (`hostedCarriesBearer`). */
export function bearerOnlyMiddleware(resolveUserId: UserIdResolver) {
  return middlewareGen<HostedContext, HostedCaller>(function* ({ context, next }) {
    if (!hostedCarriesBearer(context.request))
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const account = yield* resolveUserId(context.request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({ context: { userId: account.value } });
  });
}

/**
 * The caller by a Better Auth session, with the headers that carry it on;
 * an auth service that could not answer is an outage the caller may retry,
 * and a session it does not take is refused as unauthenticated.
 */
export function sessionMiddleware(resolveSessionUserId: SessionUserIdResolver) {
  return middlewareGen<HostedContext, HostedSessionCaller>(function* ({ context, next }) {
    const account = yield* resolveSessionUserId(context.request).pipe(
      Effect.tapError((failure) => Effect.logWarning("the auth service read no session", failure)),
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({
      context: { userId: account.value, sessionHeaders: context.request.headers },
    });
  });
}

/**
 * Refuses a body its `Content-Length` says is past the procedure's own
 * bound, as the old groups' `readJsonBodyEffect(maximumBytes)` refused one:
 * `request-too-large`.
 */
export function bodyLimit(maximumBytes: number) {
  return middlewareGen<HostedContext>(function* ({ context, next }) {
    const length = Number(context.request.headers.get("content-length") ?? 0);
    if (length > maximumBytes) return yield* Effect.fail(HOSTED_REFUSAL.REQUEST_TOO_LARGE);
    return yield* next();
  });
}
