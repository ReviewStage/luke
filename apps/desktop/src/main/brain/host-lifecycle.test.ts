import assert from "node:assert/strict";
import test from "node:test";
import {
  type BareResponsesModel,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BrainAgent,
  type BrainRequestRecord,
  type BrainStateStorage,
  BrainStateStore,
  bareModelAdapter,
  brainStateFromStored,
  responsesModelAnswer,
  responsesToolLoopRuntime,
} from "@sidecar/brain";
import { isTerminalBrainRequestStatus } from "@sidecar/brain/requests";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/realtime";
import type { ModelResponse } from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import {
  type BrainReplyOffer,
  type BrainRequestSnapshot,
  brainReplyWords,
} from "#shared/wire/brain";
import { VoiceReceiver } from "../voice-receiver";
import { BrainHost } from "./host";
import { followBrainRequests, submitBrainAsk } from "./ipc";
import { BrainReplyDeliveries } from "./reply-delivery";

/**
 * The real agent, store, host, follower, and submission path composed as the
 * main process composes them, with only the model and the disk synthetic.
 */

const NOW = 1_800_000_000_000;

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  read() {
    return this.file;
  }
  write(contents: string) {
    this.file = contents;
    return true;
  }
}

/** A model that answers nothing until the test says so. */
function heldClient(): BareResponsesModel & { release: (answer: ModelResponse) => void } {
  const waiting: ((answer: ModelResponse) => void)[] = [];
  return {
    respond: () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      }),
    quietUntil: () => undefined,
    release: (answer) => {
      for (const resolve of waiting.splice(0)) resolve(answer);
    },
  };
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 30) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

function composed() {
  const storage = new MemoryStorage();
  let ids = 0;
  const store = new BrainStateStore({
    storage,
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  let thread: readonly ConversationEntry[] = [];
  let refuseWrites = false;
  const broadcasts: (readonly BrainRequestSnapshot[])[] = [];
  const record = (entry: ConversationEntry, at: number) => {
    if (refuseWrites) return false;
    thread = appendConversationThreadEntry(thread, entry, NOW + 1000, at);
    return true;
  };
  // The delivery owner and the receiver, composed as desktop-app composes
  // them: every report is observed before it is broadcast, every published
  // end is offered to a ready receiver, and readiness flushes what waited.
  const deliveries = new BrainReplyDeliveries({ nextDeliveryId: () => `delivery-${++ids}` });
  const receiver = new VoiceReceiver();
  const offers: BrainReplyOffer[] = [];
  const offerReplies = () => {
    if (!receiver.isReady()) return;
    const offer = deliveries.nextOffer(receiver.epoch());
    if (offer) offers.push(offer);
  };
  receiver.onReady(offerReplies);
  store.onReplaced(() => deliveries.reset());
  const host = new BrainHost({
    follow: (agent) =>
      followBrainRequests(agent, {
        recordConversationEntry: record,
        broadcastRequests: (snapshots) => {
          deliveries.observe(snapshots);
          broadcasts.push(snapshots);
        },
        onEndPublished: (ended) => {
          const generationId = store.generationId();
          if (generationId !== undefined) deliveries.published(ended, generationId);
          offerReplies();
        },
      }),
    publishEmpty: () => broadcasts.push([]),
  });
  const claimContext = () => ({
    receiverCurrent: (epoch: number) => receiver.isReady() && receiver.epoch() === epoch,
    generationStands: (generationId: string) => store.holdsGeneration(generationId),
    liveRecord: (runId: string) => host.current()?.request(runId),
  });
  const claim = (offer: BrainReplyOffer) =>
    deliveries.claim(offer.runId, offer.deliveryId, offer.epoch, claimContext());
  const acknowledge = (offer: BrainReplyOffer) => {
    const emptied = deliveries.acknowledge(offer.runId, offer.deliveryId, offer.epoch);
    if (emptied) offerReplies();
    return emptied;
  };
  /** The wait as main's IPC answers it: publication let finish, live record re-read, the call granted or not. */
  const waitOnCall = async (runId: string, epoch: number, timeoutMs = 1) => {
    const agent = host.current();
    const waited = await agent?.waitAsk(runId, timeoutMs);
    if (!waited || !isTerminalBrainRequestStatus(waited.status))
      return { record: waited, speak: false };
    await settle();
    const live = agent?.request(runId) ?? waited;
    if (live.historyRecordedAt === undefined) return { record: live, speak: false };
    const generationId = store.generationId() ?? "";
    const speak = deliveries.grantOnCall(live, generationId, epoch, claimContext());
    if (speak) offerReplies();
    return { record: live, speak };
  };
  const build = (client: BareResponsesModel) => {
    const model = bareModelAdapter(client);
    return new BrainAgent({
      runtime: responsesToolLoopRuntime(model),
      model,
      acts: { perform: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) },
      roster: () => ({ text: "", identities: [] }),
      standingContext: () => "",
      readTranscriptSince: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: () => undefined,
      store,
      createRunId: () => `run-${++ids}`,
      report: () => {},
      now: () => NOW,
      // A run left in flight at a test's end must not hold the process open:
      // its deadline timers are unreferenced, as the test's own would be.
      schedule: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        timer.unref();
        return timer;
      },
      // SAFETY: the handle is what `schedule` above returned, which is always a `setTimeout` timer.
      cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
  };
  return {
    storage,
    store,
    host,
    build,
    record,
    thread: () => thread,
    broadcasts,
    deliveries,
    receiver,
    offers,
    claim,
    acknowledge,
    waitOnCall,
    refuse: (value: boolean) => {
      refuseWrites = value;
    },
  };
}

/** A raw Responses payload as the adapter would normalize it. */
function answerOf(payload: WireRecord): ModelResponse {
  const answer = responsesModelAnswer(payload);
  assert.ok(answer);
  return answer;
}

function answered(text: string): ModelResponse {
  return answerOf({
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  });
}

function replies(thread: readonly ConversationEntry[], runId: string) {
  return thread.filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId);
}

async function submitMany(
  agent: BrainAgent,
  record: ReturnType<typeof composed>["record"],
  count: number,
) {
  const runIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await submitBrainAsk(
      agent,
      {
        submissionId: `sub-${index}`,
        question: `ask ${index}`,
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      },
      record,
    );
    assert.equal(result.outcome, "accepted");
    if (result.outcome === "accepted") runIds.push(result.runId);
  }
  return runIds;
}

