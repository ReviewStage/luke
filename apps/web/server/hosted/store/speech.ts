import { and, asc, eq, gt, inArray, isNull, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  SPEECH_EXPIRY_REASON,
  SPEECH_HELD_EVENT_PAYLOAD,
  SPEECH_OFFERED_EVENT_PAYLOAD,
  type SpeechEventKind,
  type SpeechExpiredEventPayload,
  type SpeechHeldEventPayload,
  type SpeechOfferedEventPayload,
  type SpeechSpokenEventPayload,
  TURN_ORIGIN,
  unparsedWire,
  type WireBoundaryInput,
} from "../../core.js";
import { devices } from "../../db/devices-schema.js";
import { conversations, events, messages } from "../../db/storage-schema.js";
import type { HostedStoreDatabase } from "./database.js";
import { STORE_WRITE_REFUSAL, type StoreWriter } from "./writer.js";

/**
 * A briefing's delivery as events on the assistant message that announced
 * it. `announce` puts the words on offer with an expiry; one device claims
 * the offer, and the claim is the one authorization to speak — an insert
 * under the partial unique index on `(message_id) where kind =
 * 'speech.claimed'`, so of two devices claiming at once exactly one lands
 * and the other is answered by name; the claimant reports it spoken, or the
 * service pushes it to a phone instead, or the expiry sweep marks it
 * unspoken. What is guaranteed is at most one authorization per briefing,
 * never that the words were heard, which is why the end is one of three
 * words rather than a boolean, and why a claimed briefing whose device
 * vanishes is never offered to anyone else: it expires.
 *
 * A hold is the one thing that suspends the clock. While any device of the
 * account reports a quiet instant still ahead — the end of a meeting its
 * calendar hold observes — each open offer is marked held, and a held offer
 * is neither claimed, pushed, nor expired. When the quiet lifts the offer is
 * not spoken stale: it ends unspoken with the release as its reason, and one
 * `hold_release` turn is queued on its conversation so the brain decides
 * again against the roster as it then is. The hold, the release, and the
 * expiry are the scheduled sweep's writes, below, which runs on the
 * observation tick; no transition a device or the service asks for writes
 * any of the three.
 *
 * Every transition is one event through the store writer, numbered by the
 * conversation's own event sequence and appended under the conversation's
 * row lock, and how an offer stands is folded from the speech events on its
 * message in that order — the latest one is the state. Nothing here reads
 * the words: the offer's payload is its expiry, the hold's the quiet
 * instant, the expiry's its reason, and the claim carries only the device.
 *
 * This module is the one door for a `speech.*` write. Each transition
 * carries the kinds whose standing excludes it, and the writer checks them
 * under the lock in the same transaction as the insert, so no transition can
 * land after a settled one and re-open it; the writer's own type refuses a
 * `speech.*` kind on a plain event write, so nothing outside this module
 * writes one. Two races, two mechanisms: a claim losing to another claim is
 * the partial unique index (`already_claimed`), and a transition losing to a
 * settled one is the exclusion check under the lock (`superseded`, answered
 * here as the refusal the offer's new standing names). Neither covers the
 * other.
 *
 * The order is a rule, not a detail: claim first, speak only if the claim
 * succeeded, never the other way round. A speaker that says the words and
 * only then finds it cannot claim leaves the offer unclaimed, so the sweep
 * expires it and a push may deliver the same briefing to another device —
 * the developer hears it twice, which is the one thing the claim exists to
 * rule out. `markSpeechSpoken` therefore admits the mark only from the
 * device that claimed, and a speaker with no claim has nothing to say.
 *
 * Who calls what: the relay offers, through `offerBriefing`, as it settles
 * an announce call; the claim and the spoken report are the live session
 * service's, the one speech sink, calling in process once it runs here (no
 * HTTP route claims, and none should); a push reads the standing to decide
 * and marks the offer pushed; and the sweep runs on the observation tick.
 */

export const SPEECH_OFFER = {
  /** How long an offer stands before the sweep marks it unspoken; a briefing about what just changed is stale past this. */
  TTL_MS: 15 * 60_000,
} as const;

const OPEN_OFFERS = {
  /** The most open offers one read answers, oldest first; the sweep's bound too, so the rest wait for the next minute. */
  MAX: 500,
} as const;

