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
    createEventId: () => {
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

test("a Clear retires the turns, the previews, and the generations that outlived it", () => {
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
  // A transcript for the retired turn cannot borrow the newer thread's place.
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

test("the developer's words draw live from the sentence's front, hold through the commit", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  // The live transcription model streams the sentence's front while the talk
  // key is still held — before the commit has named the turn's item. Refusing
  // those deltas would stream every spoken bubble from its back.
  subject.previewSpokenAsk("item-1", "how is");
  assert.deepEqual([...subject.previews.values()], ["how is"]);
  subject.closeTurn();
  subject.previewSpokenAsk("item-1", " the checkout");
  subject.commitTurn("item-1");
  subject.previewSpokenAsk("item-1", " agent doing?");

  assert.deepEqual([...subject.previews.values()], ["how is the checkout agent doing?"]);
});

test("words no turn could own draw nothing", () => {
  const { subject } = thread();
  subject.seed([]);
  // No press opened a turn, so these words are a straggler's — an item from
  // before a Clear, or another session's leak — and preview nothing.
  subject.previewSpokenAsk("item-1", "how is");
  assert.equal(subject.previews.size, 0);

  subject.openTurn();
  subject.previewSpokenAsk("item-2", "how is");
  subject.clear();
  // The Clear retired the held turn: its item's commit finds no mark and its
  // preview is already gone.
  assert.equal(subject.previews.size, 0);
  subject.commitTurn("item-2");
  assert.equal(subject.previews.size, 0);
});

test("a discarded turn takes its live words with it, sparing a turn already committed", () => {
  const { subject } = thread();
  subject.seed([]);
  // Turn one: spoken, released, commit sent; its transcription still streams.
  subject.openTurn();
  subject.previewSpokenAsk("item-1", "first ask");
  subject.closeTurn();
  // Turn two: spoken into and abandoned before any commit.
  subject.openTurn();
  subject.previewSpokenAsk("item-2", "never mind");

  subject.discardTurn();

  // Turn one's words are mid-flight to their `committed`; only the held
  // turn's words had no item coming.
  assert.deepEqual([...subject.previews.values()], ["first ask"]);
  subject.commitTurn("item-1");
  subject.rememberSpokenAsk("first ask", "item-1");
  assert.deepEqual(
    subject.entries.map((entry) => entry.words),
    ["first ask"],
  );
});

test("words whose first delta lands after the release survive the next press's discard", () => {
  const { subject } = thread();
  subject.seed([]);
  // Turn one is released before its transcription says a word: the first
  // delta arrives with only the commit in flight, so it can only be that
  // commit's — never the next held turn's to discard.
  subject.openTurn();
  subject.closeTurn();
  subject.previewSpokenAsk("item-1", "first ask");
  subject.openTurn();

  subject.discardTurn();

  assert.deepEqual([...subject.previews.values()], ["first ask"]);
  subject.commitTurn("item-1");
  subject.rememberSpokenAsk("first ask", "item-1");
  assert.deepEqual(
    subject.entries.map((entry) => entry.words),
    ["first ask"],
  );
});

test("a discarded turn's stragglers cannot outlive the turns in flight", () => {
  const { subject } = thread();
  subject.seed([]);
  // A discarded turn's cleared audio can still flush a delta while the next
  // turn's commit is out. No commit will ever name its item, so once every
  // turn in flight has settled, the words it drew must leave rather than
  // stream forever.
  subject.openTurn();
  subject.discardTurn();
  subject.openTurn();
  subject.closeTurn();
  subject.previewSpokenAsk("item-stray", "never mind");
  subject.previewSpokenAsk("item-2", "second ask");

  subject.commitTurn("item-2");

  assert.deepEqual([...subject.previews.values()], ["second ask"]);
});

test("a spoken turn is awaited from the press until its first words", () => {
  const { subject } = thread();
  subject.seed([]);
  assert.equal(subject.awaitingSpokenWords, false);
  subject.openTurn();
  assert.equal(subject.awaitingSpokenWords, true);
  // The first words settle the wait; the bubble now speaks for the turn.
  subject.previewSpokenAsk("item-1", "how is");
  assert.equal(subject.awaitingSpokenWords, false);
  subject.closeTurn();
  subject.commitTurn("item-1");
  assert.equal(subject.awaitingSpokenWords, false);
  subject.rememberSpokenAsk("how is the checkout agent", "item-1");
  assert.equal(subject.awaitingSpokenWords, false);
});

test("a silent turn is awaited through its commit and settles with its transcript", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  // No delta has arrived: the turn is committed and still owed its words.
  assert.equal(subject.awaitingSpokenWords, true);
  // Even an empty transcript ends the wait: nothing more is coming.
  subject.rememberSpokenAsk("  ", "item-1");
  assert.equal(subject.awaitingSpokenWords, false);
});

test("one turn streaming words does not hide a newer silent one", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  subject.previewSpokenAsk("item-1", "first ask");
  assert.equal(subject.awaitingSpokenWords, false);
  subject.openTurn();
  assert.equal(subject.awaitingSpokenWords, true);
});

test("a discarded turn and a failed transcription each end their wait", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  assert.equal(subject.awaitingSpokenWords, true);
  subject.discardTurn();
  assert.equal(subject.awaitingSpokenWords, false);

  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  assert.equal(subject.awaitingSpokenWords, true);
  // The service gave up: no words and no transcript are coming, so the mark
  // retires with the preview rather than standing as a turn still owed.
  subject.failTurn("item-1");
  assert.equal(subject.awaitingSpokenWords, false);
});

test("a call gone retires the turns it can never settle", () => {
  const { subject } = thread();
  subject.seed([]);
  // Two turns the dead call still owed: one committed and awaiting words, one
  // released with its commit in flight.
  subject.openTurn();
  subject.closeTurn();
  subject.commitTurn("item-1");
  subject.openTurn();
  subject.closeTurn();
  assert.equal(subject.awaitingSpokenWords, true);

  subject.callGone();

  // Nothing is owed by a channel nothing more arrives over — so a later
  // call going live cannot hold the wait up again on these leftovers.
  assert.equal(subject.awaitingSpokenWords, false);
  assert.equal(subject.previews.size, 0);
  // Its stragglers preview nothing, and its stale pending turn does not hand
  // its place to the next call's first commit.
  subject.previewSpokenAsk("item-1", "how is");
  assert.equal(subject.previews.size, 0);
  subject.commitTurn("item-2");
  assert.equal(subject.latestTurn, undefined);
});

test("a failed transcription takes its live words with it", () => {
  const { subject } = thread();
  subject.seed([]);
  subject.openTurn();
  subject.previewSpokenAsk("item-1", "how is");
  subject.closeTurn();
  subject.dropPreview("item-1");

  assert.equal(subject.previews.size, 0);
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
