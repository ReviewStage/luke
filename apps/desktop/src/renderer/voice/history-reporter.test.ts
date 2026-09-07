import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import { HistoryReporter } from "./history-reporter";

const NOW = 1_800_000_000_000;

function line(words: string, eventId = words, requestId?: string): ConversationEntry {
  return {
    kind: CONVERSATION_ENTRY_KIND.SPOKEN_ASK,
    words,
    recordedAt: NOW,
    eventId,
    ...(requestId !== undefined ? { requestId } : undefined),
  };
}

test("a line is reported only once the store acknowledged it, and a refused line is sent again next time", () => {
  const reporter = new HistoryReporter();
  const first = reporter.take([line("a"), line("b")]);
  assert.deepEqual(
    first.entries.map((e) => e.words),
    ["a", "b"],
  );
  // While the answer is out the same lines are not sent twice.
  assert.deepEqual(reporter.take([line("a"), line("b")]).entries, []);
  reporter.settle(first, false);
  const retry = reporter.take([line("a"), line("b"), line("c")]);
  assert.deepEqual(
    retry.entries.map((e) => e.words),
    ["a", "b", "c"],
  );
  reporter.settle(retry, true);
  assert.deepEqual(reporter.take([line("a"), line("b"), line("c")]).entries, []);
  // A line that learns its run is owed once more; a draft without a clock never is.
  const tied = reporter.take([
    line("a", "a", "run-1"),
    { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "draft" },
  ]);
  assert.deepEqual(
    tied.entries.map((e) => e.requestId),
    ["run-1"],
  );
  reporter.settle(tied, true);
  assert.deepEqual(reporter.take([line("a", "a", "run-1")]).entries, []);
});

test("an acknowledgement that lands after a Clear marks nothing in the next lifetime, and relayed lines are never re-sent", () => {
  const reporter = new HistoryReporter();
  const sent = reporter.take([line("OLD")]);
  reporter.reset();
  reporter.settle(sent, true);
  // The old line's id is unknown to the new lifetime: were it to reappear it would be sent.
  assert.deepEqual(
    reporter.take([line("OLD")]).entries.map((e) => e.words),
    ["OLD"],
  );
  reporter.adopt([line("relayed", "r1")]);
  assert.deepEqual(reporter.take([line("relayed", "r1")]).entries, []);
});
