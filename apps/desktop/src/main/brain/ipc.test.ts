/* oxlint-disable anti-slop/no-unknown-returns -- Fake Electron listeners deliberately retain the IPC boundary shape. */
import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent, BrainRequestRecord, BrainSubmission } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  maximumTypedAskLength,
} from "@sidecar/realtime";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { InProcessTransport } from "@sidecar/runtime";
import { GATEWAY_CLIENT_ROLE, GATEWAY_EVENT, MAIN_SESSION_KEY } from "@sidecar/runtime-contracts";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import { BRIDGE } from "#shared/bridge";
import {
  BRAIN_ASK_REFUSAL,
  type BrainAskWait,
  type BrainReplyClaimResult,
  brainReplyWords,
} from "#shared/wire/brain";
import type { ConversationOperations } from "../conversation-operations";
import { createGatewayOperator } from "../gateway/operator";
import { createGatewayService } from "../gateway/service";
import { operatorOverBrain } from "../gateway/testing";
import { VoiceReceiver } from "../voice-receiver";
import { followBrainRequests, publishRuns, registerBrainIpc } from "./ipc";
import { BrainReplyDeliveries } from "./reply-delivery";

const NOW = 1_800_000_000_000;

function record(overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return {
    runId: "run-1",
    submissionId: "sub-1",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.SUCCEEDED,
    revision: 3,
    acceptedAt: NOW,
    startedAt: NOW + 1,
    settledAt: NOW + 2,
    text: "Two agents are waiting.",
    performedActs: 0,
    unknownActs: 0,
    askRecordedAt: NOW,
    ...overrides,
  };
}

/** A brain that accepts every submission into one run and remembers what it was asked. */
function acceptingBrain(asked: BrainSubmission[]): BrainAgent {
  // SAFETY: the ask path reads only `submitAsk` and `request` off the agent; the fixture stands in for the rest.
  return {
    submitAsk: async (submission: BrainSubmission) => {
      asked.push(submission);
      return { outcome: "accepted", runId: "run-1", acceptedAt: NOW };
    },
    request: () =>
      record({
        status: BRAIN_REQUEST_STATUS.QUEUED,
        question: "the accepted words",
        origin: asked.at(-1)?.origin ?? BRAIN_REQUEST_ORIGIN.TYPED,
        askRecordedAt: undefined,
      }),
    markAskRecorded: async (runId: string) => {
      askMarks.push(runId);
      return true;
    },
  } as unknown as BrainAgent;
}

const askMarks: string[] = [];

/** A thread the tests write into, as the main process's store would. */
function thread(fail = () => false) {
  let entries: readonly ConversationEntry[] = [];
  const recorded: { entry: ConversationEntry; at: number }[] = [];
  return {
    entries: () => entries,
    recorded,
    record: (entry: ConversationEntry, at: number) => {
      if (fail()) return false;
      recorded.push({ entry, at });
      entries = appendConversationThreadEntry(entries, entry, NOW + 100, at);
      return true;
    },
  };
}

/** A brain that only remembers which runs were marked recorded. */
function markingBrain(
  marked: string[],
  records: () => readonly BrainRequestRecord[] = () => [],
): Pick<BrainAgent, "markHistoryRecorded" | "markAskRecorded" | "request"> {
  return {
    markHistoryRecorded: async (runId) => {
      marked.push(runId);
      return true;
    },
    markAskRecorded: async (runId) => {
      marked.push(`ask ${runId}`);
      return true;
    },
    request: (runId) => records().find((record) => record.runId === runId),
  };
}

