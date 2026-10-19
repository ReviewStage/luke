import type { AutomationTriggerKind } from "@luke/features/automation-wire";
import type { IntegrationProvider } from "@luke/features/integration-wire";
import { Clock, Context, Effect, Layer, Option, Redacted } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { HostedEnvironment } from "../environment.js";
import { type PosthogBatch, postBatchEffect } from "../providers/posthog.js";

/**
 * What Luke's service counts about the work done through it: the core loop the
 * desktop cannot see, because it happens on the service or in an agent's
 * sandbox — a task started, a coding agent started, a pull request opened, an
 * automation made, an integration connected.
 *
 * It holds to the desktop's counted events' rule
 * (`@luke/features/analytics`'s `product-events.ts`): an event is a name from
 * this file, and every property is one of this file's fixed words, a boolean,
 * or an id from a catalog the service itself checked (a provider, a model, an
 * effort). Nothing typed, nothing a model wrote, and no title, branch,
 * repository, prompt, or row id has a property it could travel in, which the
 * types below enforce at each call site.
 *
 * The events are joined to the same person the desktop's are, by the account's
 * own user id, so PostHog's funnels run from the site's sign-in through the
 * desktop's counts to the work itself; and erased with them on account
 * deletion, which deletes by that id.
 */

export const SERVER_EVENT = {
  TASK_CREATE: "task:create",
  AGENT_START: "agent:start",
  PULL_REQUEST_CREATE: "agent:pull_request_create",
  INBOX_ANSWER_SEND: "inbox:answer_send",
  CHAT_MESSAGE_SEND: "chat:message_send",
  AUTOMATION_CREATE: "automation:create",
  ISSUE_CREATE: "issue:create",
  INTEGRATION_CONNECTION_CREATE: "integration:connection_create",
  INTEGRATION_CONNECTION_DELETE: "integration:connection_delete",
  WORKSPACE_CREATE: "workspace:create",
} as const;

type ServerEventName = (typeof SERVER_EVENT)[keyof typeof SERVER_EVENT];

/** Where a task was started from: the sidebar's own Start, or an agent's tool. */
export const SERVER_TASK_SOURCE = {
  SIDEBAR: "sidebar",
  AGENT: "agent",
} as const;

/** How a coding agent began: fresh on a plan or a prompt, or carried on from another agent. */
export const SERVER_AGENT_START_KIND = {
  FRESH: "fresh",
  FORK: "fork",
  CONTINUE: "continue",
} as const;

/** Which account a pull request was opened as. */
export const SERVER_PULL_REQUEST_OPENER = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

type Values<T> = T[keyof T];

/**
 * Exactly what each event carries. A model and an effort are catalog ids the
 * start already checked against the catalog it offers, and a provider is the
 * integration catalog's own id; every other value is a word from this file, or
 * a kind the store's own schema enumerates.
 */
interface ServerEventProperties {
  [SERVER_EVENT.TASK_CREATE]: {
    source: Values<typeof SERVER_TASK_SOURCE>;
    has_issue: boolean;
  };
  [SERVER_EVENT.AGENT_START]: {
    model: string;
    effort: string;
    start_kind: Values<typeof SERVER_AGENT_START_KIND>;
    is_from_automation: boolean;
    has_task: boolean;
  };
  [SERVER_EVENT.PULL_REQUEST_CREATE]: {
    opened_as: Values<typeof SERVER_PULL_REQUEST_OPENER>;
    is_draft: boolean;
  };
  [SERVER_EVENT.INBOX_ANSWER_SEND]: Record<string, never>;
  [SERVER_EVENT.CHAT_MESSAGE_SEND]: { is_reply: boolean };
  [SERVER_EVENT.AUTOMATION_CREATE]: { trigger_kind: AutomationTriggerKind };
  [SERVER_EVENT.ISSUE_CREATE]: Record<string, never>;
  [SERVER_EVENT.INTEGRATION_CONNECTION_CREATE]: { provider: IntegrationProvider };
  [SERVER_EVENT.INTEGRATION_CONNECTION_DELETE]: { provider: IntegrationProvider };
  [SERVER_EVENT.WORKSPACE_CREATE]: Record<string, never>;
}

