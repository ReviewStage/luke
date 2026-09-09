import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import type { HistoryAppendOutcome } from "@sidecar/runtime/vocabulary";
import {
  ConversationThread,
  type ConversationThreadStore,
  MemoryHistoryStore,
} from "./conversation-thread.js";

const NOW = 1_800_000_000_000;

function line(words: string, recordedAt: number, eventId = words): ConversationEntry {
  return { kind: CONVERSATION_ENTRY_KIND.REPLY, words, recordedAt, eventId };
}

/** A store whose answers the test releases by hand, holding the thread as the database would. */
class HeldStore implements ConversationThreadStore {
  held: readonly ConversationEntry[] = [];
  pending: (() => void)[] = [];
  appendHistory(entries: readonly ConversationEntry[]) {
    const snapshot = [...this.held, ...entries];
    this.held = snapshot;
    return new Promise<HistoryAppendOutcome<ConversationEntry>>((resolve) => {
      this.pending.push(() => resolve({ changed: true, entries: snapshot }));
    });
  }
  erase(clearedAt: number) {
    this.held = this.held.filter((entry) => (entry.recordedAt ?? 0) > clearedAt);
  }
  release() {
    for (const answer of this.pending.splice(0)) answer();
  }
}

test("an append whose answer arrives after a Clear installs nothing, and the lines recorded after the Clear stand alone", async () => {
  const store = new HeldStore();
  const broadcasts: (readonly ConversationEntry[])[] = [];
  let clock = NOW;
  const thread = new ConversationThread({
    store,
    now: () => clock,
    onChanged: (entries) => broadcasts.push(entries),
  });
  const early = thread.append([line("OLD_WORDS", NOW)]);
  // The Clear lands while the store's answer is still out.
  clock = NOW + 10;
  thread.fence(clock);
  assert.deepEqual(thread.entries(), []);
  assert.deepEqual([...broadcasts], [[]]);
  store.erase(clock);
  // A line after the Clear is appended and answered before the old answer returns.
  clock = NOW + 20;
  const late = thread.append([line("NEW_WORDS", NOW + 20)]);
  store.release();
  assert.equal(await early, true);
  assert.equal(await late, true);
  assert.deepEqual(
    thread.entries().map((entry) => entry.words),
    ["NEW_WORDS"],
  );
  assert.equal(
    broadcasts.some((entries) => entries.some((entry) => entry.words === "OLD_WORDS")),
    false,
  );
  // A line dated before the Clear is settled by it and never reaches the store.
  assert.equal(await thread.append([line("STALE", NOW + 5, "stale")]), true);
  assert.equal(
    store.held.some((entry) => entry.words === "STALE"),
    false,
  );
});

test("a store that refuses answers false, and a run without a store keeps the thread in memory under the same rules", async () => {
  const refusing: ConversationThreadStore = {
    appendHistory: () => Promise.reject(new Error("worker gone")),
  };
  const reports: string[] = [];
  const stored = new ConversationThread({
    store: refusing,
    now: () => NOW,
    onChanged: () => undefined,
    report: (message) => reports.push(message),
  });
  assert.equal(await stored.append([line("x", NOW)]), false);
  assert.deepEqual(reports, ["Could not persist the conversation: worker gone"]);

  const broadcasts: (readonly ConversationEntry[])[] = [];
  const memory = new ConversationThread({
    store: new MemoryHistoryStore(),
    now: () => NOW,
    onChanged: (e) => broadcasts.push(e),
  });
  assert.equal(await memory.append([line("a", NOW - 2), line("b", NOW - 1)]), true);
  assert.equal(await memory.append([line("a", NOW - 2)]), true);
  assert.deepEqual(
    memory.entries().map((entry) => entry.words),
    ["a", "b"],
  );
  assert.equal(broadcasts.length, 1);
  memory.fence(NOW);
  assert.equal(await memory.append([line("a", NOW - 2)]), true);
  assert.deepEqual(memory.entries(), []);
});

test("after a Clear whose durable marker failed, an append's answer still cannot stand the old lines back up", async () => {
  const store = new HeldStore();
  const broadcasts: (readonly ConversationEntry[])[] = [];
  let clock = NOW;
  const thread = new ConversationThread({
    store,
    now: () => clock,
    onChanged: (entries) => broadcasts.push(entries),
  });
  const before = thread.append([line("OLD_WORDS", NOW)]);
  store.release();
  assert.equal(await before, true);
  assert.deepEqual(
    thread.entries().map((entry) => entry.words),
    ["OLD_WORDS"],
  );
  // The Clear fences here; the store's marker and erasure never land, so its
  // rows still hold the old line.
  clock = NOW + 10;
  thread.fence(clock);
  const sinceFence = broadcasts.length;
  clock = NOW + 20;
  const after = thread.append([line("NEW_WORDS", NOW + 20)]);
  store.release();
  assert.equal(await after, true);
  assert.deepEqual(
    store.held.map((entry) => entry.words),
    ["OLD_WORDS", "NEW_WORDS"],
  );
  assert.deepEqual(
    thread.entries().map((entry) => entry.words),
    ["NEW_WORDS"],
  );
  assert.deepEqual(
    broadcasts.slice(sinceFence).map((entries) => entries.map((entry) => entry.words)),
    [["NEW_WORDS"]],
  );
});