test("an ask with no brain is refused in fixed words, and nothing is recorded", async () => {
  const written = thread();
  const operator = operatorOverBrain({
    current: () => undefined,
    recordConversationEntry: written.record,
  });
  const result = await operator.submit({
    submissionId: "sub-1",
    question: "what needs me?",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.deepEqual(result, { outcome: "rejected", reason: "absent" });
  assert.equal(BRAIN_ASK_REFUSAL.absent.includes("OpenAI key"), true);
  assert.deepEqual(written.recorded, []);
});

test("a typed ask is bounded, handed to the brain whole, and recorded in the accepted record's words", async () => {
  const asked: BrainSubmission[] = [];
  const written = thread();
  const long = `  ${"a".repeat(maximumTypedAskLength + 50)}`;
  const brain = acceptingBrain(asked);
  const operator = operatorOverBrain({
    current: () => brain,
    recordConversationEntry: written.record,
  });
  const result = await operator.submit({
    submissionId: "sub-1",
    question: long,
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.deepEqual(result, { outcome: "accepted", runId: "run-1", acceptedAt: NOW });
  assert.equal(asked[0]?.question.length, maximumTypedAskLength);
  assert.equal(asked[0]?.submissionId, "sub-1");
  // The line is the run's own words at the run's own moment — what a retry
  // that found an earlier run would otherwise misquote.
  assert.deepEqual(written.recorded, [
    {
      entry: {
        kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
        words: "the accepted words",
        requestId: "run-1",
      },
      at: NOW,
    },
  ]);
  assert.equal(written.entries()[0]?.recordedAt, NOW);
});

test("a spoken ask records nothing here: the voice service's transcript is its line", async () => {
  const asked: BrainSubmission[] = [];
  const written = thread();
  const brain = acceptingBrain(asked);
  const operator = operatorOverBrain({
    current: () => brain,
    recordConversationEntry: written.record,
  });
  await operator.submit({
    submissionId: "call-1",
    question: "send it",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(asked[0]?.origin, BRAIN_REQUEST_ORIGIN.SPOKEN);
  assert.deepEqual(written.recorded, []);
});

test("a run's end reaches the thread once, at the moment it settled, decided against the live record", async () => {
  const written = thread();
  const marked: string[] = [];
  let live: BrainRequestRecord[] = [
    record({ status: BRAIN_REQUEST_STATUS.RUNNING, revision: 1, text: undefined }),
  ];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 0);
  live = [record()];
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 1);
  const [firstWrite] = written.recorded;
  assert.equal(firstWrite?.at, NOW + 2);
  assert.equal(written.entries()[0]?.recordedAt, NOW + 2);
  assert.deepEqual(marked, ["run-1"]);
  // Once marked, the live record says so: an unrelated later report, an
  // older report captured before the mark, a rebuilt follower, or a thread
  // that has since let the line go all leave it alone.
  live = [{ ...record(), historyRecordedAt: NOW + 2 }];
  await publishRuns(agent, [record()], written.record);
  live = [
    ...live,
    record({ runId: "run-2", status: BRAIN_REQUEST_STATUS.CANCELLED, text: undefined }),
  ];
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 2);
  const [, secondWrite] = written.recorded;
  assert.equal(secondWrite?.entry.words, "Cancelled.");
  assert.deepEqual(marked, ["run-1", "run-2"]);
  // A run the live agent no longer knows — the generation was reset — is not written.
  live = [];
  await publishRuns(agent, [record({ runId: "run-3" })], written.record);
  assert.equal(written.recorded.length, 2);
});

test("a retired follower stops between two records, and the second waits for a live report", async () => {
  const written = thread();
  const marked: string[] = [];
  const live = [record({ runId: "run-1" }), record({ runId: "run-2" })];
  let holdMark: (() => void) | undefined;
  const agent: Pick<BrainAgent, "request" | "markHistoryRecorded" | "markAskRecorded"> = {
    request: (runId) => live.find((entry) => entry.runId === runId),
    markAskRecorded: async () => true,
    markHistoryRecorded: (runId) =>
      new Promise((resolve) => {
        marked.push(runId);
        holdMark = () => resolve(true);
      }),
  };
  let following = true;
  const publishing = publishRuns(agent, live, written.record, () => following);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(marked, ["run-1"]);
  following = false;
  holdMark?.();
  await publishing;
  assert.equal(written.recorded.length, 1);
  assert.deepEqual(marked, ["run-1"]);
});

test("a run whose line the thread refused stays unmarked and is written on the next report", async () => {
  let refuse = true;
  const written = thread(() => refuse);
  const marked: string[] = [];
  const live = [record()];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live, written.record);
  assert.deepEqual(marked, []);
  assert.equal(written.recorded.length, 0);
  refuse = false;
  await publishRuns(agent, live, written.record);
  assert.deepEqual(marked, ["run-1"]);
  assert.equal(written.recorded.length, 1);
});

test("a typed ask whose line the thread refused at acceptance is written by a later report, at its acceptance", async () => {
  let refuse = true;
  const written = thread(() => refuse);
  const marked: string[] = [];
  const live = [
    record({
      status: BRAIN_REQUEST_STATUS.RUNNING,
      text: undefined,
      revision: 1,
      askRecordedAt: undefined,
    }),
  ];
  const agent = markingBrain(marked, () => live);
  await publishRuns(agent, live, written.record);
  assert.equal(written.recorded.length, 0);
  refuse = false;
  await publishRuns(agent, live, written.record);
  assert.deepEqual(marked, ["ask run-1"]);
  assert.equal(written.recorded[0]?.entry.kind, CONVERSATION_ENTRY_KIND.TYPED_ASK);
  assert.equal(written.recorded[0]?.entry.words, "what needs me?");
  assert.equal(written.recorded[0]?.at, NOW);
  // The end, written later, still lands after the ask in the thread.
  live[0] = { ...record(), askRecordedAt: NOW };
  await publishRuns(agent, live, written.record);
  assert.deepEqual(
    written.entries().map((entry) => entry.kind),
    [CONVERSATION_ENTRY_KIND.TYPED_ASK, CONVERSATION_ENTRY_KIND.REPLY],
  );
});

test("an end without a reply is worded from what was done, never from a provider's words", () => {
  const acted = { performedActs: 2, text: undefined };
  assert.equal(
    brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "model", ...acted })),
    "I did 2 things you asked, but I couldn't put the reply into words.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "model", text: undefined }),
    ),
    "I couldn't work that one out. Ask me again in a moment.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "persistence", performedActs: 1 }),
    ),
    "Two agents are waiting. I did one thing you asked, but I couldn't save my notes about it.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.SUCCEEDED, text: undefined, performedActs: 1 }),
    ),
    "Done: I did one thing you asked.",
  );
  assert.equal(
    brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.TIMED_OUT, text: undefined })),
    "That ask ran out of time.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.INTERRUPTED, text: undefined, performedActs: 1 }),
    ),
    "That ask was interrupted, though I did one thing you asked.",
  );
  assert.equal(brainReplyWords(record({ status: BRAIN_REQUEST_STATUS.QUEUED })), undefined);
  // An act nobody confirmed is said as such, never as refused and never as done.
  assert.equal(
    brainReplyWords(
      record({
        status: BRAIN_REQUEST_STATUS.FAILED,
        failure: "model",
        text: undefined,
        unknownActs: 1,
      }),
    ),
    "one act may have gone through without confirming, so I won't repeat it on my own, but I couldn't put the reply into words.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.SUCCEEDED, unknownActs: 2, text: "Sent." }),
    ),
    "Sent. 2 acts may have gone through without confirming, so I won't repeat them on my own.",
  );
  assert.equal(
    brainReplyWords(
      record({ status: BRAIN_REQUEST_STATUS.FAILED, failure: "incomplete", text: undefined }),
    ),
    "I ran out of room before finishing that. Ask me again, perhaps in smaller pieces.",
  );
});

