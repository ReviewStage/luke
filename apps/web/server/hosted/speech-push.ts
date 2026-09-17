import type { ToolSet } from "ai";
import { asc, desc, inArray } from "drizzle-orm";
import { Duration, Effect, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  BRIEFING_PUSH_PAYLOAD_KEY,
  DEVICE_PLATFORM,
  type DevicePlatform,
  isDevicePlatform,
  isPushEnvironment,
  type PushEnvironment,
} from "../core.js";
import { devices } from "../db/devices-schema.js";
import { db } from "../db/query.js";
import {
  APNS_DELIVERY,
  APNS_INTERRUPTION_LEVEL,
  type ApnsDelivery,
  type ApnsNotification,
} from "./apns.js";
import { briefingWordsOf } from "./briefing-words.js";
import type { DeviceSeams } from "./devices.js";
import { InstantColumnSchema } from "./store/database.js";
import {
  markSpeechPushed,
  openSpeechOffers,
  quietUntilByAccount,
  SPEECH_STATE,
  type SpeechOffer,
  type SpeechStore,
} from "./store/index.js";

/**
 * The push over the briefings on offer: the one way Luke's words reach a
 * developer who is not at a Mac that can say them. It runs on the
 * observation tick, after the sweep, and decides from two things it reads
 * and nothing it infers — how each offer stands, and what the account's
 * devices last reported of themselves. No speaking device active means the
 * words are pushed at once; one active but not claiming past a short grace
 * means the Mac is awake and Luke is not being heard there, so they are
 * pushed anyway; a claim means a device is saying them, and the offer is never
 * pushed, whatever became of the claim; and a quiet instant standing on any
 * device — a meeting its calendar hold observes, or the pause switch
 * restated as an instant — means nothing is pushed while it stands; the
 * offer expires on its own instant meanwhile, since the quiet mutes and
 * saves nothing. The quiet is read the way the briefing look reads it,
 * through the same query, and an account with quiet standing is left out of
 * the read of open offers entirely, so a long meeting's offers, the oldest
 * open rows, cannot fill the bound and starve every other account's push.
 *
 * The mark precedes the send. `markSpeechPushed` settles the offer under the
 * conversation's lock, refusing where a claim or another settlement landed
 * between the read and the lock, and only a mark that landed is sent; a
 * tick a minute later finds the offer settled and pushes nothing. What is
 * guaranteed is therefore at most one push per briefing, never that it
 * arrived: a send Apple refused or the network dropped is counted here and
 * retried nowhere, like a claim whose device fell silent. Such an answer
 * also ends the pass, since the credential or the gateway is what failed
 * and every send after it would settle another offer for nothing; the rest
 * stand for the next tick, as do the offers past the pass's own budget.
 *
 * The notification carries the briefing and one identifier of Luke's own.
 * Its words are Luke's, what he chose to say, and they are readable on a
 * locked screen, so the payload names no session, branch, path, or error
 * line beyond what those words themselves contain, and carries no thread or
 * collapse key. The one custom key is the pushed message's id, an opaque
 * UUID unique to that message, so the phone's tap opens the Conversation at
 * this briefing and not at whichever arrived after it; it correlates
 * nothing across pushes and means nothing to Apple. One device is addressed
 * — the account's most recently seen device holding a push token — because
 * a phone forwards its notifications to a paired watch itself, and two
 * pushes would be one briefing told twice.
 */

/**
 * The platforms whose reported presence is a reason to wait for a claim. A
 * platform joins this set when it can claim an offer and report the presence
 * that says it will, not when it can do either alone: the Mac reports itself
 * active from input and screen state and opens a session of its own for an
 * offer, so a Mac reporting itself active and not claiming inside the grace
 * is a Mac that will not claim at all. A standing phone or watch call claims
 * a briefing and speaks it exactly as a Mac's session does, since the
 * exchange behind either route claims as the session's device and never asks
 * what platform that device is, and such an offer is never pushed; but
 * neither opens a session for an offer, and each reports itself active only
 * while a screen of its own is up, so a phone or watch that is merely
 * present is pushed to at once rather than made to wait out a grace nobody
 * will use. Adding a platform here is a product decision that comes with
 * both halves, never a widening on its own.
 */
const SPEAKING_PLATFORMS: ReadonlySet<DevicePlatform> = new Set([DEVICE_PLATFORM.MACOS]);

