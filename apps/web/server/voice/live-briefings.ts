import type { BriefingDelivery } from "@sidecar/voice/live-session";
import type { ToolSet } from "ai";
import { Deferred, Duration, Effect, FiberId, Schedule } from "effect";
import { briefingWordsOf } from "../hosted/briefing-words.js";
import type { HostedStore } from "../hosted/store/index.js";
import {
  claimSpeech,
  quietUntilByAccount,
  SPEECH_STATE,
  type SpeechClaim,
  type SpeechOffer,
  type SpeechStore,
} from "../hosted/store/speech.js";

/**
 * How a briefing reaches the hosted live session: the brain's `announce` put
 * it on offer as a `speech.offered` event on its own message, and while a
 * session stands this looks at the account's open offers on a schedule and,
 * for each still merely offered, reads the announcement's words, claims the
 * offer as the device the session belongs to, and only then hands the
 * briefing to the service to speak. The order is the rule and the type is
 * what keeps it: `HostedBriefingDelivery` carries the `SpeechClaim` only
 * `claimSpeech` mints, so a delivery without a landed claim does not compile,
 * and a claim the record refused — another device's, a hold, an expiry, an
 * offer already ended — delivers nothing, since a briefing spoken but not
 * recorded as claimed can be pushed again and heard twice. A session whose
 * row names no device claims nothing and speaks no briefing: a path that
 * cannot prove which device is speaking must not speak, and `device_id` is
 * null until the handshake that creates the row carries it. The hold is not
 * this module's: on the hosted path a held offer is `speech.held` on the
 * record, so nothing is queued or re-decided in the service, and the look
 * reads the account's quiet the way the sweep and the push do, so an offer
 * the minute's sweep has not yet marked held is still not spoken into a
 * meeting. A briefing is handed over as decided at its claim, not at its
 * offer: the record's own expiry is what says how long an offer stands, and
 * the service's staleness rule measures the wait from that decision to the
 * speech, so an offer minutes old that the record still holds open is said
 * rather than claimed and then dropped as stale on both paths.
 */

export interface HostedBriefingDelivery extends BriefingDelivery {
  /** The landed claim, which is what authorizes the words to be spoken and what the spoken mark is later written against. */
  readonly claim: SpeechClaim;
}

const HOSTED_BRIEFING_BOUNDS = {
  /** How often the account's open offers are looked at while a session stands; an offer is minutes old before it is stale. */
  POLL_MS: 2_000,
  /** The most offers one look claims, oldest first; the rest wait for the next look. */
  OFFERS_PER_LOOK: 8,
} as const;

type BriefingBounds = Readonly<Record<keyof typeof HOSTED_BRIEFING_BOUNDS, number>>;

export interface HostedBriefingsOptions {
  readonly userId: string;
  /** The speech module's store: the runner and the writer the claim is written through. */
  readonly speech: SpeechStore;
  /** The account's open offers, as the store lists them. */
  readonly offers: Pick<HostedStore["speech"], "open">;
  /** The tool registry the announcement's row is read back under. */
  readonly tools: ToolSet;
  /** The device the voice session belongs to, read from its row now; nothing while the row names none. */
  readonly deviceId: () => Promise<string | undefined>;
  /** Hands a claimed briefing to the service to speak. */
  readonly deliver: (delivery: HostedBriefingDelivery) => void;
  readonly now: () => number;
  readonly report: (message: string) => void;
  readonly bounds?: Partial<BriefingBounds>;
}

export interface HostedBriefings {
  /** One look at the open offers: reads, claims, and delivers what may be spoken now. */
  look(): Promise<void>;
  /** Looks on the schedule until `stop`; a second start while one stands is the same start. */
  start(): void;
  stop(): void;
}

export function hostedBriefings(options: HostedBriefingsOptions): HostedBriefings {
  const bounds = { ...HOSTED_BRIEFING_BOUNDS, ...options.bounds };
  let stopped: Deferred.Deferred<void> | undefined;

  async function claimAndDeliver(offer: SpeechOffer, deviceId: string): Promise<void> {
    const words = await briefingWordsOf(options.speech.run, options.tools, offer);
    if (words === undefined) {
      options.report("A briefing on offer has no words this build can read; left for the sweep");
      return;
    }
    const claimed = await claimSpeech(
      options.speech,
      options.userId,
      offer.messageId,
      deviceId,
      options.now(),
    );
    if (!claimed.ok) return;
    options.deliver({ briefing: words, decidedAt: options.now(), claim: claimed.claim });
  }

  /** Every open offer of the account is read, so rows claimed or held elsewhere cannot fill a page ahead of a newer offer. */
  async function look(): Promise<void> {
    const offers = await options.speech.run(options.offers.open(options.userId));
    const open = offers
      .filter((offer) => offer.state === SPEECH_STATE.OFFERED)
      .slice(0, bounds.OFFERS_PER_LOOK);
    if (open.length === 0) return;
    const now = options.now();
    const quiet = await options.speech.run(quietUntilByAccount(now, [options.userId]));
    if (quiet.has(options.userId)) return;
    const deviceId = await options.deviceId();
    if (deviceId === undefined) {
      options.report("Briefings are on offer, but the session names no device to claim them as");
      return;
    }
    for (const offer of open) await claimAndDeliver(offer, deviceId);
  }

  return {
    look,
    start() {
      if (stopped !== undefined) return;
      const ending = Deferred.unsafeMake<void>(FiberId.none);
      stopped = ending;
      const looking = Effect.repeat(
        Effect.promise(() => look()).pipe(
          Effect.catchAllDefect((defect) =>
            Effect.sync(() =>
              options.report(
                `Looking at the briefings on offer failed: ${defect instanceof Error ? defect.message : String(defect)}`,
              ),
            ),
          ),
        ),
        Schedule.spaced(Duration.millis(bounds.POLL_MS)),
      ).pipe(Effect.raceFirst(Deferred.await(ending)));
      void options.speech.run(looking).catch((error: Error) => {
        options.report(`The briefing look ended: ${error.message}`);
      });
    },
    stop() {
      if (stopped === undefined) return;
      Deferred.unsafeDone(stopped, Effect.void);
      stopped = undefined;
    },
  };
}
