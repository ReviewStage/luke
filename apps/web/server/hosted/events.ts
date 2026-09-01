import { Effect } from "effect";
import { type ProductEventBatch, text as trimmedText } from "../core.js";
import { HostedAuth, HostedClock, HostedPosthog } from "../services/tags.js";
import {
  decodeBoundedJsonBody,
  HOSTED_HTTP_STATUS,
  invalidRequest,
  jsonResponseEffect,
  methodNotAllowed,
  quotaExhausted,
  unauthorized,
  unavailable,
  upstreamError,
} from "./http-effect.js";
import type { PosthogBatch, PosthogBatchItem, PosthogPerson } from "./posthog.js";
import { ProductEventBatchSchema } from "./schema.js";

/** Bigger than a full batch of allowlisted events can be, and refused before parsing. */
const MAXIMUM_BODY_BYTES = 16_384;

const RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_EVENTS_PER_WINDOW: 120,
  MAX_TRACKED_USERS: 10_000,
} as const;

const MAXIMUM_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const recentUsers = new Map<string, { windowStart: number; count: number }>();

function rateLimited(userId: string, events: number, now: number): boolean {
  const held = recentUsers.get(userId);
  if (!held || now - held.windowStart >= RATE_LIMIT.WINDOW_MS) {
    if (recentUsers.size >= RATE_LIMIT.MAX_TRACKED_USERS) recentUsers.clear();
    recentUsers.set(userId, { windowStart: now, count: events });
    return events > RATE_LIMIT.MAX_EVENTS_PER_WINDOW;
  }
  held.count += events;
  return held.count > RATE_LIMIT.MAX_EVENTS_PER_WINDOW;
}

function batchDocument(
  events: ProductEventBatch,
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
        ...event.properties,
        distinct_id: userId,
        $geoip_disable: true,
        $lib: "luke-desktop",
      };
      return {
        event: event.name,
        timestamp: new Date(
          Math.min(now, Math.max(event.at, now - MAXIMUM_EVENT_AGE_MS)),
        ).toISOString(),
        properties: index === 0 && person ? { ...properties, $set: person } : properties,
      } satisfies PosthogBatchItem;
    }),
  };
}

export const handleEvents = Effect.fn("handleEvents")(function* (request: Request) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const posthog = yield* HostedPosthog;
  const projectApiKey = trimmedText(posthog.projectApiKey);
  if (!projectApiKey) {
    return unavailable();
  }

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const events = yield* decodeBoundedJsonBody(request, MAXIMUM_BODY_BYTES, ProductEventBatchSchema);
  if (!events) {
    return invalidRequest();
  }

  const clock = yield* HostedClock;
  const now = clock.now();
  if (rateLimited(userId, events.length, now)) {
    return quotaExhausted();
  }

  const person = posthog.readPerson
    ? yield* posthog.readPerson(userId).pipe(Effect.catchAll(() => Effect.succeed(undefined)))
    : undefined;

  const response = yield* posthog
    .postBatch(batchDocument(events, projectApiKey, userId, now, person))
    .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
  if (!response) {
    return upstreamError();
  }
  if (!response.ok) {
    return upstreamError(response.status);
  }

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.ACCEPTED, { accepted: events.length });
});
