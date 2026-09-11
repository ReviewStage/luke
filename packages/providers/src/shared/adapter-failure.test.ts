import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ADAPTER_FAILURE,
  AdapterFailure,
  clearsObservedState,
  endsPass,
  tolerateItemFailure,
} from "./adapter-failure.js";

test("a rejected credential and nothing to observe with both clear observed state", () => {
  assert.equal(clearsObservedState(ADAPTER_FAILURE.UNAUTHORIZED), true);
  assert.equal(clearsObservedState(ADAPTER_FAILURE.UNAVAILABLE), true);
});

test("a failure that says nothing about the credential leaves the snapshot standing", () => {
  assert.equal(clearsObservedState(ADAPTER_FAILURE.TRANSIENT), false);
  assert.equal(clearsObservedState(ADAPTER_FAILURE.RATE_LIMITED), false);
});

test("a rate limit ends the pass without clearing it, and one resource's transient failure is tolerated alone", async () => {
  assert.equal(endsPass(ADAPTER_FAILURE.RATE_LIMITED), true);
  assert.equal(endsPass(ADAPTER_FAILURE.TRANSIENT), false);
  assert.equal(
    await tolerateItemFailure(async () => {
      throw new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, "one status read failed");
    }),
    undefined,
  );
  const rateLimited = new AdapterFailure(
    ADAPTER_FAILURE.RATE_LIMITED,
    "the provider is rate limiting",
  );
  await assert.rejects(
    tolerateItemFailure(async () => {
      throw rateLimited;
    }),
    rateLimited,
  );
});

test("every failure kind has an answer, so a new one cannot arrive undecided", () => {
  const answers = Object.values(ADAPTER_FAILURE).map((failure) => [
    failure,
    clearsObservedState(failure),
  ]);
  assert.deepEqual(answers, [
    [ADAPTER_FAILURE.UNAUTHORIZED, true],
    [ADAPTER_FAILURE.UNAVAILABLE, true],
    [ADAPTER_FAILURE.TRANSIENT, false],
    [ADAPTER_FAILURE.RATE_LIMITED, false],
  ]);
});

test("a failure carries its kind and stays an error", () => {
  const failure = new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, "the provider did not answer");
  assert.ok(failure instanceof Error);
  assert.equal(failure.name, "AdapterFailure");
  assert.equal(failure.failure, ADAPTER_FAILURE.TRANSIENT);
  assert.equal(failure.message, "the provider did not answer");
});
