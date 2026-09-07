import { type BrainRequestRecord, isTerminalBrainRequestStatus } from "@sidecar/brain/requests";
import {
  type BrainReplyClaimResult,
  type BrainReplyOffer,
  brainReplyWords,
} from "#shared/wire/brain";

/**
 * One reply owed to the developer's ear, after the run that produced it has
 * ended and its words already stand in History. Never persisted: a claimed
 * delivery may already have been audible, so a launch never replays one, and
 * an unclaimed one is worth nothing to a launch that did not watch the run.
 */
export interface BrainReplyDelivery {
  runId: string;
  deliveryId: string;
  /** The generation the run ended in; a claim from any other generation is refused. */
  generationId: string;
  claimed: boolean;
  /** The receiver epoch the offer went to, if it was sent at all. */
  offeredEpoch?: number;
}

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

/**
 * The one owner of which brain replies may still be spoken, and to whom. A
 * run's end reaches History through the publication owner; only once that
 * write and its mark have landed does the run become deliverable here, and
 * only if this process watched the run while it was still going: a run first
 * seen ended — the bootstrap after a launch, a follower's first report — may
 * already have been heard, and History holds its words either way.
 *
 * Every authorization to speak a run's end passes through here, whichever
 * way the words travel. The call that asked a spoken question may be granted
 * the words on the spot, in its tool's own output; otherwise the run is
 * offered, one at a time, to the receiver epoch that stands, claimed through
 * the main process before a word is spoken, and granted exactly once. A
 * duplicate offer, claim, or late callback finds the grant spent, and a
 * grant on the call spends the same one the offer would have. An offer the
 * receiver never claimed — the renderer reloaded or crashed with it in hand
 * — is offered again to the next epoch that reports ready; a claimed one
 * never is, because the words may already have been audible. What is
 * guaranteed is at most one grant per run, never that the grant was heard.
 */
export class BrainReplyDeliveries {
  readonly #options: BrainReplyDeliveriesOptions;
  /** Runs this process saw before they ended, the only ones it may deliver. */
  readonly #watched = new Set<string>();
  /** Runs whose words were granted to the call that asked them, and so are owed nothing more. */
  readonly #grantedOnCall = new Set<string>();
  readonly #deliveries = new Map<string, BrainReplyDelivery>();

  constructor(options: BrainReplyDeliveriesOptions) {
    this.#options = options;
  }

