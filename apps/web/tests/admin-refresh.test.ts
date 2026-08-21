import assert from "node:assert/strict";
import test from "node:test";
import { settleRead } from "../src/admin-refresh";

type ScreenState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "missing" }
  | { status: "error"; detail: string }
  | { status: "ready"; answer: string; question: string; refreshFailure: string | undefined };

const QUESTION = {
  NARROW: "/api/things",
  WIDE: "/api/things?scope=all",
} as const;

const shown: ScreenState = {
  status: "ready",
  answer: "first",
  question: QUESTION.NARROW,
  refreshFailure: undefined,
};

test("a refresh that fails asking the same question keeps the shown answer and rides the failure on it", () => {
  assert.deepEqual(
    settleRead<ScreenState>(shown, { status: "error", detail: "did not answer" }, QUESTION.NARROW),
    {
      status: "ready",
      answer: "first",
      question: QUESTION.NARROW,
      refreshFailure: "did not answer",
    },
  );
});

test("a failure asking a different question replaces the answer, so a flipped scope cannot desync its control", () => {
  const failed: ScreenState = { status: "error", detail: "did not answer" };
  assert.deepEqual(settleRead<ScreenState>(shown, failed, QUESTION.WIDE), failed);
});

test("a failure with nothing shown is the error card", () => {
  const failed: ScreenState = { status: "error", detail: "did not answer" };
  assert.deepEqual(settleRead<ScreenState>({ status: "loading" }, failed, QUESTION.NARROW), failed);
  assert.deepEqual(settleRead<ScreenState>(failed, failed, QUESTION.NARROW), failed);
});

test("the gate's outcomes replace the shown answer whatever was asked; stale data never hides them", () => {
  const refusals: ScreenState[] = [
    { status: "signed-out" },
    { status: "forbidden" },
    { status: "missing" },
  ];
  for (const refusal of refusals) {
    assert.deepEqual(settleRead<ScreenState>(shown, refusal, QUESTION.NARROW), refusal);
    assert.deepEqual(settleRead<ScreenState>(shown, refusal, QUESTION.WIDE), refusal);
  }
});

test("a fresh answer replaces the shown one and drops the earlier failure", () => {
  const failedOnce: ScreenState = {
    status: "ready",
    answer: "first",
    question: QUESTION.NARROW,
    refreshFailure: "d",
  };
  const next: ScreenState = {
    status: "ready",
    answer: "second",
    question: QUESTION.WIDE,
    refreshFailure: undefined,
  };
  assert.deepEqual(settleRead<ScreenState>(failedOnce, next, QUESTION.WIDE), next);
});
