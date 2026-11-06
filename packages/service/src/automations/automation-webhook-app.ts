import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import { readWebhookAutomation, recordAutomationRun } from "@repo/database/models/automation-store";
import { wireUuidSchema } from "@repo/features";
import { AUTOMATION_FIRING, AUTOMATION_WEBHOOK } from "@repo/features/automation-wire";
import { HTTP_METHOD, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
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

const PATH = "/api/automations/webhook";

const QUERY = { ID: "id" } as const;

const BEARER_PREFIX = "Bearer ";

function presentedSecret(request: Request): string | undefined {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length)
    : undefined;
}

function secretHolds(secret: string, kept: string): boolean {
  const offered = createHash("sha256").update(secret).digest();
  const wanted = Buffer.from(kept, "hex");
  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

function dedupeKeyOf(request: Request): string {
  const sent = request.headers.get(AUTOMATION_WEBHOOK.IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (sent.length === 0) return randomUUID();
  return createHash("sha256").update(sent).digest("hex");
}

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
    const text = yield* Effect.try(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(body),
    ).pipe(Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST));
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

export function automationWebhookApp(): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PATH, hostedRefusing(webhookEndpoint())),
    hostedNotFoundRoute,
  );
}