test("removing the capability under five outstanding runs leaves every run interrupted, published, and marked", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await submitMany(agent, c.record, 5);
  await settle();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.TYPED_ASK).length, 5);

  await c.host.replace(() => undefined);
  await settle();
  assert.equal(c.host.current(), undefined);
  const stored = brainStateFromStored(c.storage.file);
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
  await settle();
  assert.equal(c.thread().filter((e) => e.words === "late").length, 0);
  assert.equal(
    brainStateFromStored(c.storage.file)?.requests.every(
      (r) => r.status === BRAIN_REQUEST_STATUS.INTERRUPTED,
    ),
    true,
  );
});

test("a successor replacing the agent under outstanding runs inherits a thread with every end written, and owns the store alone", async () => {
  const c = composed();
  const first = heldClient();
  await c.host.replace(() => c.build(first));
  const agent = c.host.current();
  assert.ok(agent);
  const runIds = await submitMany(agent, c.record, 5);
  // An earlier publication is held: the thread refuses until the handoff.
  c.refuse(true);
  await settle();
  c.refuse(false);
  const second = heldClient();
  await c.host.replace(() => c.build(second));
  await settle();
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
  const result = await submitBrainAsk(
    successor,
    { submissionId: "fresh", question: "new ask", origin: BRAIN_REQUEST_ORIGIN.TYPED },
    c.record,
  );
  assert.equal(result.outcome, "accepted");
  // The host reaches its first inference only after the run's own
  // bookkeeping; the answer is released once the model has been asked.
  await settle();
  second.release(
    answerOf({
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
      ],
    }),
  );
  await settle();
  const fresh = brainStateFromStored(c.storage.file)?.requests.find(
    (r) => r.question === "new ask",
  );
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
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  await submitMany(agent, c.record, 3);
  await settle();
  assert.equal(await c.store.clear(), true);
  await settle();
  assert.deepEqual(agent.requests(), []);
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 0);
  // The file holds the empty successor and the marker of the erasure alone.
  const stored = brainStateFromStored(c.storage.file);
  assert.equal(stored?.requests.length, 0);
  assert.equal(stored?.reset?.generationId, "gen-1");
  await c.host.replace(() => undefined);
  await settle();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 0);
});

test("a run ending long after its wait is offered once, to a ready receiver, only after its line and mark landed", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const [runId] = await submitMany(agent, c.record, 1);
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
  await settle();
  assert.equal(replies(c.thread(), runId).length, 1);
  assert.equal(c.deliveries.unclaimed().length, 1);
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
  assert.equal(replies(c.thread(), runId)[0]?.words, "Two agents are waiting.");
  // A duplicate claim, a repeated readiness, and a later report add nothing.
  assert.deepEqual(c.claim(offer), { granted: false });
  c.receiver.markReady(next);
  await settle();
  assert.equal(c.offers.length, 1);
  assert.equal(replies(c.thread(), runId).length, 1);
});

test("a refused History write keeps the reply unoffered and ungranted until the write recovers, then it is offered once", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const spoken = await submitBrainAsk(
    agent,
    { submissionId: "spoken-1", question: "how are they?", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    c.record,
  );
  assert.equal(spoken.outcome, "accepted");
  if (spoken.outcome !== "accepted") return;
  await settle();
  c.refuse(true);
  client.release(answered("Done."));
  await settle();
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
  await settle();
  assert.equal(c.offers.length, 0);
  await submitMany(agent, c.record, 1);
  await settle();
  assert.equal(replies(c.thread(), spoken.runId).length, 1);
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
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const [runA, runB] = await submitMany(agent, c.record, 2);
  assert.ok(runA && runB);
  client.release(answered("Answer."));
  await settle();
  client.release(answered("Answer."));
  await settle();
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
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const first = c.receiver.begin();
  c.receiver.markReady(first);
  const [runA, runB] = await submitMany(agent, c.record, 2);
  assert.ok(runA && runB);
  client.release(answered("Answer."));
  await settle();
  client.release(answered("Answer."));
  await settle();
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
  assert.equal(replies(c.thread(), runA).length, 1);
  assert.equal(replies(c.thread(), runB).length, 1);
});

