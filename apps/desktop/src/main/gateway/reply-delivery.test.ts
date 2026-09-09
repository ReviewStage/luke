import assert from "node:assert/strict";
import test from "node:test";
import type { BrainRequestRecord } from "@sidecar/brain";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import { DeliveryLedger, type DeliveryRecord } from "@sidecar/runtime";
import { DELIVERY_STATE } from "@sidecar/runtime-contracts";
import type { BrainReplyClaimResult } from "#shared/messages/brain";
import {
  type BrainReplyClaimContext,
  deliverable,
  type GrantedWords,
  ledgerContext,
} from "./service";

const NOW = 1_800_000_000_000;

function record(overrides: Partial<BrainRequestRecord> = {}): BrainRequestRecord {
  return {
    runId: "run-1",
    submissionId: "sub-1",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.RUNNING,
    revision: 1,
    acceptedAt: NOW,
    startedAt: NOW + 1,
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
 * The ledger as the Gateway service drives it: the service's own `deliverable`
 * and `ledgerContext` over `DeliveryLedger`, so these cases exercise the
 * expressions production runs rather than a copy of them.
 */
function ledger() {
  let ids = 0;
  const deliveries = new DeliveryLedger<GrantedWords>({
    nextDeliveryId: () => `delivery-${++ids}`,
  });
  return {
    observe: (records: readonly BrainRequestRecord[]): void =>
      deliveries.observe(
        records.map((record) => ({
          runId: record.runId,
          ended: isTerminalBrainRequestStatus(record.status),
        })),
      ),
    published: (record: BrainRequestRecord, generationId: string): DeliveryRecord | undefined =>
      deliverable(record) ? deliveries.published(record.runId, generationId) : undefined,
    grantOnCall: (
      record: BrainRequestRecord,
      generationId: string,
      epoch: number,
      context: BrainReplyClaimContext,
    ): boolean =>
      deliverable(record) &&
      deliveries.grantOnCall(record.runId, generationId, epoch, ledgerContext(context)),
    claim: (
      runId: string,
      deliveryId: string,
      epoch: number,
      context: BrainReplyClaimContext,
    ): BrainReplyClaimResult => {
      const claim = deliveries.claim(runId, deliveryId, epoch, ledgerContext(context));
      return claim.granted
        ? { granted: true, words: claim.words.words, origin: claim.words.origin }
        : { granted: false };
    },
    acknowledge: (runId: string, deliveryId: string, epoch: number): boolean =>
      deliveries.acknowledge(runId, deliveryId, epoch),
    nextOffer: (epoch: number) => deliveries.nextOffer(epoch),
    reset: () => deliveries.reset(),
    /** Queued or offered: everything owed that no receiver has taken in hand. */
    unclaimed: (): readonly DeliveryRecord[] =>
      deliveries
        .records()
        .filter(
          (delivery) =>
            delivery.state === DELIVERY_STATE.QUEUED || delivery.state === DELIVERY_STATE.OFFERED,
        ),
  };
}

/** A receiver ready on the epoch given, a store holding "gen-1", and a brain holding the record given. */
function context(live: BrainRequestRecord | undefined, epoch = 1): BrainReplyClaimContext {
  return {
    receiverCurrent: (candidate) => candidate === epoch,
    generationStands: (generationId) => generationId === "gen-1",
    liveRecord: (runId) => (live && live.runId === runId ? live : undefined),
  };
}

test("only a run watched while it was still going becomes deliverable when its end is published", () => {
  const deliveries = ledger();
  // Seen ended first — the bootstrap after a launch — it may already have been heard.
  deliveries.observe([ended({ runId: "run-old" })]);
  assert.equal(deliveries.published(ended({ runId: "run-old" }), "gen-1"), undefined);
  deliveries.observe([ended({ runId: "run-old" }), record()]);
  // Ended but not yet in History: nothing is owed until the publication owner says so.
  assert.equal(deliveries.published(ended({ historyRecordedAt: undefined }), "gen-1"), undefined);
  const delivery = deliveries.published(ended(), "gen-1");
  assert.deepEqual(delivery, {
    runId: "run-1",
    deliveryId: "delivery-1",
    generationId: "gen-1",
    state: DELIVERY_STATE.QUEUED,
  });
  // The same end published again — a later report — adds no second delivery.
  assert.equal(deliveries.published(ended(), "gen-1"), undefined);
  assert.equal(deliveries.unclaimed().length, 1);
});

test("a receiver holds one offer at a time, and the next follows the acknowledgement under the same epoch", () => {
  const deliveries = ledger();
  deliveries.observe([record(), record({ runId: "run-2" })]);
  deliveries.published(ended(), "gen-1");
  deliveries.published(ended({ runId: "run-2" }), "gen-1");
  // Two completions flushed together: only the oldest goes out.
  assert.deepEqual(deliveries.nextOffer(1), { runId: "run-1", deliveryId: "delivery-1", epoch: 1 });
  assert.equal(deliveries.nextOffer(1), undefined);
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 1, context(ended())), {
    granted: true,
    words: "Two agents are waiting.",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  // Claimed and playing: still nothing more for this epoch.
  assert.equal(deliveries.nextOffer(1), undefined);
  // An acknowledgement under the wrong epoch or delivery changes nothing.
  assert.equal(deliveries.acknowledge("run-1", "delivery-1", 2), false);
  assert.equal(deliveries.acknowledge("run-1", "delivery-9", 1), false);
  assert.equal(deliveries.acknowledge("run-1", "delivery-1", 1), true);
  assert.equal(deliveries.acknowledge("run-1", "delivery-1", 1), false);
  assert.deepEqual(deliveries.nextOffer(1), { runId: "run-2", deliveryId: "delivery-2", epoch: 1 });
});

test("a delivery is granted once, to the epoch it was offered to, and every duplicate is refused", () => {
  const deliveries = ledger();
  deliveries.observe([record()]);
  assert.ok(deliveries.published(ended(), "gen-1"));
  // Unoffered, a claim is refused: nothing was sent to anyone.
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 1, context(ended())), {
    granted: false,
  });
  deliveries.nextOffer(1);
  // The wrong delivery id, or a claim naming another epoch, is refused — even
  // an epoch the receiver has since moved to.
  assert.deepEqual(deliveries.claim("run-1", "delivery-9", 1, context(ended())), {
    granted: false,
  });
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 2, context(ended(), 2)), {
    granted: false,
  });
  // The right epoch, but the receiver has moved on: refused.
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 1, context(ended(), 2)), {
    granted: false,
  });
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 1, context(ended())), {
    granted: true,
    words: "Two agents are waiting.",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  // The second claim and the re-publication find the grant spent.
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 1, context(ended())), {
    granted: false,
  });
  assert.equal(deliveries.published(ended(), "gen-1"), undefined);
  assert.deepEqual(deliveries.unclaimed(), []);
});

