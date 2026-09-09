import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptConversationThread,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/session";
import { ConversationReporter, withPendingLines } from "./conversation-reporter.js";

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
  const reporter = new ConversationReporter();
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
  const reporter = new ConversationReporter();
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

test("a relay that lands while a spoken ask's append is out keeps the ask, as the same object, until the store acknowledges it", () => {
  const reporter = new ConversationReporter();
  const spoken = line("ship it", "spoken-1");
  const taken = reporter.take([spoken]);
  // The main process's own line landed first: its relay does not hold the ask,
  // and adopting it alone would drop the ask from this window for good.
  const relay = [{ ...line("typed elsewhere", "typed-1"), recordedAt: NOW + 1 }];
  assert.deepEqual(adoptConversationThread([spoken], relay), relay);
  const merged = withPendingLines(adoptConversationThread([spoken], relay), [spoken], (entry) =>
    reporter.pending(entry),
  );
  assert.deepEqual(
    merged.map((entry) => entry.eventId),
    ["spoken-1", "typed-1"],
  );
  assert.equal(merged[0], spoken);
  // Once the store acknowledged the ask, a relay is authoritative: a line it
  // no longer holds is gone here too.
  reporter.settle(taken, true);
  assert.deepEqual(
    withPendingLines(relay, [spoken], (entry) => reporter.pending(entry)),
    relay,
  );
  // A relay that does hold the ask replaces nothing and adds nothing.
  const both = [spoken, ...relay];
  assert.deepEqual(
    withPendingLines(both, [spoken], (entry) => reporter.pending(entry)),
    both,
  );
});

test("pending lines land in recorded order among the relayed ones, and a refused line stays pending for the retry", () => {
  const reporter = new ConversationReporter();
  const early = { ...line("early", "e"), recordedAt: NOW - 10 };
  const late = { ...line("late", "l"), recordedAt: NOW + 10 };
  const taken = reporter.take([early, late]);
  reporter.settle(taken, false);
  const relay = [{ ...line("middle", "m"), recordedAt: NOW }];
  assert.deepEqual(
    withPendingLines(relay, [early, late], (entry) => reporter.pending(entry)).map(
      (e) => e.eventId,
    ),
    ["e", "m", "l"],
  );
});

test("pending append, then the run tie, then a relay, then the ack: the run reaches the store next and the line object survives", () => {
  const reporter = new ConversationReporter();
  const spoken = line("ship it", "spoken-1");
  const taken = reporter.take([spoken]);
  // The brain accepts the ask while the append is out: the line learns its run locally.
  const tied = { ...spoken, requestId: "run-1" };
  let thread: readonly ConversationEntry[] = [tied];
  // Nothing is sent again while the first append is still unanswered.
  assert.deepEqual(reporter.take(thread).entries, []);
  // A relay without the ask keeps the tied line, as the same object.
  const relay = [{ ...line("typed elsewhere", "typed-1"), recordedAt: NOW + 1 }];
  reporter.adopt(relay);
  thread = withPendingLines(adoptConversationThread(thread, relay), thread, (entry) =>
    reporter.pending(entry),
  );
  assert.equal(thread[0], tied);
  // The ack of the untied append settles it; the run is now owed, and the next take carries it.
  reporter.settle(taken, true);
  const owed = reporter.take(thread);
  assert.deepEqual(
    owed.entries.map((entry) => [entry.eventId, entry.requestId]),
    [["spoken-1", "run-1"]],
  );
  reporter.settle(owed, true);
  assert.deepEqual(reporter.take(thread).entries, []);
  // A relay carrying the line untied does not lower what this window knows.
  const lowered = adoptConversationThread(thread, [spoken, ...relay]);
  assert.equal(lowered[0]?.requestId, "run-1");
});

test("a Clear discards pending state even when an old ack or relay merge arrives afterwards", () => {
  const reporter = new ConversationReporter();
  const spoken = line("before the clear", "old");
  const taken = reporter.take([spoken]);
  reporter.reset();
  const thread: readonly ConversationEntry[] = [];
  reporter.settle(taken, true);
  assert.deepEqual(
    withPendingLines([], thread, (entry) => reporter.pending(entry)),
    [],
  );
  assert.deepEqual(reporter.take(thread).entries, []);
});
