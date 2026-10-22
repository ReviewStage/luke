import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { INTEGRATION_TRIGGER_FILTER, SENTRY_TRIGGER_EVENT } from "@luke/features/trigger-catalog";
import type { UnparsedWireValue } from "@luke/wire";
import { Effect, Layer, Redacted } from "effect";
import { TRIGGER_VERIFICATION, type TriggerDelivery } from "../trigger-source.js";
import { SentryApp, sentryAppService } from "./sentry-app-config.js";
import { sentryTriggerSource } from "./sentry-trigger-source.js";

/**
 * The Sentry integration's deliveries as its trigger source reads them: a
 * delivery signed under the client secret over its own bytes is the
 * integration's, and a tampered body, another secret, or no signature is
 * not; an issue alert and a new issue, recorded from Sentry's documented
 * payloads and scrubbed, read as the catalog's events with their subject,
 * filter fields, and a bounded summary; and a resource or action the source
 * does not read is no event. Synthetic organizations and words throughout.
 */

const SECRET = "synthetic-client-secret";

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8");
}

function signed(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** A delivery as the ingress hands it on, under the resource and request id named. */
function delivery(resource: string, text: string, requestId = "req-1"): TriggerDelivery {
  return {
    headers: { "sentry-hook-resource": resource, "request-id": requestId },
    body: new TextEncoder().encode(text),
    // SAFETY: the fixture is JSON; the source's schemas hold it to a shape.
    payload: JSON.parse(text) as UnparsedWireValue,
  };
}

const configured = Layer.succeed(
  SentryApp,
  sentryAppService({ slug: "luke", clientId: "client", clientSecret: Redacted.make(SECRET) }, []),
);

const verify = (headers: Record<string, string>, body: string) =>
  sentryTriggerSource
    .verify({ headers }, new TextEncoder().encode(body))
    .pipe(Effect.provide(configured));

it.effect("a delivery signed under the client secret over its own bytes is the integration's", () =>
  Effect.gen(function* () {
    const body = fixture("issue-created");
    assert.equal(
      yield* verify({ "sentry-hook-signature": signed(body) }, body),
      TRIGGER_VERIFICATION.VALID,
    );
  }),
);

it.effect(
  "a tampered body, another secret, no signature, or a signature that is no hex is refused",
  () =>
    Effect.gen(function* () {
      const body = fixture("issue-created");
      const tampered = body.replace("connection pool exhausted", "all is well");
      assert.equal(
        yield* verify({ "sentry-hook-signature": signed(body) }, tampered),
        TRIGGER_VERIFICATION.INVALID,
      );
      assert.equal(
        yield* verify({ "sentry-hook-signature": signed(body, "another-secret") }, body),
        TRIGGER_VERIFICATION.INVALID,
      );
      assert.equal(yield* verify({}, body), TRIGGER_VERIFICATION.INVALID);
      assert.equal(
        yield* verify({ "sentry-hook-signature": `zz${signed(body).slice(2)}` }, body),
        TRIGGER_VERIFICATION.INVALID,
      );
    }),
);

it.effect("a deployment holding no client secret trusts nothing", () =>
  Effect.gen(function* () {
    const body = fixture("issue-created");
    const verdict = yield* sentryTriggerSource
      .verify(
        { headers: { "sentry-hook-signature": signed(body) } },
        new TextEncoder().encode(body),
      )
      .pipe(Effect.provide(Layer.succeed(SentryApp, sentryAppService(undefined, ["SECRET"]))));
    assert.equal(verdict, TRIGGER_VERIFICATION.UNCONFIGURED);
  }),
);

it("an issue alert reads as an alert on its issue, with its project, environment, level, and in-app frames", () => {
  const [event, ...rest] = sentryTriggerSource.normalize(
    delivery("event_alert", fixture("event-alert-triggered")),
  );
  assert.equal(rest.length, 0);
  assert.ok(event);
  assert.equal(event.event, SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED);
  assert.deepEqual(event.subject, {
    id: "1117540176",
    title: "TypeError: Cannot read properties of undefined (reading 'percent')",
    url: "https://sentry.io/organizations/acme/issues/1117540176/",
  });
  assert.deepEqual(event.attributes, {
    [INTEGRATION_TRIGGER_FILTER.PROJECT]: ["storefront"],
    [INTEGRATION_TRIGGER_FILTER.ENVIRONMENT]: ["production"],
    [INTEGRATION_TRIGGER_FILTER.LEVEL]: ["error"],
  });
  assert.match(event.summary, /^Alert rule: Checkout errors in production$/mu);
  assert.match(event.summary, /^Release: web@2026\.10\.18$/mu);
  assert.match(
    event.summary,
    /In-app frames, innermost first:\n {2}applyDiscount \(src\/cart\/discount\.ts:42\)\n {2}submitOrder \(src\/cart\/checkout\.tsx:88\)$/u,
  );
  assert.doesNotMatch(event.summary, /react-dom/u, "a library's frame is not the app's");
});

it("a new issue reads as a new issue, with its project, level, counts, and short id", () => {
  const [event] = sentryTriggerSource.normalize(delivery("issue", fixture("issue-created")));
  assert.ok(event);
  assert.equal(event.event, SENTRY_TRIGGER_EVENT.ISSUE_CREATED);
  assert.deepEqual(event.subject, {
    id: "1234567890",
    title: "DatabaseError: connection pool exhausted",
    url: "https://acme.sentry.io/issues/1234567890/",
  });
  assert.deepEqual(event.attributes, {
    [INTEGRATION_TRIGGER_FILTER.PROJECT]: ["api"],
    [INTEGRATION_TRIGGER_FILTER.LEVEL]: ["fatal"],
  });
  for (const line of ["Events: 3", "Users: 2", "Short id: API-1Y", "Culprit: db.pool in acquire"]) {
    assert.ok(event.summary.split("\n").includes(line), line);
  }
});

it("a redelivery is the same run's key, and another delivery another's", () => {
  const text = fixture("issue-created");
  const [first] = sentryTriggerSource.normalize(delivery("issue", text, "req-1"));
  const [again] = sentryTriggerSource.normalize(delivery("issue", text, "req-1"));
  const [other] = sentryTriggerSource.normalize(delivery("issue", text, "req-2"));
  assert.equal(first?.dedupeKey, again?.dedupeKey);
  assert.notEqual(first?.dedupeKey, other?.dedupeKey);
});

it("a resource or action the source does not read, an install among them, is no event", () => {
  const resolved = fixture("issue-created").replace('"action": "created"', '"action": "resolved"');
  assert.deepEqual(sentryTriggerSource.normalize(delivery("issue", resolved)), []);
  assert.deepEqual(
    sentryTriggerSource.normalize(delivery("metric_alert", fixture("event-alert-triggered"))),
    [],
  );
  assert.deepEqual(
    sentryTriggerSource.normalize(delivery("installation", fixture("installation-deleted"))),
    [],
  );
  assert.deepEqual(sentryTriggerSource.normalize(delivery("issue", '{"action":"created"}')), []);
});

it("a summary stays within four kilobytes however long what Sentry sent", () => {
  const long = "x".repeat(2_000);
  const parsed = JSON.parse(fixture("event-alert-triggered"));
  Object.assign(parsed.data.event, {
    title: long,
    culprit: long,
    level: long,
    environment: long,
    release: long,
    datetime: long,
    web_url: `https://sentry.io/${long}`,
  });
  parsed.data.triggered_rule = long;
  const [event] = sentryTriggerSource.normalize(delivery("event_alert", JSON.stringify(parsed)));
  assert.ok(event);
  assert.ok(new TextEncoder().encode(event.summary).byteLength <= 4096);
  assert.ok(event.summary.endsWith("…"));
});
