import type { DatabaseServices } from "@luke/database/core/query";
import {
  integrationAutomationsOn,
  recordAutomationRun,
} from "@luke/database/models/automation-store";
import { AUTOMATION_FIRING, AUTOMATION_TRIGGER } from "@luke/features/automation-wire";
import { TRIGGER_PROVIDER, type TriggerProvider } from "@luke/features/trigger-catalog";
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

/**
 * trigger-ingress-app.ts -- where an integration delivers its events: a delivery verified by its trigger source, matched to the automations of the workspace that installed the integration, and queued as their runs.
 *
 * Every source's delivery is read the same way. Nothing of it is read
 * before its source confirms the signature over the body's own bytes, and a
 * deployment that holds no secret for the provider answers unavailable, so
 * an unconfigured integration trusts nothing. A delivery about the source's
 * own installation is handled by it and fires nothing. A delivery through
 * an installation no workspace stands for, unknown or uninstalled, is
 * answered and queues nothing, so the provider does not retry it. Each
 * event the source reads it as finds the enabled automations of that
 * workspace alone listening for it, keeps those whose filters it passes,
 * and queues one run for each under the delivery's own key, so a
 * redelivery queues none; the run carries the event's subject and its
 * summary, never the delivery's body, and the minute sweep starts each
 * agent, since a provider waits only a second or so for the answer.
 * Nothing of the body is logged.
 */

const HTTP_METHOD = { POST: "POST" } as const;

/** The largest delivery read; Sentry's are tens of kilobytes. */
const MAXIMUM_DELIVERY_BYTES = 1024 * 1024;

/** The most automations one event queues runs for, of those listening for it. */
const MAXIMUM_AUTOMATIONS = 100;

/** Every integration Luke receives events from, by its trigger source. */
const TRIGGER_SOURCES = {
  [TRIGGER_PROVIDER.SENTRY]: sentryTriggerSource,
} as const satisfies Record<TriggerProvider, TriggerSource<SentryApp>>;

/** What the sources need beside the store. */
type TriggerSourceServices = SentryApp;

/** The runs one event queues in its workspace: one for each automation listening for it whose filters it passes. */
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

/** POST: one delivery, verified by its source before anything of it is read. */
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

/** The group: each source's delivery path, and the hosted vocabulary's own refusal for any other. */
export function triggerIngressApp(): WebRoutes<DatabaseServices | TriggerSourceServices> {
  const deliveries = Object.values(TRIGGER_SOURCES).map((source) =>
    HttpRouter.add(ANY_METHOD, source.path, hostedRefusing(deliveryEndpoint(source)())),
  );
  return Layer.mergeAll(hostedNotFoundRoute, ...deliveries);
}
