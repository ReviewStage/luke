import assert from "node:assert/strict";
import {
  BRAIN_REQUEST_ORIGIN,
  BrainAgent,
  type BrainAgentOptions,
  BrainStateStore,
  DELIVERY_STATE,
  DeliveryLedger,
  type DeliveryRecord,
  responsesModelAnswer,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import { isTerminalBrainRequestStatus } from "@sidecar/brain/requests";
import type {
  BrainReplyClaimResult,
  BrainReplyOffer,
  BrainRequestSnapshot,
} from "@sidecar/brain/requests-wire";
import {
  type BareResponsesModel,
  bareModelAdapter,
  fakeBrainStateRepository,
} from "@sidecar/brain/testing";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import type { ModelResponse } from "@sidecar/runtime/vocabulary";
import {
  appendConversationThreadEntry,
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { BrainHost } from "../brain/host.js";
import { followBrainRequests } from "../brain/publication.js";
import { deliverable, type GrantedWords, ledgerContext } from "../service.js";
import { VoiceReceiver } from "../voice-receiver.js";
import { operatorOverBrain } from "./operator-over-brain.js";

/** The instant every clock in a brain fixture reads. */
export const BRAIN_HARNESS_NOW = 1_800_000_000_000;
const NOW = BRAIN_HARNESS_NOW;

/** A model that answers nothing until the test says so. */
export function heldModel(): BareResponsesModel & { release: (answer: ModelResponse) => void } {
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

/**
 * The real agent, store, host, follower, delivery ledger, receiver, and
 * submission path composed as the main process composes them, with only the
 * model and the disk synthetic.
 */
export function brainHarness() {
  const repository = fakeBrainStateRepository();
  let ids = 0;
  const store = new BrainStateStore({
    repository,
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
  // The delivery owner and the receiver, composed as the host composes
  // them: every report is observed before it is broadcast, every published
  // end is offered to a ready receiver, and readiness flushes what waited.
  const deliveries = new DeliveryLedger<GrantedWords>({
    nextDeliveryId: () => `delivery-${++ids}`,
  });
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
          deliveries.observe(
            snapshots.map((snapshot) => ({
              runId: snapshot.runId,
              ended: isTerminalBrainRequestStatus(snapshot.status),
            })),
          );
          broadcasts.push(snapshots);
        },
        onEndPublished: (ended) => {
          const generationId = store.generationId();
          if (generationId !== undefined && deliverable(ended)) {
            deliveries.published(ended.runId, generationId);
          }
          offerReplies();
        },
      }),
    publishEmpty: () => broadcasts.push([]),
  });
  /** Submits as a window does, through the operator over the standing brain; the ask's own line is written here. */
  const { submit } = operatorOverBrain({
    current: () => host.current(),
    recordConversationEntry: record,
  });
  const claimContext = () => ({
    receiverCurrent: (epoch: number) => receiver.isReady() && receiver.epoch() === epoch,
    generationStands: (generationId: string) => store.holdsGeneration(generationId),
    liveRecord: (runId: string) => host.current()?.request(runId),
  });
  const claim = (offer: BrainReplyOffer): BrainReplyClaimResult => {
    const granted = deliveries.claim(
      offer.runId,
      offer.deliveryId,
      offer.epoch,
      ledgerContext(claimContext()),
    );
    return granted.granted
      ? { granted: true, words: granted.words.words, origin: granted.words.origin }
      : { granted: false };
  };
  /** Queued or offered: everything owed that no receiver has taken in hand. */
  const unclaimed = (): readonly DeliveryRecord[] =>
    deliveries
      .records()
      .filter(
        (delivery) =>
          delivery.state === DELIVERY_STATE.QUEUED || delivery.state === DELIVERY_STATE.OFFERED,
      );
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
    await drainMicrotasks();
    const live = agent?.request(runId) ?? waited;
    if (live.conversationRecordedAt === undefined) return { record: live, speak: false };
    const generationId = store.generationId() ?? "";
    const speak =
      deliverable(live) &&
      deliveries.grantOnCall(live.runId, generationId, epoch, ledgerContext(claimContext()));
    if (speak) offerReplies();
    return { record: live, speak };
  };
  const submitMany = async (count: number, from = 0) => {
    const runIds: string[] = [];
    for (let index = from; index < from + count; index += 1) {
      const result = await submit({
        submissionId: `sub-${index}`,
        question: `ask ${index}`,
        origin: BRAIN_REQUEST_ORIGIN.TYPED,
      });
      assert.equal(result.outcome, "accepted");
      if (result.outcome === "accepted") runIds.push(result.runId);
    }
    return runIds;
  };
  const build = (client: BareResponsesModel, options: Partial<BrainAgentOptions> = {}) => {
    const model = bareModelAdapter(client);
    return new BrainAgent({
      ...options,
      runtime: toolLoopRuntimeOver(model),
      prepareTurn: () => ({ prompt: "instructions", layers: {} }),
      actions: { perform: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }) },
      roster: () => ({ text: "", identities: [] }),
      standingContext: () => "",
      readTranscript: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
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
    repository,
    store,
    host,
    build,
    submit,
    thread: () => thread,
    replies: (runId: string) =>
      thread.filter((e) => e.kind === CONVERSATION_ENTRY_KIND.REPLY && e.requestId === runId),
    submitMany,
    broadcasts,
    unclaimed,
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
export function answerOf(payload: WireRecord): ModelResponse {
  const answer = responsesModelAnswer(payload);
  assert.ok(answer);
  return answer;
}

/** The normalized answer for one assistant message. */
export function answered(text: string): ModelResponse {
  return answerOf({
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
  });
}