test("the words granted are read from the live record, in History's own wording, never from the offer", () => {
  const deliveries = ledger();
  deliveries.observe([record()]);
  deliveries.published(ended(), "gen-1");
  deliveries.nextOffer(1);
  const live = ended({ status: BRAIN_REQUEST_STATUS.FAILED, text: undefined, performedActs: 1 });
  assert.deepEqual(deliveries.claim("run-1", "delivery-1", 1, context(live)), {
    granted: true,
    words: "I did one thing you asked, but I couldn't put the reply into words.",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
});

test("a claim is refused, and the delivery forgotten, once the generation or the run is gone", () => {
  const deliveries = ledger();
  deliveries.observe([record(), record({ runId: "run-2" })]);
  deliveries.published(ended(), "gen-1");
  deliveries.published(ended({ runId: "run-2" }), "gen-1");
  deliveries.nextOffer(1);
  // The store no longer holds the generation the run ended in.
  assert.deepEqual(
    deliveries.claim("run-1", "delivery-1", 1, {
      ...context(ended()),
      generationStands: () => false,
    }),
    { granted: false },
  );
  deliveries.nextOffer(1);
  // The brain no longer holds the run — pruned, or replaced.
  assert.deepEqual(deliveries.claim("run-2", "delivery-2", 1, context(undefined)), {
    granted: false,
  });
  assert.deepEqual(deliveries.unclaimed(), []);
  assert.equal(deliveries.nextOffer(1), undefined);
  assert.equal(deliveries.published(ended(), "gen-1"), undefined);
});

test("a live record whose end is no longer in History, or cannot be worded, is not granted", () => {
  const deliveries = ledger();
  deliveries.observe([record()]);
  deliveries.published(ended(), "gen-1");
  deliveries.nextOffer(1);
  assert.deepEqual(
    deliveries.claim("run-1", "delivery-1", 1, context(ended({ historyRecordedAt: undefined }))),
    { granted: false },
  );
  assert.deepEqual(
    deliveries.claim("run-1", "delivery-1", 1, context(record({ historyRecordedAt: NOW }))),
    { granted: false },
  );
  // Still unclaimed: a refusal for a record that may yet be recorded spends nothing.
  assert.equal(deliveries.unclaimed().length, 1);
});

test("an unclaimed offer lost with its renderer is offered to the next epoch; a claimed one never is", () => {
  const deliveries = ledger();
  deliveries.observe([record(), record({ runId: "run-2" })]);
  deliveries.published(ended(), "gen-1");
  deliveries.published(ended({ runId: "run-2" }), "gen-1");
  // Epoch 1 is offered run-1, claims it, and dies before acknowledging.
  deliveries.nextOffer(1);
  deliveries.claim("run-1", "delivery-1", 1, context(ended()));
  // Epoch 2 owes nothing to epoch 1's hand: it is offered the next unclaimed
  // at once, and run-1 — possibly already heard — is never offered again.
  assert.deepEqual(deliveries.nextOffer(2), { runId: "run-2", deliveryId: "delivery-2", epoch: 2 });
  // Epoch 2 dies with run-2 offered but unclaimed; epoch 3 is offered it again.
  assert.deepEqual(deliveries.nextOffer(3), { runId: "run-2", deliveryId: "delivery-2", epoch: 3 });
  // The old epoch's claim, arriving late through a reloaded renderer, is refused.
  assert.deepEqual(deliveries.claim("run-2", "delivery-2", 2, context(ended(), 3)), {
    granted: false,
  });
  assert.deepEqual(
    deliveries.claim("run-2", "delivery-2", 3, context(ended({ runId: "run-2" }), 3)),
    { granted: true, words: "Two agents are waiting.", origin: BRAIN_REQUEST_ORIGIN.TYPED },
  );
});

test("the call that asked may be granted the words instead, once, and the offer path then yields to it", () => {
  const deliveries = ledger();
  const spoken = { runId: "run-s", origin: BRAIN_REQUEST_ORIGIN.SPOKEN } as const;
  deliveries.observe([record(spoken)]);
  // The end reached History and was offered, but the asking call comes back first.
  deliveries.published(ended(spoken), "gen-1");
  deliveries.nextOffer(1);
  assert.equal(deliveries.grantOnCall(ended(spoken), "gen-1", 1, context(ended(spoken))), true);
  // The receiver's claim on the offer is refused: the run's one grant is spent.
  assert.deepEqual(deliveries.claim("run-s", "delivery-1", 1, context(ended(spoken))), {
    granted: false,
  });
  // Neither a second on-call grant nor a later publication owes anything more.
  assert.equal(deliveries.grantOnCall(ended(spoken), "gen-1", 1, context(ended(spoken))), false);
  assert.equal(deliveries.published(ended(spoken), "gen-1"), undefined);
  assert.equal(deliveries.nextOffer(1), undefined);
});

test("the call is refused the words once an offer was claimed, or before the end stands in History", () => {
  const deliveries = ledger();
  const spoken = { runId: "run-s", origin: BRAIN_REQUEST_ORIGIN.SPOKEN } as const;
  deliveries.observe([record(spoken)]);
  // The end is not yet marked in History: nobody is granted anything.
  assert.equal(
    deliveries.grantOnCall(
      ended({ ...spoken, historyRecordedAt: undefined }),
      "gen-1",
      1,
      context(ended({ ...spoken, historyRecordedAt: undefined })),
    ),
    false,
  );
  deliveries.published(ended(spoken), "gen-1");
  deliveries.nextOffer(1);
  deliveries.claim("run-s", "delivery-1", 1, context(ended(spoken)));
  // Claimed by the offer path: the call is refused, whatever its epoch.
  assert.equal(deliveries.grantOnCall(ended(spoken), "gen-1", 1, context(ended(spoken))), false);
  // A caller whose epoch is not the current one — a reloaded renderer's
  // abandoned wait — is refused too, and consumes nothing.
  deliveries.observe([
    record(spoken),
    record({ runId: "run-t", origin: BRAIN_REQUEST_ORIGIN.SPOKEN }),
  ]);
  const later = ended({ runId: "run-t", origin: BRAIN_REQUEST_ORIGIN.SPOKEN });
  deliveries.published(later, "gen-1");
  assert.equal(deliveries.grantOnCall(later, "gen-1", 1, context(later, 2)), false);
  assert.equal(
    deliveries.unclaimed().some((delivery) => delivery.runId === "run-t"),
    true,
  );
});

test("a run that leaves the brain's list, and a generation that ends, take their deliveries with them", () => {
  const deliveries = ledger();
  deliveries.observe([record(), record({ runId: "run-2" })]);
  deliveries.published(ended(), "gen-1");
  // Pruned: the list no longer carries run-1.
  deliveries.observe([record({ runId: "run-2" })]);
  assert.deepEqual(deliveries.unclaimed(), []);
  assert.equal(deliveries.published(ended(), "gen-1"), undefined);
  // run-2 is still watched and ends; then the generation is cleared.
  assert.ok(deliveries.published(ended({ runId: "run-2" }), "gen-1"));
  deliveries.reset();
  assert.deepEqual(deliveries.unclaimed(), []);
  // A run of the cleared generation is not watched by the fresh one either.
  assert.equal(deliveries.published(ended({ runId: "run-2" }), "gen-2"), undefined);
});
