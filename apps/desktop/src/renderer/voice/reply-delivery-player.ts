import type { BrainRequestOrigin } from "@sidecar/brain/requests";
import type { BrainReplyClaimResult, BrainReplyOffer } from "@sidecar/brain/requests-wire";
import { REALTIME_STATUS, type RealtimeStatus } from "@sidecar/realtime";
import { voiceExchangeActive } from "#shared/messages/voice-view";

/** The slice of the voice session a delivered reply is spoken through. */
export interface ReplyDeliverySession {
  readonly isConnected: boolean;
  readonly microphoneCall: boolean;
  readonly status: RealtimeStatus;
  speakReply(words: string, runId: string): boolean;
}

export interface ReplyDeliveryPlayerOptions {
  session: () => ReplyDeliverySession;
  /** Opens the developer's own call for the words when none stands; answers whether it did. */
  connect: () => Promise<boolean>;
  claim: (offer: BrainReplyOffer) => Promise<BrainReplyClaimResult>;
  acknowledge: (offer: BrainReplyOffer) => void;
  /** Puts words on the strip when the voice cannot say them. */
  showNotice: (words: string) => void;
  /** A delivered reply has begun speaking on the developer's call, answering an ask of the origin given. */
  onSpeaking: (origin: BrainRequestOrigin) => void;
  /** The History generation as this window holds it, which a Clear advances. */
  conversationGeneration: () => number;
}

/**
 * The receiving end of a reply delivery: the one offer this window holds from
 * the main process, and the one grant it is playing. The main process offers
 * one at a time and the next only after the acknowledgement, so nothing here
 * queues; what this owns is the boundary the words cross on the way to being
 * heard, and the checks on every side of each await.
 *
 * An offer is claimed only at a quiet moment — not while the developer is
 * talking or a reply is still under way, because a delivered reply is not
 * theirs to interrupt with, nor another reply's — and the identity of the
 * moment is captured first: the offer in hand, the History generation, and
 * this window's own withdrawal count. It is checked again after the claim
 * lands, after the call opens, and immediately before a word is spoken or
 * shown. A Clear, a withdrawn generation, or a newer offer arriving during
 * any of those awaits means the words granted are never spoken, shown, or
 * acknowledged: History holds them, and nothing re-stamps them with the
 * generation that came after.
 *
 * A grant is acknowledged when its reply has ended by any route — spoken to
 * the end, cut short by the developer, lost with the call — or at once when
 * the words could only be shown, so the next owed reply can be offered.
 */
interface HeldGrant {
  offer: BrainReplyOffer;
  words: string;
  origin: BrainRequestOrigin;
}

export class ReplyDeliveryPlayer {
  readonly #options: ReplyDeliveryPlayerOptions;
  #pending: BrainReplyOffer | undefined;
  /**
   * Words granted but not yet spoken: the developer took the turn, or a reply
   * was still under way, when the grant landed. Held here until a quiet
   * status, spoken then without a second claim, and voided by a withdrawal.
   */
  #granted: HeldGrant | undefined;
  #active: BrainReplyOffer | undefined;
  #withdrawals = 0;
  #attempting = false;

  constructor(options: ReplyDeliveryPlayerOptions) {
    this.#options = options;
  }

  get pending(): BrainReplyOffer | undefined {
    return this.#pending;
  }

  get active(): BrainReplyOffer | undefined {
    return this.#active;
  }

  /** The main process offering one ended run's reply; the same offer again is the same offer. */
  offer(offer: BrainReplyOffer): void {
    if (
      this.#pending?.deliveryId === offer.deliveryId ||
      this.#granted?.offer.deliveryId === offer.deliveryId ||
      this.#active?.deliveryId === offer.deliveryId
    ) {
      return;
    }
    this.#pending = offer;
    void this.#attempt();
  }

  /**
   * Everything offered or granted is void: the thread was cleared, or the
   * generation the words came from ended. Nothing is acknowledged — the main
   * process has already let go of it — and any attempt still in flight finds
   * its moment gone.
   */
  withdraw(): void {
    this.#withdrawals += 1;
    this.#pending = undefined;
    this.#granted = undefined;
    this.#active = undefined;
  }

  onStatus(status: RealtimeStatus): void {
    if (
      this.#active &&
      (status === REALTIME_STATUS.IDLE ||
        status === REALTIME_STATUS.FAILED ||
        status === REALTIME_STATUS.UNAVAILABLE)
    ) {
      // The call went with the reply on it: whatever was heard was heard.
      this.#settleActive();
    }
    void this.#attempt();
  }

  /** A reply naming a run ended; if it was the grant in hand, the hand is empty. */
  onReplyEnded(runId: string): void {
    if (this.#active?.runId !== runId) return;
    this.#settleActive();
    void this.#attempt();
  }

  #settleActive(): void {
    const active = this.#active;
    this.#active = undefined;
    if (active) this.#options.acknowledge(active);
  }

  /**
   * One pass at the offer or the held grant, at a quiet moment. The status is
   * read again after every await, because the developer may have taken the
   * turn while the claim or the call was out: words granted then are held,
   * not spoken over them, and the next quiet status speaks them.
   */
  async #attempt(): Promise<void> {
    if (this.#attempting || this.#active) return;
    const held = this.#granted;
    const offer = held?.offer ?? this.#pending;
    if (!offer || voiceExchangeActive(this.#options.session().status)) return;
    const generation = this.#options.conversationGeneration();
    const withdrawals = this.#withdrawals;
    const moved = () =>
      generation !== this.#options.conversationGeneration() || withdrawals !== this.#withdrawals;
    this.#attempting = true;
    try {
      let grant = held;
      if (!grant) {
        const claim = await this.#options.claim(offer);
        if (moved() || this.#pending !== offer) return;
        if (!claim.granted) {
          this.#pending = undefined;
          return;
        }
        grant = { offer, words: claim.words, origin: claim.origin };
        this.#granted = grant;
        this.#pending = undefined;
      }
      const session = this.#options.session();
      if (!session.isConnected || !session.microphoneCall) {
        const connected = await this.#options.connect();
        if (moved() || this.#granted !== grant) return;
        if (!connected) {
          this.#granted = undefined;
          this.#options.showNotice(grant.words);
          this.#options.acknowledge(grant.offer);
          return;
        }
      }
      // The developer may have taken the turn meanwhile: the grant waits for
      // the next quiet status rather than speaking over them.
      if (voiceExchangeActive(this.#options.session().status)) return;
      this.#granted = undefined;
      if (this.#options.session().speakReply(grant.words, grant.offer.runId)) {
        this.#active = grant.offer;
        this.#options.onSpeaking(grant.origin);
        return;
      }
      this.#options.showNotice(grant.words);
      this.#options.acknowledge(grant.offer);
    } finally {
      this.#attempting = false;
      // An offer that arrived while this attempt was out is the one in hand now.
      if (!this.#granted && this.#pending && this.#pending !== offer) void this.#attempt();
    }
  }
}
