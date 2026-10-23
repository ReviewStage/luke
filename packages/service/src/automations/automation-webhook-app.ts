import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import { readWebhookAutomation, recordAutomationRun } from "@luke/database/models/automation-store";
import { wireUuidSchema } from "@luke/features";
import { AUTOMATION_FIRING, AUTOMATION_WEBHOOK } from "@luke/features/automation-wire";
import { HTTP_METHOD, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { DateTime, Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * automation-webhook-app.ts -- an automation's webhook address: a call under the trigger's secret queues one run, its body kept for the agent's prompt.
 *
 * The caller is whatever the developer handed the address to, Sentry, a CI
 * job, a script, so it carries no account bearer: it is admitted by the
 * trigger's own secret as the `Authorization: Bearer` value, hashed and
 * compared in constant time against the SHA-256 the store keeps. Note that
 * the secret is never read from the address, because a platform's request
 * log keeps the address whole. An id that names no webhook automation, one
 * whose owner left its workspace, and a secret that does not hold are
 * refused alike, so the address says nothing of what stands behind it. A
 * paused automation takes the call and queues nothing, its body unread, so
 * a sender does not retry. The run is queued under the caller's
 * `Idempotency-Key` where it sends one, so a retry is the same run, with
 * the body as it came, UTF-8 up to its bound and holding no NUL, which a
 * text column cannot keep, beside it; the minute sweep starts the agent,
 * which is handed the body fenced as the caller's own text. Nothing of the
 * body or the secret is logged.
 */

/** The path a caller posts to; the rewrite moves the address's id into the `id` query. */
const PATH = "/api/automations/webhook";

const QUERY = { ID: "id" } as const;

/** What a bearer header leads with before the secret. */
const BEARER_PREFIX = "Bearer ";

/** The secret the call presents as its bearer; nothing where it sends none. */
function presentedSecret(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length)
    : undefined;
}

/** Whether the secret's SHA-256 is the hash kept, compared in constant time. */
function secretHolds(secret: string, kept: string): boolean {
  const offered = createHash("sha256").update(secret).digest();
  const wanted = Buffer.from(kept, "hex");
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/**
 * The caller's own key for the call as its SHA-256, so a key of any length
 * names the one run on every retry; a fresh one where it sends none, so a
 * call without one is its own run. Note that every key sent is hashed,
 * because a key kept as sent could be sent as another caller's digest and
 * name that run.
 */
function dedupeKeyOf(request: Request): string {
  const sent = request.headers.get(AUTOMATION_WEBHOOK.IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (sent.length === 0) return randomUUID();
  return createHash("sha256").update(sent).digest("hex");
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
    if (!automation.value.enabled) return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { queued: 0 });
    const body = yield* readBodyBytesEffect(AUTOMATION_WEBHOOK.MAX_BODY_BYTES);
    // Bytes that are no UTF-8 text could not be handed to the agent whole, so they are refused.
    const text = yield* Effect.try(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ).pipe(Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST));
    // A NUL is UTF-8 but no text a column keeps, so a body holding one is refused rather than lost.
    if (text.includes("\u0000")) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const firedAt = yield* DateTime.nowAsDate;
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
