import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@sidecar/database/core/query";
import {
  readWebhookAutomation,
  recordAutomationRun,
} from "@sidecar/database/models/automation-store";
import { wireUuidSchema } from "@sidecar/hosted";
import {
  AUTOMATION_BOUNDS,
  AUTOMATION_FIRING,
  AUTOMATION_WEBHOOK,
} from "@sidecar/hosted/automation-wire";
import { unparsedWire } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readBodyBytesEffect,
} from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * automation-webhook-app.ts -- an automation's webhook address: a call under the trigger's secret queues one run, its body kept for the agent's task.
 *
 * The caller is whatever the developer handed the address to, Sentry, a CI
 * job, a script, so it carries no account bearer: it is admitted by the
 * trigger's own secret, as the `Authorization: Bearer` value or, for a
 * sender that can set no header, the address's `token` query, hashed and
 * compared in constant time against the SHA-256 the store keeps. An id that
 * names no webhook automation and a secret that does not hold are refused
 * alike, so the address says nothing of what stands behind it. A paused
 * automation takes the call and queues nothing, so a sender does not retry.
 * The run is queued under the caller's `Idempotency-Key` where it sends
 * one, so a retry is the same run, with the body as it came, UTF-8 up to
 * its bound, beside it; the minute sweep starts the agent, which is handed the
 * body fenced as the caller's own text. Nothing of the body or the secret
 * is logged.
 */

const PATH = "/api/automations/webhook";

const HTTP_METHOD = { POST: "POST" } as const;

const QUERY = { ID: "id" } as const;

/** What a bearer header leads with before the secret. */
const BEARER_PREFIX = "Bearer ";

/** The secret the call presents: the bearer's value, else the `token` query; nothing where it sends neither. */
function presentedSecret(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith(BEARER_PREFIX)) return authorization.slice(BEARER_PREFIX.length);
  return new URL(request.url).searchParams.get(AUTOMATION_WEBHOOK.TOKEN_QUERY) ?? undefined;
}

/** Whether the secret's SHA-256 is the hash kept, compared in constant time. */
function secretHolds(secret: string, kept: string): boolean {
  const offered = createHash("sha256").update(secret).digest();
  const wanted = Buffer.from(kept, "hex");
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/**
 * The caller's own key for the call, its SHA-256 where it runs past the
 * bound, so a long key still names the one run on every retry; a fresh one
 * where it sends none, so a call without one is its own run.
 */
function dedupeKeyOf(request: Request): string {
  const sent = request.headers.get(AUTOMATION_WEBHOOK.IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (sent.length === 0) return randomUUID();
  return sent.length <= AUTOMATION_BOUNDS.MAX_KEY_CHARS
    ? sent
    : createHash("sha256").update(sent).digest("hex");
}

/** The body as UTF-8 text, or nothing for bytes that are not, which the agent could not be handed whole. */
function utf8Of(body: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
}

/** POST: one call, admitted by the trigger's secret, queuing one run. */
const webhookEndpoint = /* @__PURE__ */ Effect.fn("web/automationWebhookEndpoint")(
  function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const ids = new URL(request.url).searchParams.getAll(QUERY.ID);
    const id = readEither(wireUuidSchema)(unparsedWire(ids.length === 1 ? (ids[0] ?? "") : ""));
    const secret = presentedSecret(request);
    if (Result.isFailure(id) || secret === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const automation = yield* hostedStoreOrUnavailable(readWebhookAutomation(id.success));
    if (
      Option.isNone(automation) ||
      automation.value.webhookSecretHash === null ||
      !secretHolds(secret, automation.value.webhookSecretHash)
    ) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const body = yield* readBodyBytesEffect(AUTOMATION_WEBHOOK.MAX_BODY_BYTES);
    const text = utf8Of(body);
    if (text === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    if (!automation.value.enabled) return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { queued: 0 });
    const firedAt = new Date(yield* Clock.currentTimeMillis);
    const recorded = yield* hostedStoreOrUnavailable(
      recordAutomationRun(automation.value, {
        dedupeKey: dedupeKeyOf(request),
        firing: { kind: AUTOMATION_FIRING.WEBHOOK, bytes: body.byteLength },
        payload: text,
        firedAt,
      }),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, {
      queued: Option.isSome(recorded) ? 1 : 0,
    });
  },
);

/** The group: the one webhook path, and the hosted vocabulary's own refusal for any other. */
export function automationWebhookApp(): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PATH, hostedRefusing(webhookEndpoint())),
    hostedNotFoundRoute,
  );
}