test("following a brain relays every report, writes and marks the ended runs, and stops when unfollowed", async () => {
  let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
  const marked: string[] = [];
  const ready = record({
    status: BRAIN_REQUEST_STATUS.INTERRUPTED,
    text: undefined,
    askRecordedAt: NOW,
  });
  // SAFETY: the follower reads only these members off the agent.
  const agent = {
    subscribe: (next: (records: readonly BrainRequestRecord[]) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    ready: () => Promise.resolve(),
    requests: () => [ready],
    request: (runId: string) => [ready, record({ runId: "run-2" })].find((r) => r.runId === runId),
    markAskRecorded: async () => true,
    markHistoryRecorded: async (runId: string) => {
      marked.push(runId);
      return true;
    },
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  const written = thread();
  const unfollow = followBrainRequests(agent, {
    recordConversationEntry: written.record,
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  // The launch's interrupted run is written and relayed once it is read.
  assert.equal(broadcasts.length, 1);
  assert.equal(written.entries()[0]?.words, "That ask was interrupted before I could finish it.");
  assert.deepEqual(marked, ["run-1"]);
  listener?.([{ ...ready, historyRecordedAt: NOW + 2 }, record({ runId: "run-2" })]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(broadcasts.length, 2);
  assert.equal(written.entries().length, 2);
  unfollow();
  assert.equal(listener, undefined);
});

test("a retired follower relays nothing a late report carries", async () => {
  let listener: ((records: readonly BrainRequestRecord[]) => void) | undefined;
  let releaseReady: (() => void) | undefined;
  // SAFETY: the follower reads only these four members off the agent.
  const agent = {
    subscribe: (next: (records: readonly BrainRequestRecord[]) => void) => {
      listener = next;
      return () => undefined;
    },
    ready: () =>
      new Promise<void>((resolve) => {
        releaseReady = resolve;
      }),
    requests: () => [record()],
    request: () => record(),
    markAskRecorded: async () => true,
    markHistoryRecorded: async () => true,
  } as unknown as BrainAgent;
  const broadcasts: (readonly BrainRequestRecord[])[] = [];
  const written = thread();
  const unfollow = followBrainRequests(agent, {
    recordConversationEntry: written.record,
    broadcastRequests: (snapshots) => broadcasts.push(snapshots),
  });
  unfollow();
  releaseReady?.();
  listener?.([record()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(broadcasts, []);
  assert.deepEqual(written.recorded, []);
});

test("an end is published downstream only once its line and its mark have both landed, then on every later report", async () => {
  const published: string[] = [];
  let markRefused = true;
  let marked = false;
  const live = () =>
    record({ askRecordedAt: NOW, historyRecordedAt: marked ? NOW + 2 : undefined });
  // SAFETY: publication reads only these members off the agent.
  const agent = {
    request: () => live(),
    markAskRecorded: async () => true,
    markHistoryRecorded: async () => {
      if (markRefused) return false;
      marked = true;
      return true;
    },
  } as unknown as BrainAgent;
  const written = thread();
  const report = () =>
    publishRuns(
      agent,
      [live()],
      written.record,
      () => true,
      (ended) => published.push(`${ended.runId}@${ended.historyRecordedAt}`),
    );
  // The line was taken but the mark refused: not published downstream, and
  // the line is not written a second time on the retry because the thread
  // already holds it for that run.
  await report();
  assert.deepEqual(published, []);
  assert.equal(written.entries().length, 1);
  markRefused = false;
  await report();
  assert.deepEqual(published, ["run-1@1800000000002"]);
  assert.equal(written.entries().length, 1);
  // Already marked: reported downstream again, written nowhere. The retry
  // before it offered the line a second time and the thread, holding it,
  // took nothing.
  await report();
  assert.deepEqual(published, ["run-1@1800000000002", "run-1@1800000000002"]);
  assert.equal(written.recorded.length, 2);
  assert.equal(written.entries().length, 1);
});

test("a refused thread write publishes nothing downstream, and a retired follower publishes nothing late", async () => {
  const published: string[] = [];
  let refuse = true;
  // SAFETY: publication reads only these members off the agent.
  const agent = {
    request: () => record({ askRecordedAt: NOW, historyRecordedAt: undefined }),
    markAskRecorded: async () => true,
    markHistoryRecorded: async () => true,
  } as unknown as BrainAgent;
  const written = thread(() => refuse);
  await publishRuns(
    agent,
    [record()],
    written.record,
    () => true,
    (ended) => published.push(ended.runId),
  );
  assert.equal(published.length, 0);
  refuse = false;
  let following = true;
  // The follower retires while the mark is out: the end is written, but not
  // handed on, because nothing may be offered on a retired follower's behalf.
  // SAFETY: publication reads only `request` and the two marks off the agent; the fixture stands in for the rest.
  const retiringAgent = {
    ...agent,
    markHistoryRecorded: async () => {
      following = false;
      return true;
    },
  } as unknown as BrainAgent;
  await publishRuns(
    retiringAgent,
    [record()],
    written.record,
    () => following,
    (ended) => published.push(ended.runId),
  );
  assert.equal(published.length, 0);
  assert.equal(written.entries().length, 1);
});

/**
 * The grant boundary as the IPC registration actually wires it: a real
 * ledger and receiver behind the real Gateway service, reached by the real
 * `registerBrainIpc` through the operator client over the in-process
 * transport, from fake `ipcMain` invokes of two senders — so what is checked
 * is what a renderer's call can and cannot do across the whole boundary, not
 * the ledger's own arguments.
 */
function registered(live: () => BrainRequestRecord | undefined) {
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const sends = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
  // SAFETY: the registration reads senders by identity alone; two distinct inert objects are two windows.
  const voiceSender = {} as WebContents;
  // SAFETY: as above, the panel.
  const panelSender = {} as WebContents;
  let ids = 0;
  const deliveries = new BrainReplyDeliveries({ nextDeliveryId: () => `delivery-${++ids}` });
  const receiver = new VoiceReceiver();
  const acknowledged: string[] = [];
  const offered: unknown[] = [];
  // SAFETY: the grant boundary reads only `request` and `waitAsk` off the agent; the fixture stands in for the rest.
  const agent = {
    request: () => live(),
    waitAsk: async () => live(),
  } as unknown as BrainAgent;
  const service = createGatewayService({
    brain: {
      current: () => agent,
      agentForRun: () => agent,
      conversationForRun: () => MAIN_SESSION_KEY,
      allRequests: () => [],
      generationId: () => "gen-1",
      holdsGeneration: (generationId) => generationId === "gen-1",
      publicationSettled: () => Promise.resolve(),
      // SAFETY: the grant boundary reaches no child; the fixture stands in for the service.
      children: {} as ChildRunService,
      // SAFETY: only the revision is read here; the fixture stands in for the snapshot.
      configuration: () => ({ revision: 1 }) as unknown as ResolvedConfiguration,
      updateConfiguration: () => [],
      pendingNoticeCount: () => 0,
    },
    // SAFETY: the grant boundary reaches no conversation operation; the fixture stands in for them.
    conversations: {} as ConversationOperations,
    memory: {
      search: async () => ({}),
      get: async () => ({}),
      forget: async () => undefined,
      status: () => ({}),
    },
    observedSessions: () => [],
    deliveries,
    receiver,
    recordConversationEntry: () => true,
    now: () => NOW,
    createId: () => `id-${++ids}`,
  });
  const operator = createGatewayOperator({
    transport: new InProcessTransport(service.server, {
      clientId: "test-operator",
      role: GATEWAY_CLIENT_ROLE.OPERATOR,
    }),
    createId: () => `request-${++ids}`,
  });
  registerBrainIpc({
    ipcMain: {
      handle: (channel, listener) => {
        invokes.set(channel, listener);
      },
      on: (channel, listener) => {
        sends.set(channel, listener);
        // SAFETY: this inert fixture implements only the IpcMain return identity the listener API requires.
        return {} as Electron.IpcMain;
      },
    },
    trustedSender: () => true,
    submitters: {
      panel: (sender) => sender === panelSender,
      voice: (sender) => sender === voiceSender,
    },
    operator,
  });
  service.server.subscribe((event) => {
    if (event.kind === GATEWAY_EVENT.DELIVERY_OFFERED) offered.push(event.payload);
  });
  // SAFETY: the bridge reads only the sender off the event, and an Electron invoke listener always answers a promise.
  const claim = (sender: WebContents, runId: string, deliveryId: string, epoch: number) =>
    invokes.get(BRIDGE.claimBrainReply.channel)?.(
      { sender } as IpcMainInvokeEvent,
      runId,
      deliveryId,
      epoch,
    ) as Promise<BrainReplyClaimResult>;
  // SAFETY: as above, for the wait.
  const wait = (sender: WebContents, runId: string, epoch: number) =>
    invokes.get(BRIDGE.waitBrainAsk.channel)?.(
      { sender } as IpcMainInvokeEvent,
      runId,
      epoch,
    ) as Promise<BrainAskWait>;
  const ack = async (sender: WebContents, runId: string, deliveryId: string, epoch: number) => {
    const before = deliveries.records().length;
    // SAFETY: the bridge reads only the sender off the event.
    sends.get(BRIDGE.ackBrainReply.channel)?.({ sender } as IpcMainEvent, runId, deliveryId, epoch);
    await new Promise((resolve) => setImmediate(resolve));
    if (deliveries.records().length < before) acknowledged.push(runId);
  };
  return {
    deliveries,
    receiver,
    voiceSender,
    panelSender,
    claim,
    wait,
    ack,
    acknowledged,
    offered,
  };
}

/** A record as it reads after the protocol carried it: every explicitly undefined field gone. */
function crossedWire(record: BrainRequestRecord): BrainRequestRecord {
  // SAFETY: the text is this test's own serialization of the record; parsing it back yields the same shape.
  return JSON.parse(JSON.stringify(record)) as BrainRequestRecord;
}

test("a claim is granted only to the voice window, for the epoch the offer went to, while that epoch stands", async () => {
  const ended = record({ historyRecordedAt: NOW + 2 });
  const f = registered(() => ended);
  const first = f.receiver.begin();
  f.receiver.markReady(first);
  f.deliveries.observe([record({ status: BRAIN_REQUEST_STATUS.RUNNING })]);
  f.deliveries.published(ended, "gen-1");
  const offer = f.deliveries.nextOffer(first);
  assert.ok(offer);
  // A panel naming the right ids and epoch is refused.
  assert.deepEqual(await f.claim(f.panelSender, offer.runId, offer.deliveryId, offer.epoch), {
    granted: false,
  });
  // The same WebContents reloads: a new epoch, the unclaimed offer reoffered
  // to it. The old renderer's queued invoke carries the old epoch and is
  // refused, however current the main process's own epoch now is.
  f.receiver.begin();
  const second = f.receiver.begin();
  f.receiver.markReady(second);
  const reoffer = f.deliveries.nextOffer(second);
  assert.ok(reoffer && reoffer.deliveryId === offer.deliveryId);
  assert.deepEqual(await f.claim(f.voiceSender, offer.runId, offer.deliveryId, offer.epoch), {
    granted: false,
  });
  // The current renderer's claim, naming the epoch of its own offer, is granted once.
  assert.deepEqual(await f.claim(f.voiceSender, reoffer.runId, reoffer.deliveryId, reoffer.epoch), {
    granted: true,
    words: "Two agents are waiting.",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.deepEqual(await f.claim(f.voiceSender, reoffer.runId, reoffer.deliveryId, reoffer.epoch), {
    granted: false,
  });
  // A stale acknowledgement — the old epoch's, or a panel's — changes nothing; the current one empties the hand.
  await f.ack(f.voiceSender, reoffer.runId, reoffer.deliveryId, first);
  await f.ack(f.panelSender, reoffer.runId, reoffer.deliveryId, second);
  assert.deepEqual(f.acknowledged, []);
  await f.ack(f.voiceSender, reoffer.runId, reoffer.deliveryId, second);
  assert.deepEqual(f.acknowledged, ["run-1"]);
});

test("a wait grants the asking call the words only for the current voice renderer, once, and only after History holds them", async () => {
  let live = record({ status: BRAIN_REQUEST_STATUS.RUNNING, historyRecordedAt: undefined });
  const f = registered(() => live);
  const epoch = f.receiver.begin();
  f.receiver.markReady(epoch);
  f.deliveries.observe([live]);
  // Still running: the record, no grant. The record crossed the wire, so a
  // field the fixture left explicitly undefined is simply absent.
  assert.deepEqual(await f.wait(f.voiceSender, "run-1", epoch), {
    record: crossedWire(live),
    speak: false,
  });
  // Ended but not yet in History — the write was refused — the call is not granted.
  live = record({ historyRecordedAt: undefined });
  assert.equal((await f.wait(f.voiceSender, "run-1", epoch)).speak, false);
  // In History now. A panel, or a renderer naming a stale epoch, is not granted and consumes nothing.
  live = record({ historyRecordedAt: NOW + 2 });
  assert.equal((await f.wait(f.panelSender, "run-1", epoch)).speak, false);
  assert.equal((await f.wait(f.voiceSender, "run-1", epoch - 1)).speak, false);
  // The offer path had already offered it; the call's grant withdraws that offer.
  f.deliveries.published(live, "gen-1");
  const offer = f.deliveries.nextOffer(epoch);
  assert.ok(offer);
  assert.deepEqual(await f.wait(f.voiceSender, "run-1", epoch), {
    record: crossedWire(live),
    speak: true,
  });
  assert.deepEqual(await f.claim(f.voiceSender, offer.runId, offer.deliveryId, offer.epoch), {
    granted: false,
  });
  // The grant was the run's one: a second wait is not granted again.
  assert.equal((await f.wait(f.voiceSender, "run-1", epoch)).speak, false);
});