/** Where an offer stands: the latest speech event on its message. */
export const SPEECH_STATE = {
  OFFERED: "offered",
  CLAIMED: "claimed",
  HELD: "held",
  SPOKEN: "spoken",
  PUSHED: "pushed",
  EXPIRED: "expired",
} as const;

type SpeechState = (typeof SPEECH_STATE)[keyof typeof SPEECH_STATE];

const STATE_OF_KIND = {
  [CONVERSATION_EVENT_KIND.SPEECH_OFFERED]: SPEECH_STATE.OFFERED,
  [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED]: SPEECH_STATE.CLAIMED,
  [CONVERSATION_EVENT_KIND.SPEECH_HELD]: SPEECH_STATE.HELD,
  [CONVERSATION_EVENT_KIND.SPEECH_SPOKEN]: SPEECH_STATE.SPOKEN,
  [CONVERSATION_EVENT_KIND.SPEECH_PUSHED]: SPEECH_STATE.PUSHED,
  [CONVERSATION_EVENT_KIND.SPEECH_EXPIRED]: SPEECH_STATE.EXPIRED,
} as const satisfies Record<SpeechEventKind, SpeechState>;

/** The three states an offer has ended in; nothing moves it after one of these. */
const SETTLED_KINDS: readonly ConversationEventKind[] = [
  CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
  CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
  CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
];

export const SPEECH_REFUSAL = {
  /** No message by that id stands for this account. */
  NOT_FOUND: "not_found",
  /** The message is the account's, but nothing was ever offered on it. */
  NOT_OFFERED: "not_offered",
  /** The offer's expiry has passed; the sweep will mark it unspoken. */
  EXPIRED: "expired",
  /** A quiet instant holds it; nothing is claimed, pushed, or expired while it stands. */
  HELD: "held",
  /** Another device holds the one claim. */
  ALREADY_CLAIMED: "already_claimed",
  /** Spoken was reported on an offer nobody claimed. */
  NOT_CLAIMED: "not_claimed",
  /** Spoken was reported by a device other than the claimant. */
  NOT_CLAIMANT: "not_claimant",
  /** The offer already ended, spoken, pushed, or expired. */
  SETTLED: "settled",
} as const;

type SpeechRefusal = (typeof SPEECH_REFUSAL)[keyof typeof SPEECH_REFUSAL];

export type SpeechWriteResult =
  | { readonly ok: true; readonly id: string; readonly seq: number }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

export interface SpeechStore {
  readonly db: HostedStoreDatabase;
  readonly writer: Pick<StoreWriter, "recordEvent">;
}

/** How one offer stands, folded from every speech event on its message in sequence order. */
interface SpeechStanding {
  readonly state: SpeechState;
  /** Epoch milliseconds of the offer. */
  readonly offeredAt: number;
  /** Epoch milliseconds past which the offer stands for nothing; the offer's own payload, or its instant where that payload cannot be read. */
  readonly expiresAt: number;
  readonly claimedByDeviceId?: string;
  /** While held, the instant the quiet was last reported to end. */
  readonly quietUntil?: number;
}