  /**
   * Follows the whole list of records as the brain reports it. A run seen
   * still going becomes watched; a run no longer in the list — pruned, or of
   * a generation since gone — is forgotten along with anything owed for it.
   */
  observe(records: readonly BrainRequestRecord[]): void {
    const present = new Set<string>();
    for (const record of records) {
      present.add(record.runId);
      if (!isTerminalBrainRequestStatus(record.status)) this.#watched.add(record.runId);
    }
    for (const runId of [...this.#watched]) if (!present.has(runId)) this.#forget(runId);
    for (const runId of [...this.#grantedOnCall]) if (!present.has(runId)) this.#forget(runId);
    for (const runId of [...this.#deliveries.keys()]) if (!present.has(runId)) this.#forget(runId);
  }

  /**
   * A run's end has reached History. Answers the delivery now owed for it, or
   * nothing: a run this process never watched running, one already owed,
   * claimed, or granted on its own call, adds nothing.
   */
  published(record: BrainRequestRecord, generationId: string): BrainReplyDelivery | undefined {
    if (!this.#deliverable(record)) return undefined;
    if (!this.#watched.has(record.runId) || this.#deliveries.has(record.runId)) return undefined;
    if (this.#grantedOnCall.has(record.runId)) return undefined;
    const delivery: BrainReplyDelivery = {
      runId: record.runId,
      deliveryId: this.#options.nextDeliveryId(),
      generationId,
      claimed: false,
    };
    this.#deliveries.set(record.runId, delivery);
    return delivery;
  }

  /**
   * The call that asked a spoken question, back from its wait with the run
   * ended, asking to say the words itself. Granted on the same terms as a
   * claim — receiver current under the epoch the caller named, generation
   * standing, the end written and marked — and only if no offer has already
   * been claimed for the run. The grant is the run's one: an offer already
   * out is withdrawn from the ledger by it, so the receiver's claim on that
   * offer is refused, and the run is never offered again.
   */
  grantOnCall(
    record: BrainRequestRecord,
    generationId: string,
    epoch: number,
    context: BrainReplyClaimContext,
  ): boolean {
    if (!this.#deliverable(record) || this.#grantedOnCall.has(record.runId)) return false;
    if (this.#deliveries.get(record.runId)?.claimed) return false;
    if (!context.receiverCurrent(epoch) || !context.generationStands(generationId)) return false;
    const live = context.liveRecord(record.runId);
    if (!live || !this.#deliverable(live)) return false;
    this.#deliveries.delete(record.runId);
    this.#grantedOnCall.add(record.runId);
    return true;
  }

  /** The deliveries not yet claimed, in the order their runs ended. */
  unclaimed(): readonly BrainReplyDelivery[] {
    return [...this.#deliveries.values()].filter((delivery) => !delivery.claimed);
  }

  /**
   * The one offer the receiver epoch given may hold now, or nothing. A
   * receiver holds at most one delivery at a time — offered, or claimed and
   * not yet acknowledged — so two completions flushed together cannot claim
   * each other's grant or talk over each other; the next is offered when the
   * one in hand is acknowledged. A new epoch owes nothing to the old one's
   * outstanding offer and is offered the oldest unclaimed at once.
   */
  nextOffer(epoch: number): BrainReplyOffer | undefined {
    for (const delivery of this.#deliveries.values()) {
      if (delivery.offeredEpoch === epoch) return undefined;
    }
    const head = this.unclaimed()[0];
    if (!head) return undefined;
    head.offeredEpoch = epoch;
    return { runId: head.runId, deliveryId: head.deliveryId, epoch };
  }

  /**
   * The receiver asking to speak one offered delivery, naming the epoch the
   * offer came under. Granted once, only when that epoch is the one the
   * offer went to and is still the current ready one — an epoch is never
   * inferred from what the main process holds now — for a run whose
   * generation still stands and whose live record still ends the way History
   * recorded. The words are read from that record at this moment, in the
   * same wording History holds. Anything else is refused, and a refusal for
   * a run the brain no longer holds forgets the delivery.
   */
  claim(
    runId: string,
    deliveryId: string,
    epoch: number,
    context: BrainReplyClaimContext,
  ): BrainReplyClaimResult {
    const delivery = this.#deliveries.get(runId);
    if (!delivery || delivery.deliveryId !== deliveryId || delivery.claimed) {
      return { granted: false };
    }
    if (delivery.offeredEpoch !== epoch || !context.receiverCurrent(epoch)) {
      return { granted: false };
    }
    if (!context.generationStands(delivery.generationId)) {
      this.#forget(runId);
      return { granted: false };
    }
    const live = context.liveRecord(runId);
    if (!live) {
      this.#forget(runId);
      return { granted: false };
    }
    const words = brainReplyWords(live);
    if (live.historyRecordedAt === undefined || words === undefined) return { granted: false };
    delivery.claimed = true;
    return { granted: true, words, origin: live.origin };
  }

  /**
   * The receiver reporting the claimed delivery it held done with — its reply
   * ended, cut short, or shown where it could not be spoken — under the epoch
   * it was granted to. A mismatch changes nothing. Answers whether the
   * receiver's hand is now empty, so the next may be offered.
   */
  acknowledge(runId: string, deliveryId: string, epoch: number): boolean {
    const delivery = this.#deliveries.get(runId);
    if (
      !delivery ||
      delivery.deliveryId !== deliveryId ||
      !delivery.claimed ||
      delivery.offeredEpoch !== epoch
    ) {
      return false;
    }
    this.#forget(runId);
    return true;
  }

  /** The generation ended — cleared, expired, or replaced — and everything owed with it. */
  reset(): void {
    this.#watched.clear();
    this.#grantedOnCall.clear();
    this.#deliveries.clear();
  }

  #deliverable(record: BrainRequestRecord): boolean {
    return (
      isTerminalBrainRequestStatus(record.status) &&
      record.historyRecordedAt !== undefined &&
      brainReplyWords(record) !== undefined
    );
  }

  #forget(runId: string): void {
    this.#watched.delete(runId);
    this.#grantedOnCall.delete(runId);
    this.#deliveries.delete(runId);
  }
}