export const SPEECH_PUSH = {
  /**
   * How long an active device is given to claim an offer before the words
   * are pushed instead. The Mac's live session claims within seconds of an
   * offer it will say; two ticks without a claim means it will not.
   */
  GRACE_MS: Duration.toMillis(Duration.minutes(2)),
  /**
   * How long one pass may spend before leaving the rest of the offers for
   * the next tick. The pass runs after the sweep and ahead of the
   * observation batches, all inside the tick's one budget, and a batch
   * starts only while a whole pass deadline still fits, so this bound plus
   * the one send that may still be waiting out its timeout when it is
   * reached must leave that room: the tick's test states the arithmetic.
   */
  BUDGET_MS: Duration.toMillis(Duration.seconds(10)),
} as const;

/** What the pass decided about one open offer, from its standing and its account's devices. */
export const SPEECH_PUSH_DECISION = {
  /** Nobody is placed to say it: push the words now. */
  PUSH: "push",
  /** A device is active and the grace has not run out; the next tick decides again. */
  WAIT: "wait",
  /** A device holds the claim; the offer is theirs and never pushed. */
  CLAIMED: "claimed",
  /** The offer's own instant has passed; the sweep's to end, never pushed stale. */
  DUE: "due",
} as const;

type SpeechPushDecision = (typeof SPEECH_PUSH_DECISION)[keyof typeof SPEECH_PUSH_DECISION];

/**
 * The rule, as a function of what was read: the offer's standing, and
 * whether any speaking device of its account reports itself active now. A
 * claimed offer is left to its claimant; one past its instant
 * to the sweep; and an offered one is pushed unless a device is active and
 * the grace since the offer has not run out.
 */
export function speechPushDecision(
  offer: SpeechOffer,
  active: boolean,
  now: number,
): SpeechPushDecision {
  if (offer.state === SPEECH_STATE.CLAIMED) return SPEECH_PUSH_DECISION.CLAIMED;
  if (offer.expiresAt <= now) return SPEECH_PUSH_DECISION.DUE;
  if (active && now - offer.offeredAt < SPEECH_PUSH.GRACE_MS) return SPEECH_PUSH_DECISION.WAIT;
  return SPEECH_PUSH_DECISION.PUSH;
}

/** A device the push can address: its row, and the token and gateway Apple issued it. */
interface PushableDevice {
  readonly deviceId: string;
  readonly token: string;
  readonly environment: PushEnvironment;
}

/**
 * The notification one briefing travels as: the words as the alert body,
 * the default sound, the ordinary interruption level — never
 * time-sensitive, which would break through a Focus the developer set — and
 * the message's id as the one custom key, which is what the tap opens the
 * Conversation at. No title, subtitle, or thread: the system draws the
 * app's own name, and everything else about the briefing stays on the
 * record.
 */
export function briefingNotification(
  briefing: string,
  messageId: string,
  device: PushableDevice,
): ApnsNotification {
  return {
    token: device.token,
    environment: device.environment,
    payload: {
      aps: {
        alert: { body: briefing },
        sound: "default",
        "interruption-level": APNS_INTERRUPTION_LEVEL.ACTIVE,
      },
      custom: { [BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID]: messageId },
    },
  };
}

/** What one pass did, as counts. */
export interface SpeechPushOutcome {
  /** Offers marked pushed whose notification Apple accepted. */
  readonly pushed: number;
  /** Offers marked pushed whose notification Apple refused, the network dropped, or a gone token could not take; settled, and retried nowhere. */
  readonly undelivered: number;
  /** Offers the rule would push whose account holds no device with a push token; left standing for the sweep. */
  readonly unaddressed: number;
  /** Offers the rule would push whose announcement this build could not read the words of; left standing for the sweep. */
  readonly unreadable: number;
  /** Offers left for the next tick because a device is active and inside the grace. */
  readonly waiting: number;
}

export interface SpeechPushSeams {
  readonly store: SpeechStore;
  /** The tool registry the announcement's row is read back under. */
  readonly tools: ToolSet;
  /** One notification to Apple, answered as the sender classifies the reply. */
  readonly send: (notification: ApnsNotification) => Promise<ApnsDelivery>;
  /** Removes the device row Apple said will never take another notification, scoped to its account. */
  readonly forgetDevice: DeviceSeams["forgetDevice"];
}

interface SpeechPushOptions {
  readonly now: number;
  /** The most open offers the pass reads, oldest first. */
  readonly limit?: number | undefined;
  /**
   * The accounts considered; every account where absent, which is the
   * tick's call. A caller over a database other accounts are writing at the
   * same time — a test file beside others on one Postgres — names its own.
   */
  readonly userIds?: readonly string[] | undefined;
  /** The wall clock the pass's budget is measured on; the system's where absent. */
  readonly clock?: (() => number) | undefined;
}

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type DeviceReadFailure = SqlError | Schema.SchemaError;

const DeviceRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  platform: Schema.String,
  activeUntil: Schema.NullOr(InstantColumnSchema),
  pushToken: Schema.NullOr(Schema.String),
  pushEnvironment: Schema.NullOr(Schema.String),
});

/** The rows most recently seen first, which is the order the one device a push addresses is taken in. */
const findDevicesByAccount = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: DeviceRowSchema,
  execute: (userIds) =>
    db
      .select({
        id: devices.id,
        userId: devices.userId,
        platform: devices.platform,
        activeUntil: devices.activeUntil,
        pushToken: devices.pushToken,
        pushEnvironment: devices.pushEnvironment,
      })
      .from(devices)
      .where(inArray(devices.userId, [...userIds]))
      .orderBy(desc(devices.lastSeenAt), asc(devices.id)),
});

/** Whether a speaking device of the account reports itself active, and the one device a push would address, most recently seen first. */
interface AccountDevices {
  readonly active: boolean;
  readonly target: PushableDevice | undefined;
}

function devicesByAccount(
  userIds: readonly string[],
  now: number,
): Effect.Effect<Map<string, AccountDevices>, DeviceReadFailure, SqlClient.SqlClient> {
  if (userIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(findDevicesByAccount([...userIds]), (rows) => {
    const byAccount = new Map<string, AccountDevices>();
    for (const row of rows) {
      const held = byAccount.get(row.userId) ?? { active: false, target: undefined };
      const active =
        held.active ||
        (isDevicePlatform(row.platform) &&
          SPEAKING_PLATFORMS.has(row.platform) &&
          row.activeUntil !== null &&
          row.activeUntil.getTime() > now);
      const target =
        held.target ??
        (row.pushToken !== null && isPushEnvironment(row.pushEnvironment)
          ? { deviceId: row.id, token: row.pushToken, environment: row.pushEnvironment }
          : undefined);
      byAccount.set(row.userId, { active, target });
    }
    return byAccount;
  });
}

/**
 * One pass over the open offers, oldest first: each decided against its
 * standing and its account's devices, and the ones decided for pushed —
 * marked first, sent only if the mark landed, the device row dropped where
 * Apple says its token is gone. Nothing here decides whether a briefing is
 * worth saying, rewords it, or reads anything of it but the words.
 */
export const pushSpeech = /* @__PURE__ */ Effect.fn("web/pushSpeech")(function* (
  seams: SpeechPushSeams,
  options: SpeechPushOptions,
): Effect.fn.Return<SpeechPushOutcome, SqlError | Schema.SchemaError, SqlClient.SqlClient> {
  const { now, limit, userIds, clock = Date.now } = options;
  const until = clock() + SPEECH_PUSH.BUDGET_MS;
  const outcome = { pushed: 0, undelivered: 0, unaddressed: 0, unreadable: 0, waiting: 0 };
  const quiet = yield* quietUntilByAccount(now, userIds);
  const offers = yield* openSpeechOffers({
    userIds,
    notUserIds: [...quiet.keys()],
    limit,
  });
  const reported = yield* devicesByAccount([...new Set(offers.map((offer) => offer.userId))], now);
  for (const offer of offers) {
    const account = reported.get(offer.userId) ?? { active: false, target: undefined };
    const decision = speechPushDecision(offer, account.active, now);
    if (decision === SPEECH_PUSH_DECISION.WAIT) outcome.waiting += 1;
    if (decision !== SPEECH_PUSH_DECISION.PUSH) continue;
    const target = account.target;
    if (target === undefined) {
      outcome.unaddressed += 1;
      continue;
    }
    const briefing = yield* briefingWordsOf(seams.tools, offer);
    if (briefing === undefined) {
      outcome.unreadable += 1;
      continue;
    }
    // Checked before the mark, so an offer the budget leaves for the next tick is never settled unsent.
    if (clock() >= until) break;
    const marked = yield* markSpeechPushed(
      seams.store,
      offer.userId,
      offer.messageId,
      now,
      target.deviceId,
    );
    if (Result.isFailure(marked)) continue;
    const delivery = yield* Effect.promise(() =>
      seams.send(briefingNotification(briefing, offer.messageId, target)),
    );
    if (delivery === APNS_DELIVERY.DELIVERED) {
      outcome.pushed += 1;
      continue;
    }
    outcome.undelivered += 1;
    if (delivery !== APNS_DELIVERY.TOKEN_GONE) break;
    yield* seams.forgetDevice(offer.userId, target.deviceId);
    reported.set(offer.userId, { active: account.active, target: undefined });
  }
  return outcome;
});
