import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCT_EVENT, PRODUCT_EVENT_BATCH_LIMIT, type WireValue } from "../server/core.js";
import { type EventsOptions, handleEvents } from "../server/hosted/events";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { PosthogBatch } from "../server/hosted/posthog";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const PROJECT_KEY = "phc_project";

const LAUNCH = {
  name: PRODUCT_EVENT.APP_LAUNCH,
  at: NOW - 30_000,
  properties: { app_version: "0.2.0" },
};

type PropertyValue = string | number | boolean | undefined;

interface BatchItem {
  event: string;
  timestamp: string;
  properties: Readonly<Record<string, PropertyValue>>;
}

interface Forwarded {
  url: string;
  body: PosthogBatch;
}

interface OnlyBatch {
  request: Forwarded;
  items: readonly BatchItem[];
}

/** The one forwarded request, with its batch already narrowed. */
function onlyBatch(forwarded: readonly Forwarded[]): OnlyBatch {
  assert.equal(forwarded.length, 1);
  const request = forwarded[0];
  assert.ok(request);
  return { request, items: request.body.batch };
}

function itemAt(items: readonly BatchItem[], index: number): BatchItem {
  const item = items[index];
  assert.ok(item, `batch item ${index} is missing`);
  return item;
}

function upstream(status = 200) {
  const forwarded: Forwarded[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    // SAFETY: the body is the batch document this endpoint just serialized.
    const body = JSON.parse(String(init.body)) as PosthogBatch;
    forwarded.push({ url, body });
    return new Response("{}", { status });
  };
  return { fetch, forwarded };
}

/** A request carrying an already-serialized body, for the malformed cases. */
function rawEventsRequest(body: string): Request {
  return new Request("https://luke.test/api/events", {
    method: "POST",
    headers: { authorization: "Bearer token-1" },
    body,
  });
}

function eventsRequest(body: WireValue): Request {
  return rawEventsRequest(JSON.stringify(body));
}

function options(overrides: Partial<EventsOptions> = {}): EventsOptions {
  const resolveUserId: EventsOptions["resolveUserId"] = async () => "user-1";
  return {
    request: eventsRequest({ events: [LAUNCH] }),
    projectApiKey: PROJECT_KEY,
    resolveUserId,
    now: () => NOW,
    ...overrides,
  };
}

/** Each test gets its own account, because the rate-limit map outlives one. */
let accounts = 0;
function freshUser(): () => Promise<string | undefined> {
  accounts += 1;
  const userId = `user-${accounts}`;
  return async () => userId;
}

test("only POST is answered, and nothing is forwarded without a key or a token", async () => {
  const wrongMethod = upstream();
  const rejectedMethod = await handleEvents(
    options({
      request: new Request("https://luke.test/api/events"),
      fetch: wrongMethod.fetch,
    }),
  );
  assert.equal(rejectedMethod.status, 405);
  assert.equal((await rejectedMethod.json()).error, HOSTED_API_ERROR.METHOD_NOT_ALLOWED);
  assert.equal(wrongMethod.forwarded.length, 0);

  const keyless = upstream();
  let resolved = 0;
  const unconfigured = await handleEvents(
    options({
      projectApiKey: "   ",
      fetch: keyless.fetch,
      resolveUserId: async () => {
        resolved += 1;
        return "user-1";
      },
    }),
  );
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error, HOSTED_API_ERROR.UNAVAILABLE);
  assert.equal(keyless.forwarded.length, 0);
  // The kill switch is read before the token, so an unconfigured deployment
  // does no work at all.
  assert.equal(resolved, 0);

  const anonymous = upstream();
  const refused = await handleEvents(
    options({ resolveUserId: async () => undefined, fetch: anonymous.fetch }),
  );
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(anonymous.forwarded.length, 0);
});

