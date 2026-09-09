import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent, BrainRequestRecord, BrainSubmission } from "@sidecar/brain";
import { DELIVERY_STATE, DeliveryLedger, type DeliveryState } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  GatewayClient,
  InProcessTransport,
  NODE_CAPABILITY_STATUS,
} from "@sidecar/gateway";
import { TextLoopbackTransport } from "@sidecar/gateway/testing";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import { isRecord, type WireRecord, type WireValue } from "@sidecar/wire";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import type { ConversationOperations } from "./conversation-operations.js";
import { HOST_NATIVE_NODE_ID } from "./node-capabilities.js";
import { createGatewayOperator } from "./operator.js";
import { createGatewayService, type GrantedWords } from "./service.js";
import { VoiceReceiver } from "./voice-receiver.js";

const NOW = 1_800_000_000_000;

/** A wire value the test expects to be a record; anything else fails the test where it stands. */
function recordOf(value: WireValue | undefined): WireRecord {
  assert.ok(isRecord(value));
  return value;
}

/** The state the ledger holds for one run, or nothing once the run's delivery is gone. */
function deliveryState(
  deliveries: DeliveryLedger<GrantedWords>,
  runId: string,
): DeliveryState | undefined {
  return deliveries.records().find((delivery) => delivery.runId === runId)?.state;
}

function record(overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return {
    runId: "run-1",
    submissionId: "sub-1",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.RUNNING,
    revision: 1,
    acceptedAt: NOW,
    performedActs: 0,
    unknownActs: 0,
    askRecordedAt: NOW,
    ...overrides,
  };
}

function ended(overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return record({
    status: BRAIN_REQUEST_STATUS.SUCCEEDED,
    settledAt: NOW + 2,
    text: "Two agents are waiting.",
    historyRecordedAt: NOW + 2,
    revision: 3,
    ...overrides,
  });
}

/**
 * A brain standing in for the wiring: one conversation, records the test
 * sets, submissions counted and answered with fresh runs, and a generation
 * the test can replace as a credential change would.
 */
function fixture(transportKind: "in-process" | "loopback" = "in-process") {
  let ids = 0;
  let runs = 0;
  const records = new Map<string, BrainRequestRecord>();
  const asked: BrainSubmission[] = [];
  const generation = { id: "gen-1" };
  const recorded: ConversationEntry[] = [];
  const deleted: SessionKey[] = [];
  // SAFETY: the service reads only these members off an agent; the fixture stands in for the rest.
  const agent = {
    submitAsk: async (submission: BrainSubmission) => {
      asked.push(submission);
      const runId = `run-${++runs}`;
      records.set(
        runId,
        record({
          runId,
          submissionId: submission.submissionId,
          question: submission.question,
          askRecordedAt: undefined,
        }),
      );
      return { outcome: "accepted", runId, acceptedAt: NOW };
    },
    request: (runId: string) => records.get(runId),
    waitAsk: async (runId: string) => records.get(runId),
    cancelAsk: async (runId: string) => {
      const held = records.get(runId);
      if (!held) return undefined;
      const cancelled = { ...held, status: BRAIN_REQUEST_STATUS.CANCELLED, settledAt: NOW + 1 };
      records.set(runId, cancelled);
      return cancelled;
    },
    markAskRecorded: async () => true,
  } as unknown as BrainAgent;
  let brainStands = true;
  const deliveries = new DeliveryLedger<GrantedWords>({
    nextDeliveryId: () => `delivery-${++ids}`,
  });
  const receiver = new VoiceReceiver();
  const service = createGatewayService({
    brain: {
      current: () => (brainStands ? agent : undefined),
      agentForRun: (runId) => (brainStands && records.has(runId) ? agent : undefined),
      conversationForRun: (runId) => (records.has(runId) ? MAIN_SESSION_KEY : undefined),
      allRequests: () => [...records.values()],
      generationId: () => generation.id,
      holdsGeneration: (generationId) => generationId === generation.id,
      publicationSettled: () => Promise.resolve(),
      // SAFETY: no test here reaches a child; the fixture stands in for the service.
      children: {} as ChildRunService,
      // SAFETY: only the revision is read; the fixture stands in for the snapshot.
      configuration: () => ({ revision: 1 }) as unknown as ResolvedConfiguration,
      updateConfiguration: () => [],
    },
    // SAFETY: the tests reach the deletion alone; the fixture stands in for the other operations.
    conversations: {
      deleteHistory: async (sessionKey: SessionKey) => {
        deleted.push(sessionKey);
        return CONVERSATION_DELETE_OUTCOME.COMPLETE;
      },
      holds: () => true,
      history: () => [],
      directory: () => [],
    } as unknown as ConversationOperations,
    memory: { status: () => ({}) },
    observedSessionCount: () => 0,
    deliveries,
    receiver,
    recordConversationEntry: (entry) => {
      recorded.push(entry);
      return true;
    },
    now: () => NOW,
    createId: () => `id-${++ids}`,
  });
  const identity = { clientId: "operator", role: GATEWAY_CLIENT_ROLE.OPERATOR };
  const transport =
    transportKind === "in-process"
      ? new InProcessTransport(service.server, identity)
      : new TextLoopbackTransport(service.server, identity);
  const operator = createGatewayOperator({
    client: new GatewayClient({ transport, createId: () => `request-${++ids}` }),
  });
  const events: { kind: string; payload: WireValue }[] = [];
  service.server.subscribe((event) => events.push({ kind: event.kind, payload: event.payload }));
  return {
    service,
    operator,
    transport,
    deliveries,
    receiver,
    records,
    asked,
    recorded,
    deleted,
    events,
    generation,
    retireBrain: () => {
      brainStands = false;
    },
    /** The followers' report of every record, as the wiring's broadcast hands it on. */
    report: () => service.runsReported([...records.values()]),
    end: (runId: string) => {
      const done = ended({ runId, submissionId: records.get(runId)?.submissionId ?? "sub" });
      records.set(runId, done);
      service.runsReported([...records.values()]);
      service.endPublished(done, MAIN_SESSION_KEY);
      return done;
    },
    offers: () => events.filter((event) => event.kind === GATEWAY_EVENT.DELIVERY_OFFERED),
  };
}

