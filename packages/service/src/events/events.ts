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

export const WORKSPACE_GROUP_TYPE = "workspace";

const PRODUCT_EVENT_LIB = {
  [PRODUCT_PLATFORM.DESKTOP]: "vespin-desktop",
  [PRODUCT_PLATFORM.WEB]: "vespin-web",
} as const satisfies Record<ProductClientPlatform, string>;

const PLATFORM_PROPERTY = "platform";

const ENVIRONMENT_PROPERTY = "environment";

const UNNAMED_DEPLOYMENT = "development";

export const DEPLOYMENT_VARIABLE = "VERCEL_ENV";

const RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_EVENTS_PER_WINDOW: 120,
  MAX_TRACKED_USERS: 10_000,
} as const;

const eventsBrake = makeRateBrake({
  windowMs: RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: RATE_LIMIT.MAX_EVENTS_PER_WINDOW,
  maxTrackedUsers: RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface EventsOptions {
  projectApiKey: string;
  host?: string;
  deployment?: string | undefined;
  readPerson?: (
    userId: string,
  ) => Effect.Effect<PosthogPerson | undefined, QueryError | Schema.SchemaError, DatabaseServices>;
}

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
          Math.min(now, Math.max(event.at, now - PRODUCT_EVENT_MAXIMUM_AGE_MS)),
        ).toISOString(),
        properties: index === 0 && person ? { ...properties, $set: person } : properties,
      } satisfies PosthogBatchItem;
    }),
  };
}

export function deploymentNamed(deployment: string | undefined): string {
  return trimmedText(deployment) ?? UNNAMED_DEPLOYMENT;
}

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
    const events = productEventBatchFromWire(payload);
    if (!events) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
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
    const read = options.readPerson
      ? yield* Effect.option(options.readPerson(userId))
      : Option.none<PosthogPerson | undefined>();
    if (Option.isSome(read) && read.value === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    }
    const person = Option.getOrUndefined(read);
    const workspaceId = yield* batchWorkspaceOf(userId).pipe(
      Effect.orElseSucceed((): string | undefined => undefined),
    );
    const response = yield* postBatchEffect(
      batchDocument(events, stamp, options.projectApiKey, userId, now, person, workspaceId),
      upstream,
    );
    if (!response) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
    if (!response.ok) return yield* Effect.fail(upstreamRefused(response.status));
    return { accepted: events.length };
  });
}
