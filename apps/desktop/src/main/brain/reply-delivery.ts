import {
  type BrainRequestOrigin,
  type BrainRequestRecord,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import { DeliveryLedger, type DeliveryOffer, type DeliveryRecord } from "@sidecar/runtime";
import { DELIVERY_STATE } from "@sidecar/runtime-contracts";
import { type BrainReplyClaimResult, brainReplyWords } from "#shared/wire/brain";

export interface BrainReplyDeliveriesOptions {
  nextDeliveryId: () => string;
}

/** What a grant is checked against at the moment it lands: the receiver, the store, and the live record. */
export interface BrainReplyClaimContext {
  /** Whether the receiver is ready and the epoch given is its current one. */
  receiverCurrent: (epoch: number) => boolean;
  /** Whether the generation named still stands in the store. */
  generationStands: (generationId: string) => boolean;
  /** The run's record as the standing brain holds it now, or nothing. */
  liveRecord: (runId: string) => BrainRequestRecord | undefined;
}

interface GrantedWords {
  words: string;
  origin: BrainRequestOrigin;
}

/**
 * The brain's replies over the shared delivery ledger: the ledger keeps the
 * states, the epochs, and the one grant per run; this owner reads a brain
 * record for whether its end is deliverable at all — ended, written and
 * marked in History, and wordable in History's own wording — and hands the
 * ledger the words at the moment of a grant, never the offer's. What is
 * guaranteed is at most one grant to speak per run, never that the grant was
 * heard.
 */
export class BrainReplyDeliveries {
  readonly #ledger: DeliveryLedger<GrantedWords>;

  constructor(options: BrainReplyDeliveriesOptions) {
    this.#ledger = new DeliveryLedger<GrantedWords>(options);
  }

  /** Follows the whole list of records as the brain reports it; a run no longer listed takes its delivery with it. */
  observe(records: readonly BrainRequestRecord[]): void {
    this.#ledger.observe(
      records.map((record) => ({
        runId: record.runId,
        ended: isTerminalBrainRequestStatus(record.status),
      })),
    );
  }

  /**
   * A run's end has reached History. Answers the delivery now owed for it, or
   * nothing: a run this process never watched running, one already owed,
   * claimed, or granted on its own call, adds nothing.
   */
  published(record: BrainRequestRecord, generationId: string): DeliveryRecord | undefined {
    if (!this.#deliverable(record)) return undefined;
    return this.#ledger.published(record.runId, generationId);
  }

  /**
   * The call that asked a spoken question, back from its wait with the run
   * ended, asking to say the words itself. Granted on the ledger's terms and
   * only for a record whose end stands in History now.
   */
  grantOnCall(
    record: BrainRequestRecord,
    generationId: string,
    epoch: number,
    context: BrainReplyClaimContext,
  ): boolean {
    if (!this.#deliverable(record)) return false;
    return this.#ledger.grantOnCall(record.runId, generationId, epoch, this.#context(context));
  }

  /** The deliveries not yet claimed — queued or offered — in the order their runs ended. */
  unclaimed(): readonly DeliveryRecord[] {
    return this.#ledger
      .records()
      .filter(
        (delivery) =>
          delivery.state === DELIVERY_STATE.QUEUED || delivery.state === DELIVERY_STATE.OFFERED,
      );
  }

  /** Every delivery the ledger holds, with its state, for inspection through the protocol. */
  records(): readonly DeliveryRecord[] {
    return this.#ledger.records();
  }

  /** The one offer the receiver epoch given may hold now, or nothing. */
  nextOffer(epoch: number): DeliveryOffer | undefined {
    return this.#ledger.nextOffer(epoch);
  }

  /**
   * The receiver asking to speak one offered delivery, naming the epoch the
   * offer came under. The words are read from the live record at this
   * moment, in the same wording History holds.
   */
  claim(
    runId: string,
    deliveryId: string,
    epoch: number,
    context: BrainReplyClaimContext,
  ): BrainReplyClaimResult {
    const claim = this.#ledger.claim(runId, deliveryId, epoch, this.#context(context));
    return claim.granted
      ? { granted: true, words: claim.words.words, origin: claim.words.origin }
      : { granted: false };
  }

  /** The receiver reporting the claimed delivery done with; answers whether its hand is now empty. */
  acknowledge(runId: string, deliveryId: string, epoch: number): boolean {
    return this.#ledger.acknowledge(runId, deliveryId, epoch);
  }

  /** The generation ended — cleared, expired, or replaced — and everything owed with it. */
  reset(): void {
    this.#ledger.reset();
  }

  #context(context: BrainReplyClaimContext) {
    return {
      receiverCurrent: context.receiverCurrent,
      generationStands: context.generationStands,
      runHeld: (runId: string) => context.liveRecord(runId) !== undefined,
      liveWords: (runId: string): GrantedWords | undefined => {
        const live = context.liveRecord(runId);
        if (!live || !this.#deliverable(live)) return undefined;
        const words = brainReplyWords(live);
        return words === undefined ? undefined : { words, origin: live.origin };
      },
    };
  }

  #deliverable(record: BrainRequestRecord): boolean {
    return (
      isTerminalBrainRequestStatus(record.status) &&
      record.historyRecordedAt !== undefined &&
      brainReplyWords(record) !== undefined
    );
  }
}
