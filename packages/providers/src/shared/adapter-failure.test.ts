import assert from "node:assert/strict";
import test from "node:test";
import { ADAPTER_FAILURE, AdapterFailure, clearsObservedState } from "./adapter-failure.js";

test("a rejected credential and nothing to observe with both clear observed state", () => {
  assert.equal(clearsObservedState(ADAPTER_FAILURE.UNAUTHORIZED), true);
  assert.equal(clearsObservedState(ADAPTER_FAILURE.UNAVAILABLE), true);
});

test("a failure that says nothing about the credential leaves the snapshot standing", () => {
  assert.equal(clearsObservedState(ADAPTER_FAILURE.TRANSIENT), false);
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
  ]);
});

test("a failure carries its kind and stays an error", () => {
  const failure = new AdapterFailure(ADAPTER_FAILURE.TRANSIENT, "the provider did not answer");
  assert.ok(failure instanceof Error);
  assert.equal(failure.name, "AdapterFailure");
  assert.equal(failure.failure, ADAPTER_FAILURE.TRANSIENT);
  assert.equal(failure.message, "the provider did not answer");
});
