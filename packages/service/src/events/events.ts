import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { memberWorkspaceIds, personalWorkspaceOf } from "@repo/database/models/workspace-store";
import type { productEventsAnswerSchema } from "@repo/features/analytics";
import { Clock, Effect, Option, type Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  PRODUCT_EVENT_MAXIMUM_AGE_MS,
  PRODUCT_PLATFORM,
  type ProductClientPlatform,
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
 *
 * Nor does anything arrive that names a workspace. A batch is filed under the
 * workspace's group (`$groups`, never a property) that the service's own
 * membership rows name for the caller: the one workspace they share with
 * others, or, for a member of none, their own personal one; a member of two
 * or more shared workspaces is filed under none, since the batch cannot say
 * which they were in. Note that what such a member does in their personal
 * workspace is then counted under the team, which is the trade for asking the
 * apps for nothing: only the window knows which workspace it lists.
 */

/** The group type a workspace is filed under in PostHog, one of the project's five, shared by the service's own counts (`server-events.ts`). */
export const WORKSPACE_GROUP_TYPE = "workspace";

/** The `$lib` tag a batch is stamped with, by the platform that sent it. */
const PRODUCT_EVENT_LIB = {
  [PRODUCT_PLATFORM.DESKTOP]: "luke-desktop",
  [PRODUCT_PLATFORM.WEB]: "luke-web",
} as const satisfies Record<ProductClientPlatform, string>;

/** The property every forwarded event names its platform under. */
const PLATFORM_PROPERTY = "platform";

/** The property every forwarded event names the deployment that recorded it under. */
const ENVIRONMENT_PROPERTY = "environment";

/** The environment stamped where Vercel names none, as a local `vercel dev` or a test; Sentry's own fallback. */
const UNNAMED_DEPLOYMENT = "development";

/** Vercel's own name for the deployment: `production`, `preview`, or `development`. */
export const DEPLOYMENT_VARIABLE = "VERCEL_ENV";

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
   * Where it finds no row, the account is gone and the batch is refused.
   */
  readPerson?: (
    userId: string,
  ) => Effect.Effect<PosthogPerson | undefined, QueryError | Schema.SchemaError, DatabaseServices>;
}

/**
 * The workspace a member's batch is filed under: their one shared workspace,
 * else their personal one where it is the only one they are in, else none
 * (the header says why).
 */
function batchWorkspaceOf(
  userId: string,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    const memberOf = yield* memberWorkspaceIds(userId);
    const personal = Option.getOrUndefined(yield* personalWorkspaceOf(userId));
    const shared = memberOf.filter((workspaceId) => workspaceId !== personal);
    if (shared.length > 0) return shared.length === 1 ? shared[0] : undefined;
    return personal !== undefined && memberOf.includes(personal) ? personal : undefined;
  });
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
 * production's. A batch that names no platform comes from a build older than
 * the label, which was the desktop alone, so it reads as desktop. They go under the event's own properties, so an event that
 * names its own `app_version` keeps it. Each is filed under the batch's
 * workspace where it has one (`batchWorkspaceOf`).
 */
function batchDocument(
  events: ProductEventBatch,
  stamp: ProductEventBuild & {
    readonly [ENVIRONMENT_PROPERTY]: string;
    readonly [PLATFORM_PROPERTY]: ProductClientPlatform;
  },
  projectApiKey: string,
  userId: string,
  now: number,
  person: PosthogPerson | undefined,
  workspaceId: string | undefined,
): PosthogBatch {
  return {
    api_key: projectApiKey,
    historical_migration: false,
    batch: events.map((event, index) => {
      const properties = {
        ...stamp,
        ...event.properties,
        $geoip_disable: true,
        $lib: PRODUCT_EVENT_LIB[stamp.platform],
        ...(workspaceId === undefined
          ? undefined
          : { $groups: { [WORKSPACE_GROUP_TYPE]: workspaceId } }),
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

/** The environment an event is stamped with: the deployment's own name, or `development` where it names none. */
export function deploymentNamed(deployment: string | undefined): string {
  return trimmedText(deployment) ?? UNNAMED_DEPLOYMENT;
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
    const build = productEventBuildFromWire(payload);
    const stamp = {
      ...build,
      [PLATFORM_PROPERTY]: build.platform ?? PRODUCT_PLATFORM.DESKTOP,
      [ENVIRONMENT_PROPERTY]: deploymentNamed(options.deployment),
    };

    const now = yield* Clock.currentTimeMillis;
    if (!(yield* eventsBrake.check(userId, events.length))) {
      return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
    }

    const upstream: PosthogUpstreamOptions = {};
    if (options.host !== undefined) upstream.host = options.host;
    // A failed read costs the person's name, never the counts.
    const read = options.readPerson
      ? yield* Effect.option(options.readPerson(userId))
      : Option.none<PosthogPerson | undefined>();
    // Note that a read finding no row is an account deleted since its caller
    // was resolved, whose batch would bring back the person it erased.
    if (Option.isSome(read) && read.value === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const person = Option.getOrUndefined(read);
    // A failed read costs the workspace's group, never the counts.
    const workspaceId = yield* batchWorkspaceOf(userId).pipe(
      Effect.orElseSucceed((): string | undefined => undefined),
    );
    const response = yield* postBatchEffect(
      batchDocument(events, stamp, options.projectApiKey, userId, now, person, workspaceId),
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
