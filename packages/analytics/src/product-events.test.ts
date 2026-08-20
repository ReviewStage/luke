import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_EVENT,
  PRODUCT_EVENT_BATCH_LIMIT,
  PRODUCT_EVENT_PROPERTIES,
  PRODUCT_EVENT_PROPERTY,
  PRODUCT_EVENT_PROPERTY_VALUES,
  PRODUCT_SESSION_COUNT_BUCKET,
  type ProductEventName,
  type ProductEventProperty,
  productEventBatchFromWire,
  productEventFromWire,
  productSessionCountBucket,
} from "@sidecar/analytics";
import type { WireRecord } from "@sidecar/wire";

const AT = Date.parse("2026-08-19T12:00:00.000Z");

const EVENT_NAMES = Object.values(PRODUCT_EVENT);

/** A value every property will accept, for building a legal event of any name. */
const SAMPLE_VALUE = {
  [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0",
  [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: PRODUCT_SESSION_COUNT_BUCKET.FEW,
  [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: "conductor",
  [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: "codex",
  [PRODUCT_EVENT_PROPERTY.TRACKER_ID]: "linear",
  [PRODUCT_EVENT_PROPERTY.SESSION_STATUS]: "waiting",
  [PRODUCT_EVENT_PROPERTY.CREDENTIAL_SOURCE]: "account",
  [PRODUCT_EVENT_PROPERTY.SESSION_ACT]: "message_send",
  [PRODUCT_EVENT_PROPERTY.ISSUE_ACT]: "comment_add",
  [PRODUCT_EVENT_PROPERTY.SETTING_ID]: "voice_captions",
  [PRODUCT_EVENT_PROPERTY.SETTING_VALUE]: "on",
} satisfies Record<ProductEventProperty, string | number>;

function legalEvent(name: ProductEventName): WireRecord {
  const properties: Record<string, string | number> = {};
  for (const property of PRODUCT_EVENT_PROPERTIES[name]) {
    properties[property] = SAMPLE_VALUE[property];
  }
  return { name, at: AT, properties };
}

test("every event name has an allowlist, and every listed property has a value set", () => {
  for (const name of EVENT_NAMES) {
    assert.ok(
      Object.hasOwn(PRODUCT_EVENT_PROPERTIES, name),
      `${name} carries no property allowlist`,
    );
    for (const property of PRODUCT_EVENT_PROPERTIES[name]) {
      assert.ok(
        Object.values(PRODUCT_EVENT_PROPERTY).includes(property),
        `${name} lists an unknown property ${property}`,
      );
    }
  }
});

test("every event round-trips through the reader unchanged", () => {
  for (const name of EVENT_NAMES) {
    const wire = legalEvent(name);
    assert.deepEqual(productEventFromWire(wire), {
      name,
      at: AT,
      properties: wire.properties,
    });
  }
});

test("a property valid for another event is dropped from this one", () => {
  const event = productEventFromWire({
    name: PRODUCT_EVENT.ACCOUNT_SIGN_IN,
    at: AT,
    properties: { [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: "codex" },
  });
  assert.deepEqual(event, {
    name: PRODUCT_EVENT.ACCOUNT_SIGN_IN,
    at: AT,
    properties: {},
  });
});

test("a value outside its own set discards the event", () => {
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.PROVIDER_CONNECT,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.CONNECTION_ID]: "not-a-provider" },
    }),
    undefined,
  );
  assert.equal(productEventFromWire({ name: "app:sneak", at: AT, properties: {} }), undefined);
  assert.equal(productEventFromWire({ name: PRODUCT_EVENT.APP_LAUNCH, at: AT }), undefined);
});

test("prose cannot pass as a property value", () => {
  const prose = "codex — /Users/me/luke on feature/x";
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.SESSION_OBSERVE,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: prose,
        [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: 1,
      },
    }),
    undefined,
  );
  // A version reader is not a string reader: a path is not `x.y.z`.
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.APP_LAUNCH,
      at: AT,
      properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "/Users/me/luke" },
    }),
    undefined,
  );
});