test("a Clear invalidates every delivery: an unclaimed offer is refused, a late acknowledgement is ignored, nothing is offered again", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const [runId] = await submitMany(agent, c.record, 1);
  assert.ok(runId);
  await settle();
  client.release(answered("Before the clear."));
  await settle();
  assert.equal(c.offers.length, 1);
  const offer = c.offers[0];
  assert.ok(offer);
  // The Clear fences synchronously; the renderer's claim lands after it.
  const cleared = c.store.clear(NOW + 5);
  assert.deepEqual(c.claim(offer), { granted: false });
  assert.deepEqual(c.deliveries.unclaimed(), []);
  await cleared;
  await settle();
  assert.equal(c.acknowledge(offer), false);
  // A new renderer reporting ready is offered nothing of the erased generation.
  c.receiver.reset();
  c.receiver.markReady(c.receiver.begin());
  assert.equal(c.offers.length, 1);
});

test("a launch that finds ended runs restores their words and speaks none of them", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  await submitMany(agent, c.record, 2);
  await c.host.replace(() => undefined);
  await settle();
  assert.equal(c.thread().filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY).length, 2);
  // The next launch: a fresh delivery owner, a fresh receiver, the same file.
  const next = composed();
  next.storage.file = c.storage.file;
  next.receiver.markReady(next.receiver.begin());
  await next.host.replace(() => next.build(heldClient()));
  await settle();
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
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  const spoken = await submitBrainAsk(
    agent,
    { submissionId: "spoken-1", question: "how are they?", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    c.record,
  );
  assert.equal(spoken.outcome, "accepted");
  if (spoken.outcome !== "accepted") return;
  await settle();
  client.release(answered("Both are waiting."));
  await settle();
  assert.equal(c.offers.length, 1);
  const offer = c.offers[0];
  assert.ok(offer);
  // The wait arrives now, under the current epoch: the call is granted the
  // words, and the offer already out is withdrawn — its claim is refused.
  const waited = await c.waitOnCall(spoken.runId, epoch);
  assert.equal(waited.speak, true);
  assert.deepEqual(c.claim(offer), { granted: false });
  assert.equal(c.deliveries.unclaimed().length, 0);
  assert.equal(replies(c.thread(), spoken.runId).length, 1);

  // The reverse order: the offer is claimed first, and the wait is refused.
  const second = await submitBrainAsk(
    agent,
    { submissionId: "spoken-2", question: "and now?", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    c.record,
  );
  assert.equal(second.outcome, "accepted");
  if (second.outcome !== "accepted") return;
  await settle();
  client.release(answered("Still waiting."));
  await settle();
  const secondOffer = c.offers[1];
  assert.ok(secondOffer && secondOffer.runId === second.runId);
  assert.equal(c.claim(secondOffer).granted, true);
  const lateWait = await c.waitOnCall(second.runId, epoch);
  assert.equal(lateWait.record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(lateWait.speak, false);

  // An abandoned wait from a reloaded renderer names a stale epoch: refused,
  // and the run stays deliverable to the renderer that stands.
  const third = await submitBrainAsk(
    agent,
    { submissionId: "spoken-3", question: "later?", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    c.record,
  );
  assert.equal(third.outcome, "accepted");
  if (third.outcome !== "accepted") return;
  c.acknowledge(secondOffer);
  await settle();
  client.release(answered("Later."));
  await settle();
  const staleWait = await c.waitOnCall(third.runId, epoch - 1);
  assert.equal(staleWait.speak, false);
  const thirdOffer = c.offers[2];
  assert.ok(thirdOffer);
  assert.equal(thirdOffer.runId, third.runId);
  assert.equal(c.claim(thirdOffer).granted, true);
  await c.host.replace(() => undefined);
});

test("an on-call grant that takes the offered run out of the receiver's hand offers the next owed reply at once", async () => {
  const c = composed();
  const client = heldClient();
  await c.host.replace(() => c.build(client));
  const agent = c.host.current();
  assert.ok(agent);
  const epoch = c.receiver.begin();
  c.receiver.markReady(epoch);
  // A is spoken, B is typed; both end while the renderer is busy, so neither is claimed.
  const spoken = await submitBrainAsk(
    agent,
    { submissionId: "spoken-a", question: "how are they?", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
    c.record,
  );
  assert.equal(spoken.outcome, "accepted");
  if (spoken.outcome !== "accepted") return;
  const [typed] = await submitMany(agent, c.record, 1);
  assert.ok(typed);
  await settle();
  client.release(answered("A."));
  await settle();
  client.release(answered("B."));
  await settle();
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
