import assert from "node:assert/strict";
import test from "node:test";
import type { SessionProviderAdapter } from "@sidecar/core";
import { Effect } from "effect";
import type { Http } from "../../src/services/http";
import { runHttpEffect } from "./run-effect";

export interface CloudAdapterContractOptions {
  readApiKey: () => Effect.Effect<string | undefined, unknown, Http>;
  now: () => number;
  minimumRefreshIntervalMs: number;
  failRequests: () => boolean;
}

export interface CloudAdapterContractHarness {
  adapter: SessionProviderAdapter;
  fetch: typeof globalThis.fetch;
  requestCount: () => number;
  credentials: () => readonly string[];
}

export type CloudAdapterContractFactory = (
  options: CloudAdapterContractOptions,
) => CloudAdapterContractHarness;

const CONTRACT_TIME = Date.parse("2026-08-13T02:45:00.000Z");
const INITIAL_API_KEY = "contract-initial-key";
const REPLACEMENT_API_KEY = "contract-replacement-key";

export function describeCloudAdapterContract(
  providerName: string,
  factory: CloudAdapterContractFactory,
): void {
  test(`${providerName}: reports nothing and issues no request without an API key`, async () => {
    const harness = factory({
      readApiKey: () => Effect.succeed(undefined),
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 0,
      failRequests: () => false,
    });

    assert.deepEqual(await runHttpEffect(harness.adapter.observe(), harness.fetch), []);
    assert.equal(harness.requestCount(), 0);
  });

  test(`${providerName}: reports nothing when the credential cannot be read`, async () => {
    const harness = factory({
      readApiKey: () =>
        Effect.tryPromise({
          try: () => Promise.reject(new Error("settings are unreadable")),
          catch: (error) => error,
        }),
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 0,
      failRequests: () => false,
    });

    assert.deepEqual(await runHttpEffect(harness.adapter.observe(), harness.fetch), []);
    assert.equal(harness.requestCount(), 0);
  });

  test(`${providerName}: reuses the previous snapshot inside the minimum refresh interval`, async () => {
    let now = CONTRACT_TIME;
    const harness = factory({
      readApiKey: () => Effect.succeed(INITIAL_API_KEY),
      now: () => now,
      minimumRefreshIntervalMs: 15_000,
      failRequests: () => false,
    });

    const first = await runHttpEffect(harness.adapter.observe(), harness.fetch);
    const requestsAfterFirstPass = harness.requestCount();
    now = CONTRACT_TIME + 5_000;
    const throttled = await runHttpEffect(harness.adapter.observe(), harness.fetch);
    const requestsAfterThrottledPass = harness.requestCount();
    now = CONTRACT_TIME + 20_000;
    const refreshed = await runHttpEffect(harness.adapter.observe(), harness.fetch);

    assert.equal(first.length, 1);
    assert.deepEqual(throttled, first);
    assert.equal(
      requestsAfterThrottledPass,
      requestsAfterFirstPass,
      "throttled pass issued requests",
    );
    assert.ok(
      harness.requestCount() > requestsAfterThrottledPass,
      "refreshed pass issued no request",
    );
    assert.equal(refreshed.length, 1);
  });

  test(`${providerName}: observes again immediately after the API key changes`, async () => {
    let apiKey = INITIAL_API_KEY;
    const harness = factory({
      readApiKey: () => Effect.succeed(apiKey),
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 60_000,
      failRequests: () => false,
    });

    await runHttpEffect(harness.adapter.observe(), harness.fetch);
    const requestsAfterFirstPass = harness.requestCount();
    apiKey = REPLACEMENT_API_KEY;
    const observations = await runHttpEffect(harness.adapter.observe(), harness.fetch);

    assert.ok(harness.requestCount() > requestsAfterFirstPass);
    assert.equal(observations.length, 1);
    assert.equal(harness.credentials().at(-1), REPLACEMENT_API_KEY);
  });

  test(`${providerName}: keeps the previous snapshot when the list request fails transiently`, async () => {
    let failRequests = false;
    const harness = factory({
      readApiKey: () => Effect.succeed(INITIAL_API_KEY),
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 0,
      failRequests: () => failRequests,
    });

    const observed = await runHttpEffect(harness.adapter.observe(), harness.fetch);
    failRequests = true;
    const duringOutage = await runHttpEffect(harness.adapter.observe(), harness.fetch);

    assert.equal(observed.length, 1);
    assert.deepEqual(duringOutage, observed);
  });
}
