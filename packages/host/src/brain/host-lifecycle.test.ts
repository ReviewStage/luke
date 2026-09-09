import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
} from "@sidecar/brain";
import { brainReplyWords } from "@sidecar/brain/requests";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import {
  answered,
  answerOf,
  brainHarness,
  heldModel,
  BRAIN_HARNESS_NOW as NOW,
} from "../testing/index.js";

test("removing the capability under five outstanding runs leaves every run interrupted, published, and marked", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await c.submitMany(5);
  await drainMicrotasks();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK).length, 5);

  await c.host.replace(() => undefined);
  await drainMicrotasks();
  assert.equal(c.host.current(), undefined);
  const stored = c.repository.state;
  assert.equal(stored?.requests.length, 5);
  for (const runId of runIds) {
    const kept: BrainRequestRecord | undefined = stored?.requests.find(
      (entry) => entry.runId === runId,
    );
    assert.equal(kept?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.ok(kept?.historyRecordedAt !== undefined, `${runId} marked`);
    assert.ok(kept?.askRecordedAt !== undefined);
    assert.equal(
      c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId)
        .length,
      1,
      `${runId} has one reply line`,
    );
  }
  assert.deepEqual(c.broadcasts.at(-1), []);
  // The old agent's late model answer changes nothing anyone can see.
  client.release(
    answerOf({
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "late" }] },
      ],
    }),
  );
  await drainMicrotasks();
  assert.equal(c.thread().filter((e) => e.words === "late").length, 0);
  assert.equal(
    c.repository.state?.requests.every((r) => r.status === BRAIN_REQUEST_STATUS.INTERRUPTED),
    true,
  );
});

test("a successor replacing the agent under outstanding runs inherits a thread with every end written, and owns the store alone", async () => {
  const c = brainHarness();
  const first = heldModel();
  await c.host.replace(() => c.build(first));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await c.submitMany(5);
  // An earlier publication is held: the thread refuses until the handoff.
  c.refuse(true);
  await drainMicrotasks();
  c.refuse(false);
  const second = heldModel();
  await c.host.replace(() => c.build(second));
  await drainMicrotasks();
  const successor = c.host.current();
  assert.ok(successor && successor !== agent);
  for (const runId of runIds) {
    assert.equal(successor.request(runId)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.equal(
      c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId)
        .length,
      1,
    );
  }
  // The successor's own run proceeds and is the only writer.
  const result = await c.submit({
    submissionId: "fresh",
    question: "new ask",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(result.outcome, "accepted");
  // The host reaches its first inference only after the run's own
  // bookkeeping; the answer is released once the model has been asked.
  await drainMicrotasks();
  second.release(
    answerOf({
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      ],
    }),
  );
  await drainMicrotasks();
  const fresh = c.repository.state?.requests.find((r) => r.question === "new ask");
  assert.equal(fresh?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(c.thread().at(-1)?.words, "done");
  // The retired agent takes nothing more and writes nothing more: its store
  // lease passed to the successor with the handoff.
  assert.equal(
    (
      await agent.submitAsk({
        submissionId: "stale",
        question: "old ask",
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      })
    ).outcome,
    "rejected",
  );
  assert.equal(c.store.holdsLease(agent.lease), false);
  assert.equal(c.store.holdsLease(successor.lease), true);
});

test("a reset under outstanding runs discards them without publishing, and the successor starts clean", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  await c.submitMany(3);
  await drainMicrotasks();
  assert.equal(await c.store.clear(), true);
  await drainMicrotasks();
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 0);
  // The file holds the empty successor and the marker of the erasure alone.
  const stored = c.repository.state;
  assert.equal(stored?.requests.length, 0);
  assert.equal(stored?.reset?.generationId, "gen-1");
  await c.host.replace(() => undefined);
  await drainMicrotasks();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 0);
});

