import assert from "node:assert/strict";
import test from "node:test";
import type { SessionProviderAdapter } from "@sidecar/core";

export interface CloudAdapterContractOptions {
  readApiKey: () => Promise<string | undefined>;
  now: () => number;
  minimumRefreshIntervalMs: number;
  failRequests: () => boolean;
}

export interface CloudAdapterContractHarness {
  adapter: SessionProviderAdapter;
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
      readApiKey: async () => undefined,
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 0,
      failRequests: () => false,
    });

    assert.deepEqual(await harness.adapter.observe(), []);
    assert.equal(harness.requestCount(), 0);
  });

  test(`${providerName}: reports nothing when the credential cannot be read`, async () => {
    const harness = factory({
      readApiKey: async () => {
        throw new Error("settings are unreadable");
      },
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 0,
      failRequests: () => false,
    });

    assert.deepEqual(await harness.adapter.observe(), []);
    assert.equal(harness.requestCount(), 0);
  });

  test(`${providerName}: reuses the previous snapshot inside the minimum refresh interval`, async () => {
    let now = CONTRACT_TIME;
    const harness = factory({
      readApiKey: async () => INITIAL_API_KEY,
      now: () => now,
      minimumRefreshIntervalMs: 15_000,
      failRequests: () => false,
    });

    const first = await harness.adapter.observe();
    const requestsAfterFirstPass = harness.requestCount();
    now = CONTRACT_TIME + 5_000;
    const throttled = await harness.adapter.observe();
    const requestsAfterThrottledPass = harness.requestCount();
    now = CONTRACT_TIME + 20_000;
    const refreshed = await harness.adapter.observe();

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
      readApiKey: async () => apiKey,
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 60_000,
      failRequests: () => false,
    });

    await harness.adapter.observe();
    const requestsAfterFirstPass = harness.requestCount();
    apiKey = REPLACEMENT_API_KEY;
    const observations = await harness.adapter.observe();

    assert.ok(harness.requestCount() > requestsAfterFirstPass);
    assert.equal(observations.length, 1);
    assert.equal(harness.credentials().at(-1), REPLACEMENT_API_KEY);
  });

  test(`${providerName}: keeps the previous snapshot when the list request fails transiently`, async () => {
    let failRequests = false;
    const harness = factory({
      readApiKey: async () => INITIAL_API_KEY,
      now: () => CONTRACT_TIME,
      minimumRefreshIntervalMs: 0,
      failRequests: () => failRequests,
    });

    const observed = await harness.adapter.observe();
    failRequests = true;
    const duringOutage = await harness.adapter.observe();

    assert.equal(observed.length, 1);
    assert.deepEqual(duringOutage, observed);
  });
}
