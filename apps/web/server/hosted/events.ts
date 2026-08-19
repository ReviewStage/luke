import {
  type ProductEventBatch,
  productEventBatchFromWire,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import {
  type FetchLike,
  type PosthogBatch,
  type PosthogUpstreamOptions,
  postPosthogBatch,
} from "./posthog.js";

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

/** Bigger than a full batch of allowlisted events can be, and refused before parsing. */
const MAXIMUM_BODY_BYTES = 16_384;

/**
 * A best-effort brake, keyed on the resolved account rather than the address:
 * the token already names who is asking, so an account cannot rotate past it
 * by changing networks. The counter lives in the function instance, which
 * makes it a per-instance brake rather than a guarantee — platform-level rules
 * are the real backstop — but it turns a looping desktop bug into a trickle.
 */
const RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_EVENTS_PER_WINDOW: 120,
  /** The counter map is bounded; past this it forgets rather than grows. */
  MAX_TRACKED_USERS: 10_000,
} as const;

/**
 * How far back a desktop's own clock may place an event. A Mac set to the
 * wrong year must not scatter counts across the timeline, so what arrives is
 * clamped into this window ending at the reader's own clock — the same
 * principle the review answer follows by stamping `decidedAt` here rather than
 * trusting the sender.
 */
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

export interface EventsOptions {
  request: Request;
  /** The analytics project token, from the deployment environment; absent means recording is off. */
  projectApiKey: string | undefined;
  /** A deployment-configured ingestion host; the shared default otherwise. */
  host?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

/**
 * Builds the documented batch document. Three of its fields are the whole
 * privacy posture, and each fails silently if got wrong: `distinct_id` sits
 * inside an item's properties, where a top-level one is accepted and dropped;
 * `$geoip_disable` is what keeps the processor from resolving an event with no
 * address to the data centre's own location; and `historical_migration` stays
 * false because this is live traffic rather than a backfill.
 */
function batchDocument(
  events: ProductEventBatch,
  projectApiKey: string,
  userId: string,
  now: number,
): PosthogBatch {
  return {
    api_key: projectApiKey,
    historical_migration: false,
    batch: events.map((event) => ({
      event: event.name,
      timestamp: new Date(
        Math.min(now, Math.max(event.at, now - MAXIMUM_EVENT_AGE_MS)),
      ).toISOString(),
      properties: {
        ...event.properties,
        distinct_id: userId,
        $geoip_disable: true,
        $lib: "luke-desktop",
      },
    })),
  };
}

export async function handleEvents(options: EventsOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  // Trimmed like every other deployment key read: a whitespace token is the
  // kill switch, not a key, and an unconfigured deployment is simply not
  // measured — nothing else depends on this endpoint answering.
  const projectApiKey = trimmedText(options.projectApiKey);
  if (!projectApiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const raw = await request.text().catch(() => undefined);
  // Measured before parsing: an oversized body is refused rather than read.
  if (raw === undefined || new TextEncoder().encode(raw).byteLength > MAXIMUM_BODY_BYTES) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  // SAFETY: JSON.parse returns a runtime value; the batch reader is the parser.
  const wire = payload as UnparsedWireValue;
  // The reader owns the batch limit as well as the vocabulary, and refuses an
  // oversized batch whole rather than trimming it.
  const events = productEventBatchFromWire(wire);
  if (!events) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const now = (options.now ?? Date.now)();
  if (rateLimited(userId, events.length, now)) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }

  const upstream: PosthogUpstreamOptions = {};
  if (options.host !== undefined) upstream.host = options.host;
  if (options.fetch) upstream.fetch = options.fetch;
  if (options.timeoutMs !== undefined) upstream.timeoutMs = options.timeoutMs;
  const response = await postPosthogBatch(
    batchDocument(events, projectApiKey, userId, now),
    upstream,
  );
  if (!response) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }
  if (!response.ok) {
    // Status alone diagnoses the upstream without carrying its body onward.
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, {
      upstreamStatus: response.status,
    });
  }
  // The desktop drops the batch whichever way this lands; the distinction is
  // for the tests and alerts that watch this endpoint.
  return jsonResponse(HOSTED_HTTP_STATUS.ACCEPTED, { accepted: events.length });
}
