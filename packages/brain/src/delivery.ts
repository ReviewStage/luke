import type { WireRecord } from "@sidecar/wire";

/**
 * Where one delivery to the ear stands. Queued is owed and not yet offered to
 * any receiver; offered went to one receiver epoch and awaits its claim;
 * claimed was granted its words, once; the three terminal states say how it
 * ended. What the ledger guarantees is at most one grant to speak per
 * delivery, never that the grant was audible.
 */
export const DELIVERY_STATE = {
  QUEUED: "queued",
  OFFERED: "offered",
  CLAIMED: "claimed",
  ACKNOWLEDGED: "acknowledged",
  GRANTED_ON_CALL: "granted_on_call",
  WITHDRAWN: "withdrawn",
} as const;

export type DeliveryState = (typeof DELIVERY_STATE)[keyof typeof DELIVERY_STATE];

export const TERMINAL_DELIVERY_STATES: ReadonlySet<DeliveryState> = new Set<DeliveryState>([
  DELIVERY_STATE.ACKNOWLEDGED,
  DELIVERY_STATE.GRANTED_ON_CALL,
  DELIVERY_STATE.WITHDRAWN,
]);

export function isTerminalDeliveryState(state: DeliveryState): boolean {
  return TERMINAL_DELIVERY_STATES.has(state);
}

/**
 * One reply owed to the ear after its words already stand in Conversation. Never
 * persisted: a claimed delivery may already have been audible, so a launch
 * never replays one, and an unclaimed one is worth nothing to a launch that
 * did not watch the run.
 */
export interface DeliveryRecord {
  runId: string;
  deliveryId: string;
  /** The generation the run ended in; a claim from any other generation is refused. */
  generationId: string;
  state: DeliveryState;
  /** The receiver epoch the offer went to, if it was sent at all. */
  offeredEpoch?: number;
}

export interface DeliveryLedgerOptions {
  nextDeliveryId: () => string;
}

/** What a grant is checked against at the moment it lands: the receiver, the store, and the live record. */
export interface DeliveryClaimContext<Words> {
  /** Whether the receiver is ready and the epoch given is its current one. */
  receiverCurrent: (epoch: number) => boolean;
  /** Whether the generation named still stands in the store. */
  generationStands: (generationId: string) => boolean;
  /** Whether the host still holds the run at all; one it has let go of is forgotten here too. */
  runHeld: (runId: string) => boolean;
  /** The words the run's live record says now, or nothing for a run not deliverable at this moment. */
  liveWords: (runId: string) => Words | undefined;
}

export type DeliveryClaim<Words> = { granted: true; words: Words } | { granted: false };

export interface DeliveryOffer {
  runId: string;
  deliveryId: string;
  epoch: number;
}

/**
 * The one owner of which ended runs may still be spoken, and to whom, with
 * each delivery's state named. A run becomes deliverable only once its end
 * stands in Conversation and only if this ledger watched it while it was still
 * going: a run first seen ended — the bootstrap after a launch, a follower's
 * first report — may already have been heard, and Conversation holds its words
 * either way.
 *
 * Every authorization to speak a run's end passes through here, whichever
 * way the words travel. The call that asked a spoken question may be granted
 * the words on the spot; otherwise the run is offered, one at a time, to the
 * receiver epoch that stands, claimed before a word is spoken, and granted
 * exactly once. A duplicate offer, claim, or late callback finds the grant
 * spent. An offer the receiver never claimed — the renderer reloaded or
 * crashed with it in hand — goes back to queued and is offered again to the
 * next epoch that reports ready; a claimed one never is, because the words
 * may already have been audible. What is guaranteed is at most one grant per
 * run, never that the grant was heard.
 */
export class DeliveryLedger<Words> {
  readonly #options: DeliveryLedgerOptions;
  /** Runs this ledger saw before they ended, the only ones it may deliver. */
  readonly #watched = new Set<string>();
  readonly #deliveries = new Map<string, DeliveryRecord>();

  constructor(options: DeliveryLedgerOptions) {
    this.#options = options;
  }

