/**
 * base.ts -- the implementer every hosted procedure is built from, and the ways a caller is resolved.
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
import type { DatabaseServices } from "@luke/database/core/query";
import { type KeyRing, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { hostedContract } from "@luke/features/contract";
import { middlewareGen, type WithEffectContext } from "@orpc/experimental-effect";
import { implement } from "@orpc/server";
import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";
import { Context, Effect, Option, References, Result, Tracer } from "effect";
import { Headers, HttpTraceContext } from "effect/http";
import {
  admittedHostVersion,
  hostCallerOf,
  presentedHostVersion,
  presentedInstallToken,
  presentedPollSecret,
} from "../auth/device-secret.js";
import { sessionCredential } from "../auth/session-credential.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedCarriesBearer,
  resolvedAccount,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";

/**
 * What every hosted procedure is called with: the request, the web runtime's
 * services, and the headers the answer will carry beside its own, which
 * `ResponseHeadersHandlerPlugin` (`handler.ts`) provides.
 */
export interface HostedContext
  extends WithEffectContext<WebServices>,
    ResponseHeadersHandlerPluginContext {
  readonly request: Request;
}

/** The account a caller middleware resolved. */
export interface HostedCaller {
  readonly userId: string;
}

/** A caller handed on with the services its procedure runs under, the caller's account among their log annotations (`forAccount`). */
type AccountContext<Caller extends HostedCaller> = Caller & WithEffectContext<WebServices>;

/** A Better Auth session's account, and the headers that carry it on to the plugin. */
interface HostedSessionCaller extends HostedCaller {
  readonly sessionHeaders: Headers;
}

/**
 * Every procedure runs under a server span named by its path, whose parent
 * is the caller's trace as its `traceparent` names it, and every log line it
 * writes carries its path as `procedure`, so a store failure
 * (`http/store-failure.ts`) names the route it was met on, and the span's
 * trace id as `traceId`, so a caller's failure report and the server's lines
 * for the same call are found by one id. A request with no `traceparent`, or
 * one that does not parse, starts a trace of its own.
 *
 * Note that the caller's trace is read for correlation alone: its trace id is
 * continued and its sampling flag followed, as Sentry's own propagation does
 * (`observability/sentry.ts`'s `sentryTelemetry`), and no other header value
 * reaches a span or a log line. An unsampled call is a span that records
 * nothing but still names the caller's trace id, so its lines carry it too.
 *
 * Note that the span and the annotations are set on the services handed to
 * the handler, not with `Effect.withSpan` or `Effect.annotateLogs` around
 * `next()`, because `next` runs the handler as a fiber of its own, which
 * neither of this one's reaches.
 */
const procedureTraced = middlewareGen<HostedContext, WithEffectContext<WebServices>>(function* ({
  context,
  path,
  next,
}) {
  const procedure = path.join(".");
  const caller = HttpTraceContext.w3c(Headers.fromInput(context.request.headers));
  const options = { kind: "server", parent: Option.getOrUndefined(caller) } as const;
  return yield* Effect.useSpan(procedure, options, (span) => {
    const services = context["effect/context"];
    const annotated = Context.add(services, References.CurrentLogAnnotations, {
      ...Context.get(services, References.CurrentLogAnnotations),
      procedure,
      traceId: span.traceId,
    });
    return next({ context: { "effect/context": Context.add(annotated, Tracer.ParentSpan, span) } });
  });
});

/**
 * The services handed on with the caller's account among their log
 * annotations, as `userId`, so every line the procedure writes names the
 * account and every issue it raises names it as Sentry's user
 * (`observability/sentry.ts`), on the terms `procedureAnnotated` sets its path.
 */
function forAccount(context: HostedContext, userId: string): WithEffectContext<WebServices> {
  const services = context["effect/context"];
  return {
    "effect/context": Context.add(services, References.CurrentLogAnnotations, {
      ...Context.get(services, References.CurrentLogAnnotations),
      userId,
    }),
  };
}

/** The hosted contract to implement, every procedure taking the context above. */
export const hosted = implement(hostedContract).$context<HostedContext>().use(procedureTraced);

/** The caller by its bearer, or with no `Authorization` at all, the browser's session cookie (`auth/bearer.ts`'s `resolveHostedUserId`). */
export function accountMiddleware(resolveUserId: UserIdResolver) {
  return middlewareGen<HostedContext, AccountContext<HostedCaller>>(function* ({ context, next }) {
    const account = yield* resolvedAccount(resolveUserId, context.request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({
      context: { userId: account.value, ...forAccount(context, account.value) },
    });
  });
}

/** The caller by its bearer alone: a request with no `Authorization`, one only a cookie could name, is refused (`hostedCarriesBearer`). */
export function bearerOnlyMiddleware(resolveUserId: UserIdResolver) {
  return middlewareGen<HostedContext, AccountContext<HostedCaller>>(function* ({ context, next }) {
    if (!hostedCarriesBearer(context.request))
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const account = yield* resolvedAccount(resolveUserId, context.request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({
      context: { userId: account.value, ...forAccount(context, account.value) },
    });
  });
}

/** A device's caller: the enrolled machine its device secret names, by its account and its device, the one device it may act for. */
export interface DeviceCaller extends HostedCaller {
  readonly deviceId: string;
}

/**
 * The caller as a device: an enrolled machine by its device secret, of any
 * platform (`auth/device-secret.ts`'s `hostCallerOf`, which refuses a
 * secret no standing machine holds and a host program below the floor).
 * A desktop's own sign-in, which released desktop builds followed the
 * queue on before every machine ran the host program, is refused as
 * needing an upgrade, so such a build says to update Luke rather than
 * failing unexplained; any other bearer is refused as unauthenticated. The
 * one read of a device's caller, which the device-agents procedures and
 * the runner token route both take.
 */
export const deviceCallerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  resolveUserId: UserIdResolver,
  request: Request,
): Effect.fn.Return<DeviceCaller, HostedRefusal, DatabaseServices> {
  const host = yield* hostCallerOf(request);
  if (Option.isSome(host)) return host.value;
  const account = yield* resolvedAccount(resolveUserId, request);
  return yield* Effect.fail(
    Option.isSome(account) ? HOSTED_REFUSAL.HOST_UPGRADE_NEEDED : HOSTED_REFUSAL.INVALID_TOKEN,
  );
});

