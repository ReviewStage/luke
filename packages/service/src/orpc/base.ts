import "@orpc/experimental-effect/extensions/effect";
import { middlewareGen, type WithEffectContext } from "@orpc/experimental-effect";
import { implement } from "@orpc/server";
import type { ResponseHeadersHandlerPluginContext } from "@orpc/server/plugins";
import type { DatabaseServices } from "@repo/database/core/query";
import { type KeyRing, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { keepWriteReceipt, writeReceiptStands } from "@repo/database/models/write-receipts";
import { IDEMPOTENCY_KEY } from "@repo/features";
import { hostedContract } from "@repo/features/contract";
import { Context, Effect, Option, References, Result, Tracer } from "effect";
import { Headers, HttpTraceContext } from "effect/http";
import {
  admittedHostVersion,
  hostCallerOf,
  presentedHostVersion,
  presentedPollSecret,
} from "../auth/device-secret.js";
import { sessionCredential } from "../auth/session-credential.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedCarriesBearer,
  hostedStoreOrUnavailable,
  resolvedAccount,
  type SessionUserIdResolver,
  type UserIdResolver,
} from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";

const WRITE_RECEIPT_KEPT_MS = 30 * 24 * 60 * 60_000;

export interface HostedContext
  extends WithEffectContext<WebServices>,
    ResponseHeadersHandlerPluginContext {
  readonly request: Request;
}

export interface HostedCaller {
  readonly userId: string;
}

type AccountContext<Caller extends HostedCaller> = Caller & WithEffectContext<WebServices>;

interface HostedSessionCaller extends HostedCaller {
  readonly sessionHeaders: Headers;
}

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

function forAccount(context: HostedContext, userId: string): WithEffectContext<WebServices> {
  const services = context["effect/context"];
  return {
    "effect/context": Context.add(services, References.CurrentLogAnnotations, {
      ...Context.get(services, References.CurrentLogAnnotations),
      userId,
    }),
  };
}

export const hosted = implement(hostedContract).$context<HostedContext>().use(procedureTraced);

export function accountMiddleware(resolveUserId: UserIdResolver) {
  return middlewareGen<HostedContext, AccountContext<HostedCaller>>(function* ({ context, next }) {
    const account = yield* resolvedAccount(resolveUserId, context.request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    return yield* next({
      context: { userId: account.value, ...forAccount(context, account.value) },
    });
  });
}

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

export interface DeviceCaller extends HostedCaller {
  readonly deviceId: string;
}

export const deviceCallerOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<DeviceCaller, HostedRefusal, DatabaseServices> {
  const host = yield* hostCallerOf(request);
  if (Option.isSome(host)) return host.value;
  return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
});

export function actsForDevice(caller: DeviceCaller, deviceId: string): boolean {
  return caller.deviceId === deviceId;
}

export function deviceMiddleware() {
  return middlewareGen<HostedContext, AccountContext<DeviceCaller>>(function* ({ context, next }) {
    if (!hostedCarriesBearer(context.request))
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const caller = yield* deviceCallerOf(context.request);
    return yield* next({ context: { ...caller, ...forAccount(context, caller.userId) } });
  });
}

export interface PairingHost {
  readonly hostVersion: string;
}

export const pairingHostMiddleware = middlewareGen<HostedContext, PairingHost>(function* ({
  context,
  next,
}) {
  const hostVersion = yield* admittedHostVersion(presentedHostVersion(context.request));
  return yield* next({ context: { hostVersion } });
});

export interface PollingHost extends PairingHost {
  readonly pollSecret: string;
}

export const pollSecretMiddleware = middlewareGen<HostedContext, PollingHost>(function* ({
  context,
  next,
}) {
  const pollSecret = presentedPollSecret(context.request);
  if (pollSecret === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const hostVersion = yield* admittedHostVersion(presentedHostVersion(context.request));
  return yield* next({ context: { pollSecret, hostVersion } });
});

export const keyRingMiddleware = middlewareGen<HostedContext, { readonly ring: KeyRing }>(
  function* ({ next }) {
    const environment = yield* HostedEnvironment;
    const configured = environment.providerKeyEncryptionKeys;
    if (configured === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    const ring = parseKeyRing(configured);
    if (Result.isFailure(ring)) {
      yield* Effect.logError(`The provider key encryption keys cannot be read: ${ring.failure}`);
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    return yield* next({ context: { ring: ring.success } });
  },
);

export const writeReceiptMiddleware = middlewareGen<HostedContext & HostedCaller>(function* ({
  context,
  next,
}) {
  const key = context.request.headers.get(IDEMPOTENCY_KEY.HEADER);
  if (key === null) return yield* next();
  if (key.length === 0 || key.length > IDEMPOTENCY_KEY.MAX_LENGTH) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const { userId } = context;
  if (yield* hostedStoreOrUnavailable(writeReceiptStands(userId, key))) {
    return yield* Effect.fail(HOSTED_REFUSAL.ALREADY_WRITTEN);
  }
  const answered = yield* next();
  yield* keepWriteReceipt(userId, key, WRITE_RECEIPT_KEPT_MS).pipe(
    Effect.catch((failure) => Effect.logWarning("a write's receipt was not kept", failure)),
  );
  return answered;
});

export function sessionMiddleware(resolveSessionUserId: SessionUserIdResolver) {
  return middlewareGen<HostedContext, AccountContext<HostedSessionCaller>>(function* ({
    context,
    next,
  }) {
    const sessionHeaders = sessionCredential(context.request.headers);
    if (sessionHeaders === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
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
