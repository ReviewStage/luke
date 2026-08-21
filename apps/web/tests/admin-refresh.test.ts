import assert from "node:assert/strict";
import test from "node:test";
import { settleRead } from "../src/admin-refresh";

type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "missing" }
  | { status: "error"; detail: string }
  | { status: "ready"; answer: string; refreshFailure: string | undefined };

const shown: ScreenState = { status: "ready", answer: "first", refreshFailure: undefined };

test("a refresh that fails keeps the shown answer and rides the failure on it", () => {
  assert.deepEqual(settleRead<ScreenState>(shown, { status: "error", detail: "did not answer" }), {
    status: "ready",
    answer: "first",
    refreshFailure: "did not answer",
  });
});

test("a failure with nothing shown is the error card", () => {
  const failed: ScreenState = { status: "error", detail: "did not answer" };
  assert.deepEqual(settleRead<ScreenState>({ status: "loading" }, failed), failed);
  assert.deepEqual(settleRead<ScreenState>(failed, failed), failed);
});

test("the gate's outcomes replace the shown answer; stale data never hides them", () => {
  const refusals: ScreenState[] = [
    { status: "signed-out" },
    { status: "forbidden" },
    { status: "missing" },
  ];
  for (const refusal of refusals) {
    assert.deepEqual(settleRead<ScreenState>(shown, refusal), refusal);
  }
});

test("a fresh answer replaces the shown one and drops the earlier failure", () => {
  const failedOnce: ScreenState = { status: "ready", answer: "first", refreshFailure: "d" };
  const next: ScreenState = { status: "ready", answer: "second", refreshFailure: undefined };
  assert.deepEqual(settleRead<ScreenState>(failedOnce, next), next);
});