for (const kind of ["in-process", "loopback"] as const) {
  test(`[${kind}] a duplicate submission finds the one run, and the ask is recorded once`, async () => {
    const f = fixture(kind);
    const submission = {
      submissionId: "sub-1",
      question: "what needs me?",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    } as const;
    const first = await f.operator.submit(submission);
    const retry = await f.operator.submit(submission);
    assert.deepEqual(first, retry);
    assert.equal(f.asked.length, 1);
    assert.equal(f.recorded.length, 1);
    // A submission of other words under the same id is a conflict the client reads as a refusal.
    const conflict = await f.operator.submit({ ...submission, question: "other words" });
    assert.equal(conflict.outcome, "rejected");
    assert.equal(f.asked.length, 1);
  });

  test(`[${kind}] the Clear crosses the boundary as Delete history on main and answers whether it landed`, async () => {
    const f = fixture(kind);
    assert.equal(await f.operator.deleteHistory(MAIN_SESSION_KEY), true);
    assert.deepEqual(f.deleted, [MAIN_SESSION_KEY]);
  });

  test(`[${kind}] a renderer reload re-offers the unclaimed reply to the new epoch and refuses the old one's claim`, async () => {
    const f = fixture(kind);
    await f.operator.submit({
      submissionId: "s",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    f.report();
    const first = f.receiver.begin();
    f.receiver.markReady(first);
    f.service.receiverReady();
    f.end("run-1");
    assert.equal(f.offers().length, 1);
    assert.equal(deliveryState(f.deliveries, "run-1"), DELIVERY_STATE.OFFERED);
    // The renderer reloads before claiming: a new epoch, the offer re-issued to it.
    f.receiver.reset();
    const second = f.receiver.begin();
    f.receiver.markReady(second);
    f.service.receiverReady();
    assert.equal(f.offers().length, 2);
    const offer = recordOf(f.offers()[1]?.payload);
    assert.equal(offer.epoch, second);
    // The vanished renderer's claim, naming the old epoch, is refused; the current one is granted once.
    assert.deepEqual(await f.operator.claim("run-1", String(offer.deliveryId), first), {
      granted: false,
    });
    const granted = await f.operator.claim("run-1", String(offer.deliveryId), second);
    assert.equal(granted.granted, true);
    assert.deepEqual(await f.operator.claim("run-1", String(offer.deliveryId), second), {
      granted: false,
    });
    assert.equal(deliveryState(f.deliveries, "run-1"), DELIVERY_STATE.CLAIMED);
  });

  test(`[${kind}] a claimed reply is never re-offered to a competing receiver, and a delayed acknowledgement under the old epoch changes nothing`, async () => {
    const f = fixture(kind);
    await f.operator.submit({
      submissionId: "a",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    await f.operator.submit({
      submissionId: "b",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    f.report();
    const first = f.receiver.begin();
    f.receiver.markReady(first);
    f.end("run-1");
    f.end("run-2");
    const offer = recordOf(f.offers()[0]?.payload);
    assert.equal(offer.runId, "run-1");
    assert.equal((await f.operator.claim("run-1", String(offer.deliveryId), first)).granted, true);
    // A second receiver takes over while the first still holds the claimed words.
    f.receiver.reset();
    const second = f.receiver.begin();
    f.receiver.markReady(second);
    f.service.receiverReady();
    const next = recordOf(f.offers()[1]?.payload);
    // run-1 may already have been heard: only run-2 is offered to the newcomer.
    assert.equal(next.runId, "run-2");
    assert.equal(deliveryState(f.deliveries, "run-1"), DELIVERY_STATE.CLAIMED);
    // The first receiver's acknowledgement lands late, under the epoch its
    // grant went to: it closes run-1 — the words were its to finish — and
    // re-offers nothing, since the newcomer already holds run-2. A stranger's
    // acknowledgement under the wrong epoch or delivery changes nothing.
    assert.equal(await f.operator.acknowledge("run-2", String(next.deliveryId), first), false);
    assert.equal(await f.operator.acknowledge("run-1", "delivery-none", first), false);
    assert.equal(deliveryState(f.deliveries, "run-1"), DELIVERY_STATE.CLAIMED);
    assert.equal(await f.operator.acknowledge("run-1", String(offer.deliveryId), first), true);
    assert.equal(deliveryState(f.deliveries, "run-1"), undefined);
    assert.equal(f.offers().length, 2);
    // The second receiver claims and acknowledges run-2, which ends it.
    assert.equal((await f.operator.claim("run-2", String(next.deliveryId), second)).granted, true);
    assert.equal(await f.operator.acknowledge("run-2", String(next.deliveryId), second), true);
    assert.equal(deliveryState(f.deliveries, "run-2"), undefined);
  });

  test(`[${kind}] an account change withdraws every owed reply and the receiver is told under its epoch`, async () => {
    const f = fixture(kind);
    const withdrawn: number[] = [];
    f.operator.onDeliveriesWithdrawn((epoch) => withdrawn.push(epoch));
    await f.operator.submit({
      submissionId: "s",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    f.report();
    const epoch = f.receiver.begin();
    f.receiver.markReady(epoch);
    f.end("run-1");
    assert.equal(deliveryState(f.deliveries, "run-1"), DELIVERY_STATE.OFFERED);
    // The credential changes: the generation is replaced and the brain retired.
    f.generation.id = "gen-2";
    f.retireBrain();
    f.service.generationReplaced(MAIN_SESSION_KEY);
    assert.deepEqual(withdrawn, [epoch]);
    assert.equal(deliveryState(f.deliveries, "run-1"), undefined);
    const offer = recordOf(f.offers()[0]?.payload);
    assert.deepEqual(await f.operator.claim("run-1", String(offer.deliveryId), epoch), {
      granted: false,
    });
    // With no brain standing, a new ask is refused in the fixed absent reason.
    const refused = await f.operator.submit({
      submissionId: "t",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    assert.deepEqual(refused, { outcome: "rejected", reason: "absent" });
  });

  test(`[${kind}] the run list and history changes reach the client as numbered events it can reconcile against`, async () => {
    const f = fixture(kind);
    const runs: number[] = [];
    f.operator.onRunsChanged((list) => runs.push(list.length));
    const history: string[] = [];
    f.operator.onHistoryChanged((change) =>
      history.push(`${change.sessionKey}:${change.entries.length}:${change.cleared}`),
    );
    await f.operator.submit({
      submissionId: "s",
      question: "q",
      origin: BRAIN_REQUEST_ORIGIN.TYPED,
    });
    f.report();
    f.service.historyChanged(
      MAIN_SESSION_KEY,
      [{ kind: CONVERSATION_ENTRY_KIND.TYPED_ASK, words: "q" }],
      "window-7",
    );
    f.service.historyChanged(MAIN_SESSION_KEY, []);
    assert.deepEqual(runs, [1]);
    assert.deepEqual(history, ["agent:main:main:1:false", "agent:main:main:0:true"]);
    const listed = await f.operator.runs();
    assert.equal(listed.length, 1);
    assert.equal(f.operator.client.lastSequence(), 3);
  });

  test(`[${kind}] a node the host needs that is not connected answers unavailable through the protocol`, async () => {
    const f = fixture(kind);
    const missing = await f.operator.client.call(GATEWAY_METHOD.NODE_INVOKE, {
      capability: "os.openExternal",
      params: { url: "https://example.test" },
    });
    assert.ok(missing.ok);
    assert.equal(recordOf(missing.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    const opened: string[] = [];
    f.service.nodes.register({
      nodeId: HOST_NATIVE_NODE_ID,
      capabilities: {
        "os.openExternal": (params) => {
          opened.push(String(params.url));
          return undefined;
        },
      },
    });
    const ok = await f.operator.client.call(GATEWAY_METHOD.NODE_INVOKE, {
      capability: "os.openExternal",
      params: { url: "https://example.test" },
    });
    assert.ok(ok.ok && recordOf(ok.result).status === NODE_CAPABILITY_STATUS.OK);
    assert.deepEqual(opened, ["https://example.test"]);
    // A registration over the wire binds the node to the connection it came
    // on: an ask of it is dispatched there and nowhere else, and a connection
    // that serves no handler answers unavailable, the ask never dispatched.
    const remote = await f.operator.client.call(GATEWAY_METHOD.NODE_REGISTER, {
      nodeId: "phone",
      capabilities: ["mic"],
    });
    assert.ok(remote.ok);
    const unserved = await f.operator.client.call(GATEWAY_METHOD.NODE_INVOKE, {
      capability: "mic",
      params: {},
    });
    assert.ok(unserved.ok);
    assert.equal(recordOf(unserved.result).status, NODE_CAPABILITY_STATUS.UNAVAILABLE);
    assert.ok(f.service.nodes.list().some((node) => node.nodeId === "phone" && node.connected));
  });
}