test("a malformed or oversized body is refused, the oversized one before parsing", async () => {
  const malformed = upstream();
  const unreadable = await handleEvents(
    options({
      request: rawEventsRequest("{not json"),
      fetch: malformed.fetch,
      resolveUserId: freshUser(),
    }),
  );
  assert.equal(unreadable.status, 400);
  assert.equal((await unreadable.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);

  const strange = await handleEvents(
    options({
      request: eventsRequest({ events: [{ name: "app:sneak", at: NOW, properties: {} }] }),
      fetch: malformed.fetch,
      resolveUserId: freshUser(),
    }),
  );
  assert.equal(strange.status, 400);

  const overLimit = await handleEvents(
    options({
      request: eventsRequest({
        events: Array.from({ length: PRODUCT_EVENT_BATCH_LIMIT + 1 }, () => LAUNCH),
      }),
      fetch: malformed.fetch,
      resolveUserId: freshUser(),
    }),
  );
  assert.equal(overLimit.status, 400);

  // Valid JSON, but past the byte ceiling: refused without being parsed at all.
  const huge = await handleEvents(
    options({
      request: rawEventsRequest(`{"events":[],"pad":"${"x".repeat(20_000)}"}`),
      fetch: malformed.fetch,
      resolveUserId: freshUser(),
    }),
  );
  assert.equal(huge.status, 400);
  assert.equal(malformed.forwarded.length, 0);
});

test("the resolved account is the distinct id, whatever the body tried to say", async () => {
  const posthog = upstream();
  const response = await handleEvents(
    options({
      request: eventsRequest({
        distinct_id: "someone-else",
        events: [
          { ...LAUNCH, distinct_id: "someone-else" },
          {
            name: PRODUCT_EVENT.SESSION_OBSERVE,
            at: NOW,
            properties: {
              provider_id: "codex",
              session_count: 2,
              $ip: "203.0.113.7",
              distinct_id: "someone-else",
            },
          },
        ],
      }),
      fetch: posthog.fetch,
      resolveUserId: freshUser(),
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: 2 });
  const { request: forwarded, items } = onlyBatch(posthog.forwarded);
  assert.match(forwarded.url, /\/batch\/$/);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.properties.distinct_id, `user-${accounts}`);
    assert.equal(item.properties.$ip, undefined);
  }
  assert.deepEqual(itemAt(items, 1).properties, {
    provider_id: "codex",
    session_count: 2,
    distinct_id: `user-${accounts}`,
    $geoip_disable: true,
    $lib: "luke-desktop",
  });
});

/**
 * The four conventions that fail silently if got wrong: a top-level
 * `distinct_id` is accepted and dropped, an event with no address geo-resolves
 * to the data centre without `$geoip_disable`, `historical_migration` skips
 * spike detection, and a non-ISO timestamp is not read as one.
 */
test("the forwarded document matches the processor's documented batch shape", async () => {
  const posthog = upstream();
  await handleEvents(options({ fetch: posthog.fetch, resolveUserId: freshUser() }));

  const { request: forwarded, items } = onlyBatch(posthog.forwarded);
  assert.equal(forwarded.body.api_key, PROJECT_KEY);
  assert.equal(forwarded.body.historical_migration, false);
  const item = itemAt(items, 0);
  assert.equal(item.event, PRODUCT_EVENT.APP_LAUNCH);
  // The documented shape puts it inside properties; a top-level one is
  // accepted by the processor and then silently dropped.
  assert.ok(!Object.hasOwn(item, "distinct_id"));
  assert.equal(item.properties.distinct_id, `user-${accounts}`);
  assert.equal(item.properties.$geoip_disable, true);
  assert.equal(item.timestamp, new Date(LAUNCH.at).toISOString());
  assert.match(item.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("a wrong desktop clock is clamped to the reader's own window", async () => {
  const posthog = upstream();
  await handleEvents(
    options({
      request: eventsRequest({
        events: [
          { ...LAUNCH, at: NOW + 400 * 24 * 60 * 60 * 1000 },
          { ...LAUNCH, at: NOW - 400 * 24 * 60 * 60 * 1000 },
        ],
      }),
      fetch: posthog.fetch,
      resolveUserId: freshUser(),
    }),
  );

  const { items } = onlyBatch(posthog.forwarded);
  assert.equal(itemAt(items, 0).timestamp, new Date(NOW).toISOString());
  assert.equal(itemAt(items, 1).timestamp, new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString());
});

test("past the per-account brake the batch is refused rather than forwarded", async () => {
  const posthog = upstream();
  const resolveUserId = freshUser();
  const send = () =>
    handleEvents(
      options({
        request: eventsRequest({ events: Array.from({ length: 50 }, () => LAUNCH) }),
        fetch: posthog.fetch,
        resolveUserId,
      }),
    );

  assert.equal((await send()).status, 202);
  assert.equal((await send()).status, 202);
  const braked = await send();
  assert.equal(braked.status, 429);
  assert.equal((await braked.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.equal(posthog.forwarded.length, 2);

  // The window turning frees the account again.
  const later = await handleEvents(
    options({
      request: eventsRequest({ events: [LAUNCH] }),
      fetch: posthog.fetch,
      resolveUserId,
      now: () => NOW + 61_000,
    }),
  );
  assert.equal(later.status, 202);
});

test("an upstream refusal answers 502 carrying its status and nothing else", async () => {
  const refusing = upstream(400);
  const response = await handleEvents(
    options({ fetch: refusing.fetch, resolveUserId: freshUser() }),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: HOSTED_API_ERROR.UPSTREAM_ERROR,
    upstreamStatus: 400,
  });

  const unreachable = await handleEvents(
    options({
      fetch: async () => {
        throw new Error("network down");
      },
      resolveUserId: freshUser(),
    }),
  );
  assert.equal(unreachable.status, 502);
  assert.deepEqual(await unreachable.json(), { error: HOSTED_API_ERROR.UPSTREAM_ERROR });
});