/** An offer not yet ended, with the rows that place it. */
export interface SpeechOffer extends SpeechStanding {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

interface SpeechEventRow {
  readonly kind: ConversationEventKind;
  readonly deviceId: string | null;
  readonly payload: WireBoundaryInput;
  readonly createdAt: Date;
}

/** The standing the events fold to, or nothing where no offer is among them. */
function speechStandingOf(rows: readonly SpeechEventRow[]): SpeechStanding | undefined {
  let standing: SpeechStanding | undefined;
  for (const row of rows) {
    if (!isSpeechEventKind(row.kind)) continue;
    if (standing === undefined) {
      if (row.kind !== CONVERSATION_EVENT_KIND.SPEECH_OFFERED) continue;
      const offeredAt = row.createdAt.getTime();
      const payload = SPEECH_OFFERED_EVENT_PAYLOAD.parse(unparsedWire(row.payload));
      standing = {
        state: SPEECH_STATE.OFFERED,
        offeredAt,
        expiresAt: payload?.expiresAt ?? offeredAt,
      };
      continue;
    }
    // A second offer on the message is the same offer told again, never a state.
    if (row.kind === CONVERSATION_EVENT_KIND.SPEECH_OFFERED) continue;
    standing = { ...standing, state: STATE_OF_KIND[row.kind] };
    if (row.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED && row.deviceId !== null) {
      standing = { ...standing, claimedByDeviceId: row.deviceId };
    }
    if (row.kind === CONVERSATION_EVENT_KIND.SPEECH_HELD) {
      const held = SPEECH_HELD_EVENT_PAYLOAD.parse(unparsedWire(row.payload));
      standing = held === undefined ? standing : { ...standing, quietUntil: held.quietUntil };
    }
  }
  return standing;
}

/** The message's conversation, where the message is the account's and its conversation stands. */
async function conversationOfMessage(
  db: HostedStoreDatabase,
  userId: string,
  messageId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .innerJoin(
      conversations,
      and(eq(conversations.id, messages.conversationId), isNull(conversations.deletedAt)),
    )
    .where(and(eq(messages.id, messageId), eq(messages.userId, userId)));
  return row?.conversationId;
}

async function speechEventsOf(
  db: HostedStoreDatabase,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, readonly SpeechEventRow[]>> {
  const byMessage = new Map<string, SpeechEventRow[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({
      messageId: events.messageId,
      kind: events.kind,
      deviceId: events.deviceId,
      // The jsonb column as the unparsed boundary value it holds; the payload schemas above are what read it.
      payload: sql<WireBoundaryInput>`${events.payload}`,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(inArray(events.messageId, messageIds))
    .orderBy(asc(events.messageId), asc(events.seq));
  for (const row of rows) {
    const held = byMessage.get(row.messageId) ?? [];
    held.push(row);
    byMessage.set(row.messageId, held);
  }
  return byMessage;
}

type Located =
  | { readonly ok: true; readonly conversationId: string; readonly standing: SpeechStanding }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

/** The offer on one of the account's messages as it stands now, or why there is none to move. */
async function locate(
  db: HostedStoreDatabase,
  userId: string,
  messageId: string,
): Promise<Located> {
  const conversationId = await conversationOfMessage(db, userId, messageId);
  if (conversationId === undefined) return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  const standing = speechStandingOf((await speechEventsOf(db, [messageId])).get(messageId) ?? []);
  if (standing === undefined) return { ok: false, refusal: SPEECH_REFUSAL.NOT_OFFERED };
  return { ok: true, conversationId, standing };
}

/**
 * One transition an offer may take: the event it writes, the states it may
 * leave and the refusal every other state is answered with, and the kinds
 * whose presence on the message means it may not land — the same facts in
 * the writer's terms, checked again under the conversation's lock.
 */
interface SpeechTransition {
  readonly kind: SpeechEventKind;
  readonly refusals: Partial<Record<SpeechState, SpeechRefusal>>;
  readonly unless: readonly ConversationEventKind[];
}

const ENDED_REFUSALS = {
  [SPEECH_STATE.SPOKEN]: SPEECH_REFUSAL.SETTLED,
  [SPEECH_STATE.PUSHED]: SPEECH_REFUSAL.SETTLED,
  [SPEECH_STATE.EXPIRED]: SPEECH_REFUSAL.SETTLED,
} as const satisfies Partial<Record<SpeechState, SpeechRefusal>>;

/** A hold that stands, or one released into its expiry, leaves a `speech.held` on the message; either way the offer is not for taking. */
const NOT_OPEN_KINDS: readonly ConversationEventKind[] = [
  CONVERSATION_EVENT_KIND.SPEECH_HELD,
  ...SETTLED_KINDS,
];

const CLAIM: SpeechTransition = {
  kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  refusals: {
    [SPEECH_STATE.CLAIMED]: SPEECH_REFUSAL.ALREADY_CLAIMED,
    [SPEECH_STATE.HELD]: SPEECH_REFUSAL.HELD,
    ...ENDED_REFUSALS,
  },
  unless: NOT_OPEN_KINDS,
};

const SPOKEN: SpeechTransition = {
  kind: CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
  refusals: {
    [SPEECH_STATE.OFFERED]: SPEECH_REFUSAL.NOT_CLAIMED,
    [SPEECH_STATE.HELD]: SPEECH_REFUSAL.HELD,
    ...ENDED_REFUSALS,
  },
  unless: NOT_OPEN_KINDS,
};

const PUSHED: SpeechTransition = {
  kind: CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
  refusals: { [SPEECH_STATE.HELD]: SPEECH_REFUSAL.HELD, ...ENDED_REFUSALS },
  unless: NOT_OPEN_KINDS,
};

interface Move {
  readonly transition: SpeechTransition;
  readonly deviceId?: string | undefined;
  readonly payload?:
    | SpeechOfferedEventPayload
    | SpeechHeldEventPayload
    | SpeechSpokenEventPayload
    | undefined;
  /** A refusal the offer's standing alone decides, beyond its state: the expiry, the claimant. */
  readonly guard?: (standing: SpeechStanding) => SpeechRefusal | undefined;
}

/**
 * One transition, decided against the offer as it stands and landed only
 * while it still stands so: the writer refuses the event under the lock when
 * a kind it names as excluding it arrived between the read and the lock, and
 * the refusal answered is then the one the offer's new standing names.
 */
async function move(
  store: SpeechStore,
  userId: string,
  messageId: string,
  { transition, deviceId, payload, guard }: Move,
): Promise<SpeechWriteResult> {
  const located = await locate(store.db, userId, messageId);
  if (!located.ok) return located;
  const refusal = transition.refusals[located.standing.state] ?? guard?.(located.standing);
  if (refusal !== undefined) return { ok: false, refusal };
  const written = await store.writer.recordEvent(
    { userId, conversationId: located.conversationId },
    {
      messageId,
      kind: transition.kind,
      ...(deviceId !== undefined ? { deviceId } : undefined),
      ...(payload !== undefined ? { payload: unparsedWire(payload) } : undefined),
      unless: transition.unless,
    },
  );
  if (written.ok) return written;
  switch (written.refusal) {
    case STORE_WRITE_REFUSAL.ALREADY_CLAIMED:
      return { ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED };
    case STORE_WRITE_REFUSAL.SUPERSEDED: {
      const now = await locate(store.db, userId, messageId);
      return {
        ok: false,
        refusal: now.ok
          ? (transition.refusals[now.standing.state] ?? SPEECH_REFUSAL.SETTLED)
          : now.refusal,
      };
    }
    case STORE_WRITE_REFUSAL.NO_CONVERSATION:
    case STORE_WRITE_REFUSAL.NO_MESSAGE:
      return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  }
}

/**
 * Puts a briefing on offer on the message that announced it, expiring
 * `SPEECH_OFFER.TTL_MS` after `now`. An offer already standing on the message
 * is answered as it stands: the relay tells a settled call once, but the
 * event eve re-emits may reach it again.
 */
export async function offerSpeech(
  store: SpeechStore,
  userId: string,
  messageId: string,
  now: number,
): Promise<SpeechWriteResult> {
  const conversationId = await conversationOfMessage(store.db, userId, messageId);
  if (conversationId === undefined) return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  const standingOffer = () =>
    store.db
      .select({ id: events.id, seq: events.seq })
      .from(events)
      .where(
        and(
          eq(events.messageId, messageId),
          eq(events.kind, CONVERSATION_EVENT_KIND.SPEECH_OFFERED),
        ),
      );
  const [standing] = await standingOffer();
  if (standing !== undefined) return { ok: true, id: standing.id, seq: standing.seq };
  const written = await store.writer.recordEvent(
    { userId, conversationId },
    {
      messageId,
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      payload: unparsedWire({ expiresAt: now + SPEECH_OFFER.TTL_MS }),
      unless: [CONVERSATION_EVENT_KIND.SPEECH_OFFERED],
    },
  );
  if (written.ok) return written;
  switch (written.refusal) {
    case STORE_WRITE_REFUSAL.SUPERSEDED: {
      // The same offer landed from another caller between the read and the lock; it is the one to answer.
      const [landed] = await standingOffer();
      return landed === undefined
        ? { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND }
        : { ok: true, id: landed.id, seq: landed.seq };
    }
    case STORE_WRITE_REFUSAL.ALREADY_CLAIMED:
    case STORE_WRITE_REFUSAL.NO_CONVERSATION:
    case STORE_WRITE_REFUSAL.NO_MESSAGE:
      return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  }
}

/**
 * One device takes the offer, while it is offered, not yet due, and not
 * held. Two devices reading the same offer both reach the writer, which
 * re-reads the claim under the conversation's lock and answers the second
 * by name; the partial unique index stands behind that as the backstop.
 */
export function claimSpeech(
  store: SpeechStore,
  userId: string,
  messageId: string,
  deviceId: string,
  now: number,
): Promise<SpeechWriteResult> {
  return move(store, userId, messageId, {
    transition: CLAIM,
    deviceId,
    guard: (standing) => (standing.expiresAt <= now ? SPEECH_REFUSAL.EXPIRED : undefined),
  });
}

/**
 * The device that claimed the offer reports it said, with the voice session
 * and the instant on its clock where the caller has them; no other device
 * can, and nobody can for an unclaimed one.
 */
export function markSpeechSpoken(
  store: SpeechStore,
  userId: string,
  messageId: string,
  deviceId: string,
  spoken?: SpeechSpokenEventPayload,
): Promise<SpeechWriteResult> {
  return move(store, userId, messageId, {
    transition: SPOKEN,
    deviceId,
    payload: spoken,
    guard: (standing) =>
      standing.claimedByDeviceId === deviceId ? undefined : SPEECH_REFUSAL.NOT_CLAIMANT,
  });
}

/**
 * The service pushed the briefing to a device instead: from an offer nobody
 * claimed, or from a claim that never became speech, while the offer is not
 * yet due and not held. The device pushed to is recorded where the caller
 * names one.
 */
export function markSpeechPushed(
  store: SpeechStore,
  userId: string,
  messageId: string,
  now: number,
  deviceId?: string,
): Promise<SpeechWriteResult> {
  return move(store, userId, messageId, {
    transition: PUSHED,
    deviceId,
    guard: (standing) => (standing.expiresAt <= now ? SPEECH_REFUSAL.EXPIRED : undefined),
  });
}

export interface OpenSpeechOffersQuery {
  /** One account's offers; every account's where absent. */
  readonly userId?: string | undefined;
  /** Only these accounts' offers; every account's where absent. */
  readonly userIds?: readonly string[] | undefined;
  /** Accounts whose offers are left out: the sweep's read of the accounts with no quiet standing. */
  readonly notUserIds?: readonly string[] | undefined;
  readonly limit?: number | undefined;
}

/**
 * The offers not yet ended — no spoken, pushed, or expired event on their
 * message — over standing conversations, oldest offer first, each folded to
 * how it stands now.
 */
export async function openSpeechOffers(
  db: HostedStoreDatabase,
  query: OpenSpeechOffersQuery = {},
): Promise<readonly SpeechOffer[]> {
  const settled = alias(events, "settled");
  const offered = await db
    .select({
      userId: events.userId,
      conversationId: events.conversationId,
      messageId: events.messageId,
    })
    .from(events)
    .innerJoin(
      conversations,
      and(eq(conversations.id, events.conversationId), isNull(conversations.deletedAt)),
    )
    .where(
      and(
        eq(events.kind, CONVERSATION_EVENT_KIND.SPEECH_OFFERED),
        query.userId !== undefined ? eq(events.userId, query.userId) : undefined,
        query.userIds !== undefined ? inArray(events.userId, [...query.userIds]) : undefined,
        query.notUserIds !== undefined && query.notUserIds.length > 0
          ? notInArray(events.userId, [...query.notUserIds])
          : undefined,
        notExists(
          db
            .select({ id: settled.id })
            .from(settled)
            .where(
              and(eq(settled.messageId, events.messageId), inArray(settled.kind, SETTLED_KINDS)),
            ),
        ),
      ),
    )
    .orderBy(asc(events.createdAt), asc(events.conversationId), asc(events.seq))
    .limit(query.limit ?? OPEN_OFFERS.MAX);
  // A message told its offer twice is one offer; the first row keeps its place.
  const distinct = [...new Map(offered.map((row) => [row.messageId, row])).values()];
  const speech = await speechEventsOf(
    db,
    distinct.map((row) => row.messageId),
  );
  return distinct.flatMap((row) => {
    const standing = speechStandingOf(speech.get(row.messageId) ?? []);
    return standing === undefined ? [] : [{ ...row, ...standing }];
  });
}

/** What one sweep did, as counts. */
export interface SpeechSweepOutcome {
  /** Offers marked held because a device of the account reports quiet still ahead. */
  readonly held: number;
  /** Held offers whose quiet lifted, ended unspoken for the brain to decide again. */
  readonly released: number;
  /** Offers past their expiry, ended unspoken. */
  readonly expired: number;
  /** Turns queued for the brain to re-decide, one per conversation a release touched. */
  readonly turns: number;
}

/** The sweep's store: the writer's events path and, for a release, its turn queue. */
export interface SpeechSweepStore {
  readonly db: HostedStoreDatabase;
  readonly writer: Pick<StoreWriter, "recordEvent" | "enqueueTurn">;
}

export interface SpeechSweepOptions {
  readonly now: number;
  /** The most offers each of the sweep's reads takes: one read per account with quiet standing, one over every other account. */
  readonly limit?: number | undefined;
  /**
   * The accounts swept; every account where absent, which is the tick's
   * call. A caller over a database other accounts are writing at the same
   * time — a test file beside others on one Postgres — names its own.
   */
  readonly userIds?: readonly string[] | undefined;
}

/** The latest quiet instant still ahead among each account's devices; an account with none reports no hold. */
async function quietByAccount(
  db: HostedStoreDatabase,
  now: number,
  userIds: readonly string[] | undefined,
): Promise<ReadonlyMap<string, number>> {
  const rows = await db
    .select({ userId: devices.userId, quietUntil: sql<Date>`max(${devices.quietUntil})` })
    .from(devices)
    .where(
      and(
        gt(devices.quietUntil, new Date(now)),
        userIds !== undefined ? inArray(devices.userId, [...userIds]) : undefined,
      ),
    )
    .groupBy(devices.userId);
  return new Map(rows.map((row) => [row.userId, new Date(row.quietUntil).getTime()]));
}

/** One of the sweep's writes on an open offer, refused under the lock if the offer ended meanwhile; answers whether it landed. */
async function sweepWrite(
  store: SpeechSweepStore,
  offer: SpeechOffer,
  kind: typeof CONVERSATION_EVENT_KIND.SPEECH_HELD | typeof CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
  payload: SpeechHeldEventPayload | SpeechExpiredEventPayload,
): Promise<boolean> {
  const written = await store.writer.recordEvent(
    { userId: offer.userId, conversationId: offer.conversationId },
    { messageId: offer.messageId, kind, payload: unparsedWire(payload), unless: SETTLED_KINDS },
  );
  return written.ok;
}

/**
 * The scheduled pass over every open offer: held while a quiet instant of
 * its account stands ahead, re-held when that instant moved later, released
 * unspoken when the quiet has lifted — with one `hold_release` turn queued
 * on its conversation — and expired unspoken when its own instant has passed
 * with no hold over it. A held offer is never pushed or expired here, and
 * nothing here reads a briefing's words or decides whether one is worth
 * saying: that is the turn's, against the roster as it then is. The turn is
 * a queued `turns` row; what runs queued rows is the opener's, not the
 * sweep's.
 *
 * The read is split by account so a standing hold cannot starve the bound:
 * an offer held for an hour-long meeting stays open, and oldest, for sixty
 * ticks, and one bounded read over every account would fill with it. Each
 * account with quiet standing is read under its own bound and only held;
 * one read over every other account, held offers of quiet accounts left
 * out, releases and expires.
 */
export async function sweepSpeech(
  store: SpeechSweepStore,
  options: SpeechSweepOptions,
): Promise<SpeechSweepOutcome> {
  const { now, limit, userIds } = options;
  const quiet = await quietByAccount(store.db, now, userIds);
  const outcome = { held: 0, released: 0, expired: 0, turns: 0 };
  for (const [userId, quietUntil] of quiet) {
    for (const offer of await openSpeechOffers(store.db, { userId, limit })) {
      if (offer.state === SPEECH_STATE.HELD && (offer.quietUntil ?? 0) >= quietUntil) continue;
      if (await sweepWrite(store, offer, CONVERSATION_EVENT_KIND.SPEECH_HELD, { quietUntil })) {
        outcome.held += 1;
      }
    }
  }
  const released = new Set<string>();
  const unheld = await openSpeechOffers(store.db, {
    userIds,
    notUserIds: [...quiet.keys()],
    limit,
  });
  for (const offer of unheld) {
    if (offer.state === SPEECH_STATE.HELD) {
      const ended = await sweepWrite(store, offer, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED, {
        reason: SPEECH_EXPIRY_REASON.HOLD_RELEASED,
      });
      if (!ended) continue;
      outcome.released += 1;
      if (released.has(offer.conversationId)) continue;
      released.add(offer.conversationId);
      const queued = await store.writer.enqueueTurn(
        { userId: offer.userId, conversationId: offer.conversationId },
        { origin: TURN_ORIGIN.HOLD_RELEASE },
      );
      if (queued.ok) outcome.turns += 1;
      continue;
    }
    if (offer.expiresAt <= now) {
      const ended = await sweepWrite(store, offer, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED, {
        reason: SPEECH_EXPIRY_REASON.DUE,
      });
      if (ended) outcome.expired += 1;
    }
  }
  return outcome;
}
