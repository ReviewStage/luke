import assert from "node:assert/strict";
import test from "node:test";
import {
  announcementConversationEntry,
  type ConversationEntry,
  replyConversationEntry,
} from "@sidecar/session";
import {
  ConversationThread,
  conversationEntryBelongsToConversation,
  rebaseSpokenTurnMarks,
} from "./conversation-thread.js";

function thread(
  overrides: { append?: (entries: readonly ConversationEntry[]) => Promise<boolean> } = {},
) {
  const appended: (readonly ConversationEntry[])[] = [];
  const changes: number[] = [];
  let ids = 0;
  const subject = new ConversationThread({
    append: (entries) => {
      appended.push(entries);
      return overrides.append?.(entries) ?? Promise.resolve(true);
    },
    onChanged: () => changes.push(1),
    newEventId: () => {
      ids += 1;
      return `event-${ids}`;
    },
    // The retention clock is a timer this test never wants armed.
    schedule: () => 0,
    cancel: () => undefined,
  });
  return { subject, appended, changes };
}

test("work that began before Clear cannot repopulate conversation history", () => {
  assert.equal(conversationEntryBelongsToConversation(3, 4), false);
  assert.equal(conversationEntryBelongsToConversation(4, 4), true);
  assert.equal(conversationEntryBelongsToConversation(undefined, 4), false);
});

test("restore anchors pending speech behind the restored thread", () => {
  const restoredTail = { kind: "reply", words: "Earlier reply." } as const;
  const unanchored = { after: undefined };
  const anchored = { after: { kind: "reply", words: "Current reply." } as const };

  rebaseSpokenTurnMarks([unanchored, anchored], restoredTail);

  assert.equal(unanchored.after, restoredTail);
  assert.equal(anchored.after.words, "Current reply.");
});

test("the first call waits for durable conversation context", async () => {
  const { subject } = thread();
  let settled = false;
  const waiting = subject.waitForContext().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  subject.seed([]);
  await waiting;
  assert.equal(settled, true);
  // A wait taken after the context stands resolves without one.
  await subject.waitForContext();
});

test("nothing is reported to the store until the stored thread has been placed", async () => {
  const { subject, appended } = thread();
  // Before the restore this thread is only part of itself, and a report then
  // would name lines the store already holds as though they were new.
  subject.remember(replyConversationEntry("Before the restore."));
  assert.equal(appended.length, 0);
  subject.seed([]);
  await Promise.resolve();
  subject.remember(replyConversationEntry("After it."));
  await Promise.resolve();
  assert.deepEqual(
    appended.flat().map((entry) => entry.words),
    ["Before the restore.", "After it."],
  );
});

test("a line refused by the store is sent again on the next publish", async () => {
  let refuse = true;
  const { subject, appended } = thread({ append: () => Promise.resolve(!refuse) });
  subject.seed([]);
  subject.remember(replyConversationEntry("First."));
  await Promise.resolve();
  assert.deepEqual(
    appended.at(-1)?.map((entry) => entry.words),
    ["First."],
  );
  refuse = false;
  subject.remember(replyConversationEntry("Second."));
  await Promise.resolve();
  // The refusal left the first line owed, so both travel together.
  assert.deepEqual(
    appended.at(-1)?.map((entry) => entry.words),
    ["First.", "Second."],
  );
});

test("a Clear disposes the turns, the previews, and the generations that outlived it", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  subject.previewSpokenAsk("item-1", "how is");
  assert.equal(subject.previews.size, 1);
  subject.markAnnouncement();

  subject.clear();

  assert.equal(subject.generation, 1);
  assert.deepEqual(subject.entries, []);
  assert.equal(subject.previews.size, 0);
  assert.equal(subject.latestTurn, undefined);
  assert.equal(subject.takeAnnouncementGeneration(), undefined);
  // A transcript for the disposed turn cannot borrow the newer thread's place.
  subject.rememberSpokenAsk("how is the checkout agent", "item-1");
  assert.deepEqual(subject.entries, []);
});

test("a spoken ask lands where its turn happened, not where its transcript did", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  // The reply the ask opened comes back before the transcription does.
  subject.remember(announcementConversationEntry("Checkout is nearly done."));
  subject.rememberSpokenAsk("how is the checkout agent", "item-1");

  assert.deepEqual(
    subject.entries.map((entry) => entry.words),
    ["how is the checkout agent", "Checkout is nearly done."],
  );
});

test("a run accepted after the transcript is still tied to the words actually said", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  const mark = subject.latestTurn;
  subject.rememberSpokenAsk("how is the checkout agent", "item-1");
  subject.tieTurnToRun(mark, "run-7");

  assert.equal(subject.entries[0]?.requestId, "run-7");
});

test("the merged slice keeps a line of this window's that the store has not acknowledged", async () => {
  const { subject } = thread({ append: () => Promise.resolve(false) });
  subject.seed([]);
  subject.remember(replyConversationEntry("Mine, still out."));
  await Promise.resolve();
  subject.merge([{ ...replyConversationEntry("Another writer's."), eventId: "other" }]);

  assert.deepEqual(subject.entries.map((entry) => entry.words).sort(), [
    "Another writer's.",
    "Mine, still out.",
  ]);
});
