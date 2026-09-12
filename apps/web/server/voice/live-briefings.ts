import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import type { BriefingDelivery } from "@sidecar/voice/live-session";
import type { ToolSet } from "ai";
import { Cause, Duration, Effect, type ParseResult, Schedule, type Scope } from "effect";
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
 *
 * The look is built in the socket's own scope and holds no runner: each look
 * is an effect its caller composes, and the schedule the start puts them on
 * is a fiber of that scope, so the socket detaching is what ends the looking.
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

/** How a look fails: the driver's own refusal, or a row the schema refused. */
type BriefingLookFailure = SqlError | ParseResult.ParseError;

/** What a look and the reads it composes answer, over the ambient client. */
type BriefingLookEffect<A> = Effect.Effect<A, BriefingLookFailure, SqlClient.SqlClient>;

export interface HostedBriefingsOptions {
  readonly userId: string;
  /** The speech module's store: the writer the claim is written through. */
  readonly speech: SpeechStore;
  /** The account's open offers, as the store lists them. */
  readonly offers: Pick<HostedStore["speech"], "open">;
  /** The tool registry the announcement's row is read back under. */
  readonly tools: ToolSet;
  /** The device the voice session belongs to, read from its row at each look; nothing while the row names none. */
  readonly deviceId: BriefingLookEffect<string | undefined>;
  /** Hands a claimed briefing to the service to speak. */
  readonly deliver: (delivery: HostedBriefingDelivery) => void;
  readonly now: () => number;
  readonly report: (message: string) => void;
  readonly bounds?: Partial<BriefingBounds>;
}

export interface HostedBriefings {
  /** One look at the open offers: reads, claims, and delivers what may be spoken now. */
  readonly look: BriefingLookEffect<void>;
  /**
   * Puts the looks on the schedule, on a fiber of the scope the briefings
   * were built in, until that scope closes; a second start while one stands
   * is the same start.
   */
  readonly start: Effect.Effect<void, never, SqlClient.SqlClient>;
}

export function hostedBriefings(
  options: HostedBriefingsOptions,
): Effect.Effect<HostedBriefings, never, Scope.Scope | SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const bounds = { ...HOSTED_BRIEFING_BOUNDS, ...options.bounds };
    const socket = yield* Effect.scope;
    let looking = false;

    function claimAndDeliver(offer: SpeechOffer, deviceId: string): BriefingLookEffect<void> {
      return Effect.gen(function* () {
        const words = yield* briefingWordsOf(options.tools, offer);
        if (words === undefined) {
          options.report(
            "A briefing on offer has no words this build can read; left for the sweep",
          );
          return;
        }
        const claimed = yield* claimSpeech(
          options.speech,
          options.userId,
          offer.messageId,
          deviceId,
          options.now(),
        );
        if (!claimed.ok) return;
        options.deliver({ briefing: words, decidedAt: options.now(), claim: claimed.claim });
      });
    }

    /** Every open offer of the account is read, so rows claimed or held elsewhere cannot fill a page ahead of a newer offer. */
    const look: BriefingLookEffect<void> = Effect.gen(function* () {
      const offers = yield* options.offers.open(options.userId);
      const open = offers
        .filter((offer) => offer.state === SPEECH_STATE.OFFERED)
        .slice(0, bounds.OFFERS_PER_LOOK);
      if (open.length === 0) return;
      const now = options.now();
      const quiet = yield* quietUntilByAccount(now, [options.userId]);
      if (quiet.has(options.userId)) return;
      const deviceId = yield* options.deviceId;
      if (deviceId === undefined) {
        options.report("Briefings are on offer, but the session names no device to claim them as");
        return;
      }
      for (const offer of open) yield* claimAndDeliver(offer, deviceId);
    });

    const onSchedule = Effect.repeat(
      Effect.catchAllCause(look, (cause) => {
        if (Cause.isInterruptedOnly(cause)) return Effect.failCause(cause);
        const failure = Cause.squash(cause);
        return Effect.sync(() => {
          options.report(
            `Looking at the briefings on offer failed: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        });
      }),
      Schedule.spaced(Duration.millis(bounds.POLL_MS)),
    );

    return {
      look,
      start: Effect.suspend(() => {
        if (looking) return Effect.void;
        looking = true;
        return Effect.asVoid(Effect.forkIn(onSchedule, socket));
      }),
    };
  });
}