test("a run ending long after its wait is offered once, to a ready receiver, only after its line and mark landed", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const [runId] = await c.submitMany(1);
  assert.ok(runId);
  // The wait comes back pending — the ask outlived its thirty seconds — and
  // the developer's call is released with no grant. Nothing is owed yet.
  const waited = await c.waitOnCall(runId, epoch);
  assert.equal(waited.record?.status, BRAIN_REQUEST_STATUS.RUNNING);
  assert.equal(waited.speak, false);
  // The receiver goes away: the model answers, the end is written and
  // marked, and the reply waits for a receiver rather than landing on none.
  c.receiver.reset();
  client.release(answered("Two agents are waiting."));
  await drainMicrotasks();
  assert.equal(c.replies(runId).length, 1);
  assert.equal(c.unclaimed().length, 1);
  assert.equal(c.offers.length, 0);
  // Readiness flushes it, exactly once, under the epoch that reported.
  const next = c.receiver.begin();
  assert.equal(c.receiver.markReady(next), true);
  assert.equal(c.offers.length, 1);
  const offer = c.offers[0];
  assert.ok(offer);
  assert.equal(offer.epoch, next);
  assert.deepEqual(c.claim(offer), {
    granted: true,
    words: "Two agents are waiting.",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(c.replies(runId)[0]?.words, "Two agents are waiting.");
  // A duplicate claim, a repeated readiness, and a later report add nothing.
  assert.deepEqual(c.claim(offer), { granted: false });
  c.receiver.markReady(next);
  await drainMicrotasks();
  assert.equal(c.offers.length, 1);
  assert.equal(c.replies(runId).length, 1);
});

test("a refused History write keeps the reply unoffered and ungranted until the write recovers, then it is offered once", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const spoken = await c.submit({
    submissionId: "spoken-1",
    question: "how are they?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(spoken.outcome, "accepted");
  if (spoken.outcome !== "accepted") return;
  await drainMicrotasks();
  c.refuse(true);
  client.release(answered("Done."));
  await drainMicrotasks();
  // Ended, but the thread refused the line: unmarked, not offered, and the
  // asking call is not granted the words either — nothing is said before
  // History holds it.
  assert.equal(agent.request(spoken.runId)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(agent.request(spoken.runId)?.historyRecordedAt, undefined);
  const waited = await c.waitOnCall(spoken.runId, epoch);
  assert.equal(waited.speak, false);
  assert.equal(c.offers.length, 0);
  // The thread recovers. A mark alone sends no report, so nothing happens
  // until the records next change — another ask accepted — and that report
  // writes the line, marks the run, and only then offers it, once.
  c.refuse(false);
  await drainMicrotasks();
  assert.equal(c.offers.length, 0);
  await c.submitMany(1);
  await drainMicrotasks();
  assert.equal(c.replies(spoken.runId).length, 1);
  assert.deepEqual(
    c.offers.map((offer) => offer.runId),
    [spoken.runId],
  );
  const offer = c.offers[0];
  assert.ok(offer);
  assert.deepEqual(c.claim(offer), {
    granted: true,
    words: "Done.",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  await c.host.replace(() => undefined);
});

test("two completions flushed together are offered one at a time, the second only after the first is acknowledged", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  // One ask at a time, so they are two runs with two completions: words that
  // reached a run under way would ride it and be answered in one.
  const [runA] = await c.submitMany(1);
  client.release(answered("Answer."));
  await drainMicrotasks();
  const [runB] = await c.submitMany(1, 1);
  assert.ok(runA && runB);
  client.release(answered("Answer."));
  await drainMicrotasks();
  // Both ended with no receiver; readiness offers the oldest alone.
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  assert.deepEqual(
    c.offers.map((offer) => offer.runId),
    [runA],
  );
  const offerA = c.offers[0];
  assert.ok(offerA);
  assert.equal(c.claim(offerA).granted, true);
  // Claimed and playing: B is still not offered, so it cannot cut A off.
  assert.equal(c.offers.length, 1);
  // A's reply ends; only now is B offered, and only once.
  assert.equal(c.acknowledge(offerA), true);
  assert.deepEqual(
    c.offers.map((offer) => offer.runId),
    [runA, runB],
  );
  assert.equal(c.acknowledge(offerA), false);
  assert.equal(c.offers.length, 2);
});

test("an offer the renderer never claimed is offered again to the next epoch; a claimed one is not, and old-epoch claims are refused", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const first = c.receiver.begin();
  c.receiver.markReady(first);
  const [runA] = await c.submitMany(1);
  client.release(answered("Answer."));
  await drainMicrotasks();
  const [runB] = await c.submitMany(1, 1);
  assert.ok(runA && runB);
  client.release(answered("Answer."));
  await drainMicrotasks();
  // A is offered and claimed; its renderer dies before the reply ends.
  const offerA = c.offers[0];
  assert.ok(offerA && offerA.runId === runA);
  assert.equal(c.claim(offerA).granted, true);
  c.receiver.reset();
  const second = c.receiver.begin();
  c.receiver.markReady(second);
  // A, possibly already heard, is never offered again; B is offered to the new epoch.
  const offerB = c.offers[1];
  assert.ok(offerB && offerB.runId === runB && offerB.epoch === second);
  // The new renderer dies with B unclaimed; the third is offered B again.
  c.receiver.reset();
  const third = c.receiver.begin();
  c.receiver.markReady(third);
  const again = c.offers[2];
  assert.ok(again && again.runId === runB && again.epoch === third);
  // A claim carrying the old epoch — a reloaded renderer's late invoke — is
  // refused even though the delivery ids match; the current epoch's is granted.
  assert.deepEqual(c.claim(offerB), { granted: false });
  assert.equal(c.claim(again).granted, true);
  assert.equal(c.replies(runA).length, 1);
  assert.equal(c.replies(runB).length, 1);
});

test("a Clear invalidates every delivery: an unclaimed offer is refused, a late acknowledgement is ignored, nothing is offered again", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const [runId] = await c.submitMany(1);
  assert.ok(runId);
  await drainMicrotasks();
  client.release(answered("Before the clear."));
  await drainMicrotasks();
  assert.equal(c.offers.length, 1);
  const offer = c.offers[0];
  assert.ok(offer);
  // The Clear fences synchronously; the renderer's claim lands after it.
  const cleared = c.store.clear(NOW + 5);
  assert.deepEqual(c.claim(offer), { granted: false });
  assert.deepEqual(c.unclaimed(), []);
  await cleared;
  await drainMicrotasks();
  assert.equal(c.acknowledge(offer), false);
  // A new renderer reporting ready is offered nothing of the erased generation.
  c.receiver.reset();
  c.receiver.markReady(c.receiver.begin());
  assert.equal(c.offers.length, 1);
});

test("a launch that finds ended runs restores their words and speaks none of them", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  await c.submitMany(2);
  await c.host.replace(() => undefined);
  await drainMicrotasks();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 2);
  // The next launch: a fresh delivery owner, a fresh receiver, the same file.
  const next = brainHarness();
  const carried = c.repository.state;
  assert.ok(carried);
  assert.equal(await next.repository.save(carried), true);
  next.receiver.markReady(next.receiver.begin());
  await next.host.replace(() => next.build(heldModel()));
  await drainMicrotasks();
  assert.equal(next.host.current()?.requests().length, 2);
  assert.equal(next.offers.length, 0);
  assert.deepEqual(next.thread(), []);
  for (const record of next.host.current()?.requests() ?? []) {
    assert.equal(record.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.ok(record.historyRecordedAt !== undefined);
    assert.equal(brainReplyWords(record), "That ask was interrupted before I could finish it.");
  }
});

test("a spoken ask's end is authorized exactly once across the call that asked and the offer path, whichever comes first", async () => {
  // Publication before the wait: the run ended, was written, marked, and
  // offered before the asking call's wait ever reached main.
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const spoken = await c.submit({
    submissionId: "spoken-1",
    question: "how are they?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(spoken.outcome, "accepted");
  if (spoken.outcome !== "accepted") return;
  await drainMicrotasks();
  client.release(answered("Both are waiting."));
  await drainMicrotasks();
  assert.equal(c.offers.length, 1);
  const offer = c.offers[0];
  assert.ok(offer);
  // The wait arrives now, under the current epoch: the call is granted the
  // words, and the offer already out is withdrawn — its claim is refused.
  const waited = await c.waitOnCall(spoken.runId, epoch);
  assert.equal(waited.speak, true);
  assert.deepEqual(c.claim(offer), { granted: false });
  assert.equal(c.unclaimed().length, 0);
  assert.equal(c.replies(spoken.runId).length, 1);

  // The reverse order: the offer is claimed first, and the wait is refused.
  const second = await c.submit({
    submissionId: "spoken-2",
    question: "and now?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(second.outcome, "accepted");
  if (second.outcome !== "accepted") return;
  await drainMicrotasks();
  client.release(answered("Still waiting."));
  await drainMicrotasks();
  const secondOffer = c.offers[1];
  assert.ok(secondOffer && secondOffer.runId === second.runId);
  assert.equal(c.claim(secondOffer).granted, true);
  const lateWait = await c.waitOnCall(second.runId, epoch);
  assert.equal(lateWait.record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(lateWait.speak, false);

  // An abandoned wait from a reloaded renderer names a stale epoch: refused,
  // and the run stays deliverable to the renderer that stands.
  const third = await c.submit({
    submissionId: "spoken-3",
    question: "later?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(third.outcome, "accepted");
  if (third.outcome !== "accepted") return;
  c.acknowledge(secondOffer);
  await drainMicrotasks();
  client.release(answered("Later."));
  await drainMicrotasks();
  const staleWait = await c.waitOnCall(third.runId, epoch - 1);
  assert.equal(staleWait.speak, false);
  const thirdOffer = c.offers[2];
  assert.ok(thirdOffer);
  assert.equal(thirdOffer.runId, third.runId);
  assert.equal(c.claim(thirdOffer).granted, true);
  await c.host.replace(() => undefined);
});

test("an on-call grant that takes the offered run out of the receiver's hand offers the next owed reply at once", async () => {
  const c = brainHarness();
  const client = heldModel();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  // A is spoken, B is typed; both end while the renderer is busy, so neither
  // is claimed. B is submitted once A has ended, so it is a run of its own
  // rather than an ask steered into A's turn.
  const spoken = await c.submit({
    submissionId: "spoken-a",
    question: "how are they?",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(spoken.outcome, "accepted");
  if (spoken.outcome !== "accepted") return;
  await drainMicrotasks();
  client.release(answered("A."));
  await drainMicrotasks();
  const [typed] = await c.submitMany(1);
  assert.ok(typed);
  await drainMicrotasks();
  client.release(answered("B."));
  await drainMicrotasks();
  assert.deepEqual(
    c.offers.map((offer) => offer.runId),
    [spoken.runId],
  );
  const offerA = c.offers[0];
  assert.ok(offerA);
  // A's own call comes back from its wait and is granted the words; with no
  // third event, B's offer follows at once, and A's old offer is dead.
  const waited = await c.waitOnCall(spoken.runId, epoch);
  assert.equal(waited.speak, true);
  assert.deepEqual(
    c.offers.map((offer) => offer.runId),
    [spoken.runId, typed],
  );
  assert.deepEqual(c.claim(offerA), { granted: false });
  const offerB = c.offers[1];
  assert.ok(offerB);
  assert.equal(c.claim(offerB).granted, true);
  await c.host.replace(() => undefined);
});