test("a raw count is refused; only a rung of the ladder travels", () => {
  assert.equal(
    productEventFromWire({
      name: PRODUCT_EVENT.SESSION_OBSERVE,
      at: AT,
      properties: {
        [PRODUCT_EVENT_PROPERTY.PROVIDER_ID]: "codex",
        [PRODUCT_EVENT_PROPERTY.SESSION_COUNT]: 137,
      },
    }),
    undefined,
  );
  assert.equal(productSessionCountBucket(137), PRODUCT_SESSION_COUNT_BUCKET.CROWD);
  assert.equal(productSessionCountBucket(0), PRODUCT_SESSION_COUNT_BUCKET.NONE);
  assert.equal(productSessionCountBucket(1), PRODUCT_SESSION_COUNT_BUCKET.ONE);
  assert.equal(productSessionCountBucket(4), PRODUCT_SESSION_COUNT_BUCKET.FEW);
  assert.equal(productSessionCountBucket(5), PRODUCT_SESSION_COUNT_BUCKET.SEVERAL);
  assert.equal(productSessionCountBucket(24), PRODUCT_SESSION_COUNT_BUCKET.MANY);
  assert.equal(productSessionCountBucket(-3), PRODUCT_SESSION_COUNT_BUCKET.NONE);
  assert.equal(productSessionCountBucket(Number.NaN), PRODUCT_SESSION_COUNT_BUCKET.NONE);
});

test("nothing on the envelope survives except what the allowlist names", () => {
  const event = productEventFromWire({
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: AT,
    distinct_id: "someone-else",
    $ip: "203.0.113.7",
    email: "someone@example.test",
    properties: {
      [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0",
      distinct_id: "someone-else",
      $set: { email: "someone@example.test" },
      $ip: "203.0.113.7",
    },
  });
  assert.deepEqual(event, {
    name: PRODUCT_EVENT.APP_LAUNCH,
    at: AT,
    properties: { [PRODUCT_EVENT_PROPERTY.APP_VERSION]: "0.2.0" },
  });
});

test("one bad event refuses the whole batch, and so does an oversized one", () => {
  const good = legalEvent(PRODUCT_EVENT.APP_LAUNCH);
  assert.equal(productEventBatchFromWire({ events: [good, good] })?.length, 2);
  assert.equal(
    productEventBatchFromWire({ events: [good, { name: "app:sneak", at: AT, properties: {} }] }),
    undefined,
  );
  assert.equal(
    productEventBatchFromWire({
      events: Array.from({ length: PRODUCT_EVENT_BATCH_LIMIT + 1 }, () => good),
    }),
    undefined,
  );
  assert.equal(productEventBatchFromWire({ events: [] }), undefined);
  assert.equal(productEventBatchFromWire({ events: "many" }), undefined);
  assert.equal(productEventBatchFromWire([good]), undefined);
});

/**
 * The structural half of the promise: walk the whole vocabulary and assert
 * every value it can ever hold is a token rather than prose. A property that
 * could carry a title, a path, or a sentence fails here.
 */
test("no value the vocabulary can express is free text", () => {
  const token = /^[a-z0-9_.:-]+$/;
  for (const name of EVENT_NAMES) {
    assert.match(name, token, `event name ${name} is not a token`);
    for (const property of PRODUCT_EVENT_PROPERTIES[name]) {
      assert.match(property, token, `property ${property} is not a token`);
      if (property === PRODUCT_EVENT_PROPERTY.SESSION_COUNT) {
        // A rung is a number rather than a token, which is the one exception
        // the pattern below cannot express.
        for (const rung of Object.values(PRODUCT_SESSION_COUNT_BUCKET)) {
          assert.ok(Number.isInteger(rung), `${rung} is not a bucket rung`);
        }
        continue;
      }
      if (property === PRODUCT_EVENT_PROPERTY.APP_VERSION) {
        assert.match("0.2.0", /^\d+\.\d+\.\d+$/);
        continue;
      }
      for (const value of PRODUCT_EVENT_PROPERTY_VALUES[property]) {
        assert.match(value, token, `${property} may hold non-token ${value}`);
      }
    }
  }
});