  /**
   * Follows the whole list of runs as the host reports it. A run seen still
   * going becomes watched; a run no longer in the list — pruned, or of a
   * generation since gone — is forgotten along with anything owed for it.
   */
  observe(runs: readonly { runId: string; ended: boolean }[]): void {
    const present = new Set<string>();
    for (const run of runs) {
      present.add(run.runId);
      if (!run.ended) this.#watched.add(run.runId);
    }
    for (const runId of new Set([...this.#watched, ...this.#deliveries.keys()])) {
      if (!present.has(runId)) this.#forget(runId);
    }
  }

  /**
   * A run's end has reached Conversation. Answers the delivery now owed for it, or
   * nothing: a run this ledger never watched running, or one already owed,
   * claimed, or granted on its own call, adds nothing.
   */
  published(runId: string, generationId: string): DeliveryRecord | undefined {
    if (!this.#watched.has(runId) || this.#deliveries.has(runId)) return undefined;
    const delivery: DeliveryRecord = {
      runId,
      deliveryId: this.#options.nextDeliveryId(),
      generationId,
      state: DELIVERY_STATE.QUEUED,
    };
    this.#deliveries.set(runId, delivery);
    return delivery;
  }

  records(): readonly DeliveryRecord[] {
    return [...this.#deliveries.values()].map((delivery) => ({ ...delivery }));
  }

  /**
   * The call that asked a spoken question, back from its wait with the run
   * ended, asking to say the words itself. Granted on the same terms as a
   * claim — receiver current under the epoch the caller named, generation
   * standing, the words still there — and only if no offer has already been
   * claimed for the run. The grant is the run's one: an offer already out is
   * withdrawn by it, so the receiver's claim on that offer is refused.
   */
  grantOnCall(
    runId: string,
    generationId: string,
    epoch: number,
    context: DeliveryClaimContext<Words>,
  ): boolean {
    const held = this.#deliveries.get(runId);
    if (held && held.state !== DELIVERY_STATE.QUEUED && held.state !== DELIVERY_STATE.OFFERED) {
      return false;
    }
    if (!context.receiverCurrent(epoch) || !context.generationStands(generationId)) return false;
    if (context.liveWords(runId) === undefined) return false;
    this.#deliveries.set(runId, {
      runId,
      deliveryId: held?.deliveryId ?? this.#options.nextDeliveryId(),
      generationId,
      state: DELIVERY_STATE.GRANTED_ON_CALL,
    });
    return true;
  }

  /** The deliveries still owed and not yet in a receiver's hand, in the order their runs ended. */
  queued(): readonly DeliveryRecord[] {
    return [...this.#deliveries.values()].filter(
      (delivery) => delivery.state === DELIVERY_STATE.QUEUED,
    );
  }

  /**
   * The one offer the receiver epoch given may hold now, or nothing. A
   * receiver holds at most one delivery at a time — offered, or claimed and
   * not yet acknowledged — so two completions flushed together cannot claim
   * each other's grant or talk over each other. A new epoch owes nothing to
   * the old one's outstanding offer: that offer, never claimed, goes back to
   * queued and is the first one offered to the new epoch.
   */
  nextOffer(epoch: number): DeliveryOffer | undefined {
    for (const delivery of this.#deliveries.values()) {
      if (delivery.state === DELIVERY_STATE.OFFERED && delivery.offeredEpoch !== epoch) {
        delivery.state = DELIVERY_STATE.QUEUED;
        delete delivery.offeredEpoch;
      }
    }
    for (const delivery of this.#deliveries.values()) {
      if (
        delivery.offeredEpoch === epoch &&
        (delivery.state === DELIVERY_STATE.OFFERED || delivery.state === DELIVERY_STATE.CLAIMED)
      ) {
        return undefined;
      }
    }
    const head = this.queued()[0];
    if (!head) return undefined;
    head.offeredEpoch = epoch;
    head.state = DELIVERY_STATE.OFFERED;
    return { runId: head.runId, deliveryId: head.deliveryId, epoch };
  }

  /**
   * The receiver asking to speak one offered delivery, naming the epoch the
   * offer came under. Granted once, only when that epoch is the one the
   * offer went to and is still the current ready one, for a run whose
   * generation still stands and whose live record still has words. Anything
   * else is refused, and a refusal for a run the host no longer holds
   * forgets the delivery.
   */
  claim(
    runId: string,
    deliveryId: string,
    epoch: number,
    context: DeliveryClaimContext<Words>,
  ): DeliveryClaim<Words> {
    const delivery = this.#deliveries.get(runId);
    if (
      !delivery ||
      delivery.deliveryId !== deliveryId ||
      delivery.state !== DELIVERY_STATE.OFFERED
    ) {
      return { granted: false };
    }
    if (delivery.offeredEpoch !== epoch || !context.receiverCurrent(epoch)) {
      return { granted: false };
    }
    if (!context.generationStands(delivery.generationId) || !context.runHeld(runId)) {
      this.#forget(runId);
      return { granted: false };
    }
    const words = context.liveWords(runId);
    if (words === undefined) return { granted: false };
    delivery.state = DELIVERY_STATE.CLAIMED;
    return { granted: true, words };
  }

  /**
   * The receiver reporting the claimed delivery it held done with, under the
   * epoch it was granted to. A mismatch changes nothing. Answers whether the
   * receiver's hand is now empty, so the next may be offered.
   */
  acknowledge(runId: string, deliveryId: string, epoch: number): boolean {
    const delivery = this.#deliveries.get(runId);
    if (
      !delivery ||
      delivery.deliveryId !== deliveryId ||
      delivery.state !== DELIVERY_STATE.CLAIMED ||
      delivery.offeredEpoch !== epoch
    ) {
      return false;
    }
    delivery.state = DELIVERY_STATE.ACKNOWLEDGED;
    this.#forget(runId);
    return true;
  }

  /** The generation ended — cleared, expired, or replaced — and everything owed with it is withdrawn. */
  reset(): void {
    this.#watched.clear();
    this.#deliveries.clear();
  }

  #forget(runId: string): void {
    this.#watched.delete(runId);
    this.#deliveries.delete(runId);
  }
}

/** The delivery as the protocol lists it, for a client inspecting the ledger. */
export function deliveryRecordToWire(delivery: DeliveryRecord): WireRecord {
  return {
    runId: delivery.runId,
    deliveryId: delivery.deliveryId,
    generationId: delivery.generationId,
    state: delivery.state,
    ...(delivery.offeredEpoch !== undefined ? { offeredEpoch: delivery.offeredEpoch } : undefined),
  };
}
