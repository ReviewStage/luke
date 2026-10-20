import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import type { productEventsAnswerSchema } from "@luke/features/analytics";
import { Clock, Effect, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  PRODUCT_EVENT_MAXIMUM_AGE_MS,
  type ProductEventBatch,
  type ProductEventBuild,
  productEventBatchFromWire,
  productEventBuildFromWire,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import { HOSTED_REFUSAL, type HostedRefusal, upstreamRefused } from "../http/http-effect.js";
import { makeRateBrake } from "../http/rate-brake.js";
import {
  type PosthogBatch,
  type PosthogBatchItem,
  type PosthogPerson,
  type PosthogUpstreamOptions,
  postBatchEffect,
} from "../providers/posthog.js";

/**
 * Records what the signed-in desktop counted about its own use. The desktop
 * never talks to the analytics processor: it posts an allowlisted batch here,
 * and this endpoint is the one place an identity is attached to it — resolved
 * from the same bearer token the voice and review endpoints trust, so the
 * request body has no place to name an account and no way to name a different
 * one.
 *
 * What the reader admits is the whole vocabulary: `productEventBatchFromWire`
 * builds each event from the event's own property allowlist rather than from
 * what arrived, so a `distinct_id`, an `$ip`, or a `$set` on the way in is not
 * copied forward, and no property can hold free text.
 */

/** Bigger than a full batch of allowlisted events can be, and refused before it is read. */
export const EVENTS_MAXIMUM_BODY_BYTES = 16_384;

/** The `$lib` tag every batch is stamped with: the desktop is the one app that posts them. */
const PRODUCT_EVENT_LIB = "luke-desktop";

/** The property every forwarded event names the deployment that recorded it under. */
const ENVIRONMENT_PROPERTY = "environment";

/** The environment stamped where Vercel names none, as a local `vercel dev` or a test; Sentry's own fallback. */
const UNNAMED_DEPLOYMENT = "development";

/** What the shared brake holds this endpoint to; a batch spends its own event count. */
const RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_EVENTS_PER_WINDOW: 120,
  /** The counter map is bounded; past this it forgets rather than grows. */
  MAX_TRACKED_USERS: 10_000,
} as const;

const eventsBrake = makeRateBrake({
  windowMs: RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: RATE_LIMIT.MAX_EVENTS_PER_WINDOW,
  maxTrackedUsers: RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface EventsOptions {
  /** The analytics project token, from the deployment environment, trimmed and present. */
  projectApiKey: string;
  /** A deployment-configured ingestion host; the shared default otherwise. */
  host?: string;
  /**
   * The deployment's own `VERCEL_ENV` (`production`, `preview`, or
   * `development`), stamped on every event as `environment` so a preview's
   * or a local service's counts can be told from production's.
   */
  deployment?: string | undefined;
  /**
   * The account's own name and address, for the person record. Omitted by a
   * deployment that would rather PostHog held neither; the counts still land.
   */
  readPerson?: (
    userId: string,
  ) => Effect.Effect<PosthogPerson | undefined, QueryError | Schema.SchemaError, DatabaseServices>;
}

/**
 * Builds the documented batch document. Three of its fields are the whole
 * privacy posture, and each fails silently if got wrong: `distinct_id` sits
 * at each item's top level, where PostHog's capture docs ask for it, and an
 * item without one is answered 200 and silently dropped;
 * `$geoip_disable` is what keeps the processor from resolving an event with no
 * address to the data centre's own location; and `historical_migration` stays
 * false because this is live traffic rather than a backfill.
 *
 * The account's name and address ride as person properties rather than event
 * properties, and only on the first item of a batch — `$set` names the person
 * the events belong to, where an event property would put free text in the
 * event stream the allowlist exists to keep it out of. They are read from the
 * service's own user row: nothing identifying arrives from the desktop, and
 * nothing a caller sends can name a different person.
 *
 * Every event is also stamped with the deployment that recorded it and with
 * what the desktop said about the build the batch came from, so a preview's,
 * a local service's, or a development build's counts can be filtered from
 * production's. They go under the event's own properties, so an event that
 * names its own `app_version` keeps it.
 */
function batchDocument(
  events: ProductEventBatch,
  stamp: ProductEventBuild & { readonly [ENVIRONMENT_PROPERTY]: string },
  projectApiKey: string,
  userId: string,
  now: number,
  person: PosthogPerson | undefined,
): PosthogBatch {
  return {
    api_key: projectApiKey,
    historical_migration: false,
    batch: events.map((event, index) => {
      const properties = {
        ...stamp,
        ...event.properties,
        $geoip_disable: true,
        $lib: PRODUCT_EVENT_LIB,
      };
      return {
        event: event.name,
        distinct_id: userId,
        timestamp: new Date(
          // Clamped into the shared window ending at this reader's own clock
          // — the same principle the review answer follows by stamping
          // `decidedAt` here rather than trusting the sender.
          Math.min(now, Math.max(event.at, now - PRODUCT_EVENT_MAXIMUM_AGE_MS)),
        ).toISOString(),
        properties: index === 0 && person ? { ...properties, $set: person } : properties,
      } satisfies PosthogBatchItem;
    }),
  };
}

/**
 * One batch recorded for the account the caller resolved to: read through
 * the allowlist, braked, stamped, and forwarded. The caller, the kill
 * switch, and the body's size are the route's to settle before this runs
 * (`events-procedures.ts`).
 */
export function recordEvents(
  userId: string,
  payload: UnparsedWireValue,
  options: EventsOptions,
): Effect.Effect<
  typeof productEventsAnswerSchema.Type,
  HostedRefusal,
  DatabaseServices | HttpClient.HttpClient
> {
  return Effect.gen(function* () {
    // The reader owns the batch limit as well as the vocabulary, and refuses an
    // oversized batch whole rather than trimming it.
    const events = productEventBatchFromWire(payload);
    if (!events) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    // Note that a batch of nothing but retired names is accepted with nothing
    // to post, because the older build that sent it is not at fault.
    if (events.length === 0) return { accepted: 0 };
    const stamp = {
      ...productEventBuildFromWire(payload),
      [ENVIRONMENT_PROPERTY]: trimmedText(options.deployment) ?? UNNAMED_DEPLOYMENT,
    };

    const now = yield* Clock.currentTimeMillis;
    if (!(yield* eventsBrake.check(userId, events.length))) {
      return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
    }

    const upstream: PosthogUpstreamOptions = {};
    if (options.host !== undefined) upstream.host = options.host;
    // A failed read costs the person's name, never the counts.
    const readPerson = options.readPerson;
    const person = readPerson
      ? yield* readPerson(userId).pipe(
          Effect.orElseSucceed((): PosthogPerson | undefined => undefined),
        )
      : undefined;
    const response = yield* postBatchEffect(
      batchDocument(events, stamp, options.projectApiKey, userId, now, person),
      upstream,
    );
    if (!response) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
    // Status alone diagnoses the upstream without carrying its body onward.
    if (!response.ok) return yield* Effect.fail(upstreamRefused(response.status));
    // The desktop drops the batch whichever way this lands; the distinction is
    // for the tests and alerts that watch this endpoint.
    return { accepted: events.length };
  });
}