/** One event as the service records it. */
interface ServerEvent<Name extends ServerEventName = ServerEventName> {
  readonly name: Name;
  readonly userId: string;
  readonly properties: ServerEventProperties[Name];
}

/** The `$lib` every server-recorded event is stamped with, beside the desktop's own. */
const SERVER_EVENT_LIB = "luke-service";

/**
 * How long one capture may hold the request it rides on. A serverless
 * instance may freeze once it answers, so the capture is awaited rather than
 * left in the background, and bounded so a slow processor costs a count rather
 * than a request.
 */
const SERVER_EVENT_TIMEOUT_MS = 2_000;

/** The one item a server event posts, under the same privacy fields the desktop's batch carries. */
function serverEventBatch(event: ServerEvent, projectApiKey: string, now: number): PosthogBatch {
  return {
    api_key: projectApiKey,
    historical_migration: false,
    batch: [
      {
        event: event.name,
        distinct_id: event.userId,
        timestamp: new Date(now).toISOString(),
        properties: {
          ...event.properties,
          // Without it an event with no address resolves to the data centre's.
          $geoip_disable: true,
          $lib: SERVER_EVENT_LIB,
        },
      },
    ],
  };
}

interface ProductAnalyticsValues {
  /** Records one event, or does nothing; it never fails and never names the key. */
  readonly capture: (event: ServerEvent) => Effect.Effect<void>;
}

/**
 * The service's own analytics. Read optionally (`recordServerEvent`), so a
 * call site's requirements do not change and a runtime or a test that provides
 * none records nothing.
 */
class ProductAnalytics extends Context.Service<ProductAnalytics, ProductAnalyticsValues>()(
  "ProductAnalytics",
) {}

/**
 * The deployment's analytics, from the same project token the desktop's batch
 * is posted under. A deployment without one — a Preview, a local run — records
 * nothing, the same kill switch `/api/events` has.
 */
export const productAnalyticsFromEnvironment = Layer.effect(
  ProductAnalytics,
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const client = yield* HttpClient.HttpClient;
    const key = environment.posthogProjectApiKey;
    if (key === undefined) return { capture: () => Effect.void };
    const host = environment.posthogIngestHost;
    return {
      capture: (event: ServerEvent) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* postBatchEffect(serverEventBatch(event, Redacted.value(key), now), {
            ...(host === undefined ? undefined : { host }),
            timeoutMs: SERVER_EVENT_TIMEOUT_MS,
          });
        }).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.ignore),
    };
  }),
);

/**
 * Counts one event where the work was committed. Typed per event, so a call
 * site can only hand over that event's own properties; a runtime without
 * `ProductAnalytics` makes this a no-op.
 */
export function recordServerEvent<Name extends ServerEventName>(
  name: Name,
  userId: string,
  properties: ServerEventProperties[Name],
): Effect.Effect<void> {
  return Effect.flatMap(Effect.serviceOption(ProductAnalytics), (analytics) =>
    Option.isNone(analytics)
      ? Effect.void
      : // SAFETY: `properties` is typed as this `name`'s own entry above; the
        // union `ServerEvent` widens the pairing TypeScript cannot follow.
        analytics.value.capture({ name, userId, properties } as ServerEvent),
  );
}

/**
 * Analytics that keeps what it was handed rather than posting it, for a test
 * that asserts what an endpoint counted.
 */
export function recordingProductAnalytics() {
  const recorded: ServerEvent[] = [];
  const layer = Layer.succeed(ProductAnalytics, {
    capture: (event) => Effect.sync(() => void recorded.push(event)),
  });
  return { layer, recorded };
}
