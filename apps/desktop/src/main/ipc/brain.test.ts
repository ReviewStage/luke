/* oxlint-disable anti-slop/no-unknown-returns -- Fake Electron listeners deliberately retain the IPC boundary shape. */

import assert from "node:assert/strict";
import test from "node:test";
import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import { DeliveryLedger } from "@sidecar/brain";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "@sidecar/brain/requests";
import type { BrainAskWait, BrainReplyClaimResult } from "@sidecar/brain/requests-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GatewayClient,
  InProcessTransport,
} from "@sidecar/gateway";
import type { ConversationOperations } from "@sidecar/host";
import {
  createGatewayOperator,
  createGatewayService,
  type GrantedWords,
  VoiceReceiver,
} from "@sidecar/host";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import type { WebContents } from "electron";
import { ACT_KIND } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { brainActRows, brainReports } from "./brain";

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
    performedActions: 0,
    unknownActions: 0,
    askRecordedAt: NOW,
    ...overrides,
  };
}

/**
 * The grant boundary as the act router actually wires it: a real ledger and
 * receiver behind the real Gateway service, reached by the real brain rows
 * through the operator client over the in-process transport, for two windows
 * of different standing — so what is checked is what a renderer's act can and
 * cannot do across the whole boundary, not the ledger's own arguments.
 */
function registered(live: () => BrainRequestRecord | undefined) {
  // SAFETY: the rows read senders by identity alone; two distinct inert objects are two windows.
  const voiceSender = {} as WebContents;
  // SAFETY: a second inert object, so the rows read two distinct windows.
  const panelSender = {} as WebContents;
  let ids = 0;
  const deliveries = new DeliveryLedger<GrantedWords>({
    nextDeliveryId: () => `delivery-${++ids}`,
  });
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
    },
    // SAFETY: the grant boundary reaches no conversation operation; the fixture stands in for them.
    conversations: {} as ConversationOperations,
    memory: { status: () => ({}) },
    observedSessionCount: () => 0,
    deliveries,
    receiver,
    recordConversationEntry: () => true,
    now: () => NOW,
    createId: () => `id-${++ids}`,
  });
  const operator = createGatewayOperator({
    client: new GatewayClient({
      transport: new InProcessTransport(service.server, {
        clientId: "test-operator",
        role: GATEWAY_CLIENT_ROLE.OPERATOR,
      }),
      createId: () => `request-${++ids}`,
    }),
  });
  const dependencies = { operator, isVoice: (sender: WebContents) => sender === voiceSender };
  // SAFETY: only the brain rows are under test; the router dispatches on the
  // kind alone, so the kinds this fragment does not answer are never reached.
  const router = createActRouter(brainActRows(dependencies) as ActRows);
  const reports = brainReports(dependencies);
  const senderOf = (sender: WebContents): ActSender => ({
    sender,
    panel: sender === panelSender,
    voice: sender === voiceSender,
    introduction: false,
  });
  /**
   * What a row answered, read out of the router's outcome. A refusal fails
   * here rather than reading as a value: every trust check on this boundary
   * is a row answering, not the router turning one away.
   */
  const answered = async <Value>(
    outcome: Promise<{ status: string; value?: Value }>,
  ): Promise<Value> => {
    const settled = await outcome;
    assert.equal(settled.status, "done");
    assert.ok("value" in settled, "the act was carried");
    // SAFETY: a done outcome carries this kind's own value, which the assertion above established is present.
    return settled.value as Value;
  };
  service.server.subscribe((event) => {
    if (event.kind === GATEWAY_EVENT.DELIVERY_OFFERED) offered.push(event.payload);
  });
  const claim = (sender: WebContents, runId: string, deliveryId: string, epoch: number) =>
    answered<BrainReplyClaimResult>(
      router.performAct(
        { kind: ACT_KIND.BRAIN_CLAIM_REPLY, payload: { runId, deliveryId, epoch } },
        senderOf(sender),
      ),
    );
  const wait = (sender: WebContents, runId: string, epoch: number) =>
    answered<BrainAskWait>(
      router.performAct(
        { kind: ACT_KIND.BRAIN_WAIT_ASK, payload: { runId, epoch } },
        senderOf(sender),
      ),
    );
  const ack = async (sender: WebContents, runId: string, deliveryId: string, epoch: number) => {
    const before = deliveries.records().length;
    reports.ackBrainReply({ sender }, runId, deliveryId, epoch);
    await drainMicrotasks(1);
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
  const ended = record({ conversationRecordedAt: NOW + 2 });
  const f = registered(() => ended);
  const first = f.receiver.begin();
  f.receiver.markReady(first);
  f.deliveries.observe([{ runId: "run-1", ended: false }]);
  f.deliveries.published(ended.runId, "gen-1");
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

test("a wait grants the asking call the words only for the current voice renderer, once, and only after Conversation holds them", async () => {
  let live = record({ status: BRAIN_REQUEST_STATUS.RUNNING, conversationRecordedAt: undefined });
  const f = registered(() => live);
  const epoch = f.receiver.begin();
  f.receiver.markReady(epoch);
  f.deliveries.observe([{ runId: live.runId, ended: false }]);
  // Still running: the record, no grant. The record crossed the wire, so a
  // field the fixture left explicitly undefined is simply absent.
  assert.deepEqual(await f.wait(f.voiceSender, "run-1", epoch), {
    record: crossedWire(live),
    speak: false,
  });
  // Ended but not yet in Conversation — the write was refused — the call is not granted.
  live = record({ conversationRecordedAt: undefined });
  assert.equal((await f.wait(f.voiceSender, "run-1", epoch)).speak, false);
  // In Conversation now. A panel, or a renderer naming a stale epoch, is not granted and consumes nothing.
  live = record({ conversationRecordedAt: NOW + 2 });
  assert.equal((await f.wait(f.panelSender, "run-1", epoch)).speak, false);
  assert.equal((await f.wait(f.voiceSender, "run-1", epoch - 1)).speak, false);
  // The offer path had already offered it; the call's grant withdraws that offer.
  f.deliveries.published(live.runId, "gen-1");
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
