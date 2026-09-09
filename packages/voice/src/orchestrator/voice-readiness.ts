/**
 * What the hidden voice window must have standing before the main process
 * may send it anything: each of these subscriptions, and the document
 * adopted. A surface installs its subscriptions in an order the main process
 * cannot see and must not assume, so readiness is not "mounted" or "an effect
 * ran": it is this ledger reporting that every named piece is in place, once,
 * under the receiver epoch the document's first adoption named.
 */
export const VOICE_READINESS_PART = {
  COMMANDS: "commands",
  SPEECH_OFFERS: "speech-offers",
  SPEECH_WITHDRAWALS: "speech-withdrawals",
  REPLY_OFFERS: "reply-offers",
  REPLY_WITHDRAWALS: "reply-withdrawals",
} as const;

export type VoiceReadinessPart = (typeof VOICE_READINESS_PART)[keyof typeof VOICE_READINESS_PART];

const EVERY_PART: readonly VoiceReadinessPart[] = Object.values(VOICE_READINESS_PART);

export class VoiceReadiness {
  readonly #installed = new Set<VoiceReadinessPart>();
  #epoch: number | undefined;
  #reported = false;
  readonly #report: (epoch: number) => void;

  constructor(report: (epoch: number) => void) {
    this.#report = report;
  }

  /** One subscription is standing. */
  installed(part: VoiceReadinessPart): void {
    this.#installed.add(part);
    this.#settle();
  }

  /** One subscription was torn down; a later install restores it, but nothing is re-reported. */
  uninstalled(part: VoiceReadinessPart): void {
    this.#installed.delete(part);
  }

  /** The document has been adopted, naming the epoch the main process gave this load. */
  bootstrapped(epoch: number | undefined): void {
    if (epoch === undefined) return;
    this.#epoch = epoch;
    this.#settle();
  }

  get complete(): boolean {
    return this.#epoch !== undefined && EVERY_PART.every((part) => this.#installed.has(part));
  }

  #settle(): void {
    if (this.#reported || !this.complete || this.#epoch === undefined) return;
    this.#reported = true;
    this.#report(this.#epoch);
  }
}