/** Whether a device's caller may act for the device named: an enrolled machine for itself alone, every route alike. */
export function actsForDevice(caller: DeviceCaller, deviceId: string): boolean {
  return caller.deviceId === deviceId;
}

/** The caller as a device (`deviceCallerOf`), by its bearer alone, on `bearerOnlyMiddleware`'s terms. */
export function deviceMiddleware(resolveUserId: UserIdResolver) {
  return middlewareGen<HostedContext, AccountContext<DeviceCaller>>(function* ({ context, next }) {
    if (!hostedCarriesBearer(context.request))
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const caller = yield* deviceCallerOf(resolveUserId, context.request);
    return yield* next({ context: { ...caller, ...forAccount(context, caller.userId) } });
  });
}

/** An enroll's caller: the install token its bearer carries, and its daemon's version, at or past the floor. */
export interface EnrollingHost {
  readonly installToken: string;
  readonly hostVersion: string;
}

/**
 * The caller as a box enrolling: an install token as its bearer, or refused
 * as unauthenticated, as every other procedure refuses a caller that names
 * no credential; then its daemon's version, refused as needing an upgrade
 * below the floor. Whether the token stands is the enroll's to read.
 */
export const installTokenMiddleware = middlewareGen<HostedContext, EnrollingHost>(function* ({
  context,
  next,
}) {
  const installToken = presentedInstallToken(context.request);
  if (installToken === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const hostVersion = yield* admittedHostVersion(presentedHostVersion(context.request));
  return yield* next({ context: { installToken, hostVersion } });
});

/** A pairing box's caller: no credential, and its daemon's version, at or past the floor. */
export interface PairingHost {
  readonly hostVersion: string;
}

/**
 * The caller as a box starting a pairing: no credential is read, and its
 * daemon's version is refused as needing an upgrade below the floor, as
 * an enroll's is (`installTokenMiddleware`).
 */
export const pairingHostMiddleware = middlewareGen<HostedContext, PairingHost>(function* ({
  context,
  next,
}) {
  const hostVersion = yield* admittedHostVersion(presentedHostVersion(context.request));
  return yield* next({ context: { hostVersion } });
});

/** A pairing box's poll: the poll secret its bearer carries, and its daemon's version, at or past the floor. */
export interface PollingHost extends PairingHost {
  readonly pollSecret: string;
}

/**
 * The caller as a pairing box polling: a poll secret as its bearer, or
 * refused as unauthenticated, then its daemon's version, refused as needing
 * an upgrade below the floor. Which pairing the secret names, if any, is
 * the poll's to read.
 */
export const pollSecretMiddleware = middlewareGen<HostedContext, PollingHost>(function* ({
  context,
  next,
}) {
  const pollSecret = presentedPollSecret(context.request);
  if (pollSecret === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const hostVersion = yield* admittedHostVersion(presentedHostVersion(context.request));
  return yield* next({ context: { pollSecret, hostVersion } });
});

/** The deployment's ring, handed on as the procedure's, or the request refused as unavailable where it holds none it can parse. */
export const keyRingMiddleware = middlewareGen<HostedContext, { readonly ring: KeyRing }>(
  function* ({ next }) {
    const environment = yield* HostedEnvironment;
    const configured = environment.providerKeyEncryptionKeys;
    if (configured === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const ring = parseKeyRing(configured);
    if (Result.isFailure(ring)) {
      // The fault names the shape that is wrong and never a value.
      yield* Effect.logError(`The provider key encryption keys cannot be read: ${ring.failure}`);
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    return yield* next({ context: { ring: ring.success } });
  },
);

/**
 * The caller by a Better Auth session, read from the request's one
 * credential (`auth/session-credential.ts`) and carried on to the plugin in
 * it alone, so the plugin acts as the session read here and no other. A
 * request that carries no credential is refused as unauthenticated without
 * asking the auth service; an auth service that could not answer is an
 * outage the caller may retry, and a session it does not take is refused as
 * unauthenticated.
 */
export function sessionMiddleware(resolveSessionUserId: SessionUserIdResolver) {
  return middlewareGen<HostedContext, AccountContext<HostedSessionCaller>>(function* ({
    context,
    next,
  }) {
    const sessionHeaders = sessionCredential(context.request.headers);
    if (sessionHeaders === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    // The resolver reads a request's headers alone, so it is handed one carrying the credential and nothing else.
    const credentialed = new Request(context.request.url, { headers: sessionHeaders });
    const account = yield* resolveSessionUserId(credentialed).pipe(
      Effect.tapError((failure) => Effect.logWarning("the auth service read no session", failure)),
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({
      context: { userId: account.value, sessionHeaders, ...forAccount(context, account.value) },
    });
  });
}
