import type { DatabaseServices } from "@repo/database/core/query";
import {
  integrationAutomationsOn,
  recordAutomationRun,
} from "@repo/database/models/automation-store";
import { AUTOMATION_FIRING, AUTOMATION_TRIGGER } from "@repo/features/automation-wire";
import { TRIGGER_PROVIDER, type TriggerProvider } from "@repo/features/trigger-catalog";
import { HTTP_METHOD } from "@repo/wire";
import { DateTime, Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import type { SentryApp } from "./sentry/sentry-app-config.js";
import { sentryTriggerSource } from "./sentry/sentry-trigger-source.js";
import {
  integrationFiltersMatch,
  type NormalizedEvent,
  TRIGGER_VERIFICATION,
  type TriggerDelivery,
  type TriggerSource,
} from "./trigger-source.js";

const MAXIMUM_DELIVERY_BYTES = 1024 * 1024;

const MAXIMUM_AUTOMATIONS = 100;

const TRIGGER_SOURCES = {
  [TRIGGER_PROVIDER.SENTRY]: sentryTriggerSource,
} as const satisfies Record<TriggerProvider, TriggerSource<SentryApp>>;

type TriggerSourceServices = SentryApp;

const queueEvent = Effect.fnUntraced(function* (
  provider: TriggerProvider,
  organizationId: string,
  event: NormalizedEvent,
  firedAt: Date,
) {
  const listening = yield* integrationAutomationsOn(
    organizationId,
    provider,
    event.event,
    MAXIMUM_AUTOMATIONS,
  );
  let queued = 0;
  for (const automation of listening) {
    const { trigger } = automation;
    if (trigger.kind !== AUTOMATION_TRIGGER.INTEGRATION) continue;
    if (!integrationFiltersMatch(trigger.filters, event.attributes)) continue;
    const recorded = yield* recordAutomationRun(automation, {
      dedupeKey: event.dedupeKey,
      firing: {
        kind: AUTOMATION_FIRING.INTEGRATION,
        provider,
        event: event.event,
        subject: event.subject,
      },
      payload: event.summary,
      firedAt,
    });
    if (Option.isSome(recorded)) queued += 1;
  }
  return queued;
});

function deliveryEndpoint(source: TriggerSource<TriggerSourceServices>) {
  return Effect.fn("web/triggerIngressEndpoint")(function* (): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices | TriggerSourceServices
  > {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.method !== HTTP_METHOD.POST) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const body = yield* readBodyBytesEffect(MAXIMUM_DELIVERY_BYTES);
    const headers = request.headers;
    const verification = yield* source.verify({ headers }, body);
    if (verification === TRIGGER_VERIFICATION.UNCONFIGURED) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    if (verification !== TRIGGER_VERIFICATION.VALID) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const delivery: TriggerDelivery = { headers, body, payload: yield* parseJsonBytes(body) };
    if (
      source.lifecycle !== undefined &&
      (yield* hostedStoreOrUnavailable(source.lifecycle(delivery)))
    ) {
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { queued: 0 });
    }
    const workspace = yield* hostedStoreOrUnavailable(source.workspaceOf(delivery));
    if (Option.isNone(workspace)) {
      return hostedJsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, { queued: 0 });
    }
    const firedAt = yield* DateTime.nowAsDate;
    let queued = 0;
    for (const event of source.normalize(delivery)) {
      queued += yield* hostedStoreOrUnavailable(
        queueEvent(source.provider, workspace.value, event, firedAt),
      );
    }
    return hostedJsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, { queued });
  });
}

export function triggerIngressApp(): WebRoutes<DatabaseServices | TriggerSourceServices> {
  const deliveries = Object.values(TRIGGER_SOURCES).map((source) =>
    HttpRouter.add(ANY_METHOD, source.path, hostedRefusing(deliveryEndpoint(source)())),
  );
  return Layer.mergeAll(hostedNotFoundRoute, ...deliveries);
}
