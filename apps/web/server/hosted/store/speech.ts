import { readEither } from "@sidecar/wire/effect";
import { and, asc, eq, gt, inArray, isNull, max, notExists, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isSpeechEventKind,
  SPEECH_EXPIRY_REASON,
  SPEECH_OFFERED_EVENT_PAYLOAD,
  type SpeechEventKind,
  type SpeechExpiredEventPayload,
  type SpeechOfferedEventPayload,
  type SpeechSpokenEventPayload,
  unparsedWire,
  WireValueSchema,
} from "../../core.js";
import { devices } from "../../db/devices-schema.js";
import { db } from "../../db/query.js";
import { conversations, events, messages } from "../../db/storage-schema.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "./database.js";
import { ConversationEventKindSchema, STORE_WRITE_REFUSAL, type StoreWriter } from "./writer.js";

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
 * A quiet instant — the end of a meeting a Mac's calendar hold observes, or
 * the pause switch restated as an instant — mutes the account and nothing
 * more: the push pass and the briefing look leave a quiet account's offers
 * out of their reads, and an offer made under the quiet expires on its own
 * instant like any other, unspoken. Nothing is saved for later and nothing
 * is decided again; the next scheduled observation reports the roster as it
 * then stands. The expiry is the scheduled sweep's write, below, which runs
 * on the observation tick; no transition a device or the service asks for
 * writes it.
 *
 * A push is the other way an offer ends without a claim: the service sends
 * the words to a phone when no device is placed to say them, and marks the
 * offer pushed before it sends, so a second tick finds it settled and the
 * push happens at most once. A claimed offer is never pushed, whatever
 * became of the claim: the claim is exclusive and is never handed on, so a
 * push racing a claim lands only if it reached the lock first, and the
 * developer never hears one briefing from two devices.
 *
 * Every transition is one event through the store writer, numbered by the
 * conversation's own event sequence and appended under the conversation's
 * row lock, and how an offer stands is folded from the speech events on its
 * message in that order — the latest one is the state. Nothing here reads
 * the words: the offer's payload is its expiry, the expiry's its reason,
 * and the claim carries only the device.
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
 * other. And the two ends a claim may meet are not symmetric: the sweep may
 * expire a claimed offer, because a device that claimed and vanished must
 * not hold a briefing forever and expiry is cleanup, but nothing may push
 * over a claim, because a push is a second delivery and the harm is the
 * developer hearing the same briefing twice. Expire may follow a claim; push
 * may not.
 *
 * The order is a rule, not a detail: claim first, speak only if the claim
 * succeeded, never the other way round. A speaker that says the words and
 * only then finds it cannot claim leaves the offer unclaimed, so the sweep
 * expires it and a push may deliver the same briefing to another device —
 * the developer hears it twice, which is the one thing the claim exists to
 * rule out. `markSpeechSpoken` therefore admits the mark only from the
 * device that claimed, and a speaker with no claim has nothing to say.
 *
 * Every read below is an `Effect<A, SqlError | SchemaError, SqlClient>` whose
 * rows a `Schema` decodes rather than trusts; the transitions stay promises,
 * because their writes are the store writer's, and each runs its reads
 * through the runner its caller's edge composed.
 *
 * Who calls what: the relay offers, through `offerBriefing`, as it settles
 * an announce call; the claim and the spoken report are the live session
 * service's, the one speech sink, calling in process once it runs here (no
 * HTTP route claims, and none should); the push pass (`speech-push.ts`)
 * reads the standing and the account's devices to decide, marks the offer
 * pushed through `markSpeechPushed`, and only then sends; and the sweep runs
 * on the observation tick.
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
  SPOKEN: "spoken",
  PUSHED: "pushed",
  EXPIRED: "expired",
} as const;

type SpeechState = (typeof SPEECH_STATE)[keyof typeof SPEECH_STATE];

const STATE_OF_KIND = {
  [CONVERSATION_EVENT_KIND.SPEECH_OFFERED]: SPEECH_STATE.OFFERED,
  [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED]: SPEECH_STATE.CLAIMED,
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

type SpeechWriteResult =
  | { readonly ok: true; readonly id: string; readonly seq: number }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

declare const SPEECH_CLAIM: unique symbol;

/**
 * The one authorization to speak a briefing, minted here by `claimSpeech`
 * alone once the claim has landed on the record, and by nothing else: the
 * brand is a symbol no other module can spell, so a briefing append that
 * takes a claim can be handed only what a landed claim answered, and
 * "appended without claiming" is a call that does not compile rather than a
 * rule to remember. It names what was claimed and by whom, which is what the
 * spoken mark is later written against.
 */
export interface SpeechClaim {
  readonly [SPEECH_CLAIM]: true;
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly deviceId: string;
}

type SpeechClaimResult =
  | { readonly ok: true; readonly id: string; readonly seq: number; readonly claim: SpeechClaim }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

export interface SpeechStore {
  readonly writer: Pick<StoreWriter, "recordEvent">;
}

/** What every transition here answers: an effect over the ambient client, run by whoever composed the request. */
type SpeechEffect<A> = Effect.Effect<A, SpeechReadFailure, SqlClient.SqlClient>;

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type SpeechReadFailure = SqlError | Schema.SchemaError;

/** How one offer stands, folded from every speech event on its message in sequence order. */
interface SpeechStanding {
  readonly state: SpeechState;
  /** Epoch milliseconds of the offer. */
  readonly offeredAt: number;
  /** Epoch milliseconds past which the offer stands for nothing; the offer's own payload, or its instant where that payload cannot be read. */
  readonly expiresAt: number;
  readonly claimedByDeviceId?: string;
}

/**
 * One event on a message, as the `events` row holds it. The payload is the
 * `jsonb` column read as the wire value it is, which the payload schemas
 * above are what hold to a shape; the kind is one of the vocabulary's own,
 * so a row naming anything else is refused rather than folded.
 */
const SpeechEventRowSchema = Schema.Struct({
  messageId: Schema.String,
  kind: ConversationEventKindSchema,
  deviceId: Schema.NullOr(Schema.String),
  payload: WireValueSchema,
  createdAt: InstantColumnSchema,
});

type SpeechEventRow = Schema.Schema.Type<typeof SpeechEventRowSchema>;

/** The conversation a message belongs to, where the message is the account's and its conversation stands. */
const MessageConversationSchema = Schema.Struct({ conversationId: Schema.String });

const MessageKeySchema = Schema.Struct({
  userId: Schema.String,
  messageId: Schema.String,
});

/** Where an event landed, which is what an offer already standing answers with. */
const EventPositionSchema = Schema.Struct({
  id: Schema.String,
  seq: EpochMillisColumnSchema,
});

const findMessageConversation = SqlSchema.findOneOption({
  Request: MessageKeySchema,
  Result: MessageConversationSchema,
  execute: (key) =>
    db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .innerJoin(
        conversations,
        and(eq(conversations.id, messages.conversationId), isNull(conversations.deletedAt)),
      )
      .where(and(eq(messages.id, key.messageId), eq(messages.userId, key.userId))),
});

const findSpeechEvents = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: SpeechEventRowSchema,
  execute: (messageIds) =>
    db
      .select({
        messageId: events.messageId,
        kind: events.kind,
        deviceId: events.deviceId,
        payload: events.payload,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(inArray(events.messageId, [...messageIds]))
      .orderBy(asc(events.messageId), asc(events.seq)),
});

const findOfferedEvent = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: EventPositionSchema,
  execute: (messageId) =>
    db
      .select({ id: events.id, seq: events.seq })
      .from(events)
      .where(
        and(
          eq(events.messageId, messageId),
          eq(events.kind, CONVERSATION_EVENT_KIND.SPEECH_OFFERED),
        ),
      ),
});

/** The standing the events fold to, or nothing where no offer is among them. */
function speechStandingOf(rows: readonly SpeechEventRow[]): SpeechStanding | undefined {
  let standing: SpeechStanding | undefined;
  for (const row of rows) {
    if (!isSpeechEventKind(row.kind)) continue;
    if (standing === undefined) {
      if (row.kind !== CONVERSATION_EVENT_KIND.SPEECH_OFFERED) continue;
      const offeredAt = row.createdAt.getTime();
      const payload = Result.getOrUndefined(readEither(SPEECH_OFFERED_EVENT_PAYLOAD)(row.payload));
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
  }
  return standing;
}

function speechEventsOf(
  messageIds: readonly string[],
): Effect.Effect<
  ReadonlyMap<string, readonly SpeechEventRow[]>,
  SpeechReadFailure,
  SqlClient.SqlClient
> {
  if (messageIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(findSpeechEvents(messageIds), (rows) => {
    const byMessage = new Map<string, SpeechEventRow[]>();
    for (const row of rows) {
      const held = byMessage.get(row.messageId) ?? [];
      held.push(row);
      byMessage.set(row.messageId, held);
    }
    return byMessage;
  });
}

type Located =
  | { readonly ok: true; readonly conversationId: string; readonly standing: SpeechStanding }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

/** The offer on one of the account's messages as it stands now, or why there is none to move. */
const locate = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  messageId: string,
): Effect.fn.Return<Located, SpeechReadFailure, SqlClient.SqlClient> {
  const conversation = yield* findMessageConversation({ userId, messageId });
  if (Option.isNone(conversation)) return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  const events = yield* speechEventsOf([messageId]);
  const standing = speechStandingOf(events.get(messageId) ?? []);
  if (standing === undefined) return { ok: false, refusal: SPEECH_REFUSAL.NOT_OFFERED };
  return { ok: true, conversationId: conversation.value.conversationId, standing };
});

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

const CLAIM: SpeechTransition = {
  kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  refusals: {
    [SPEECH_STATE.CLAIMED]: SPEECH_REFUSAL.ALREADY_CLAIMED,
    ...ENDED_REFUSALS,
  },
  unless: SETTLED_KINDS,
};

const SPOKEN: SpeechTransition = {
  kind: CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
  refusals: {
    [SPEECH_STATE.OFFERED]: SPEECH_REFUSAL.NOT_CLAIMED,
    ...ENDED_REFUSALS,
  },
  unless: SETTLED_KINDS,
};

const PUSHED: SpeechTransition = {
  kind: CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
  refusals: {
    [SPEECH_STATE.CLAIMED]: SPEECH_REFUSAL.ALREADY_CLAIMED,
    ...ENDED_REFUSALS,
  },
  unless: [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, ...SETTLED_KINDS],
};

interface Move {
  readonly transition: SpeechTransition;
  readonly deviceId?: string | undefined;
  readonly payload?: SpeechOfferedEventPayload | SpeechSpokenEventPayload | undefined;
  /** A refusal the offer's standing alone decides, beyond its state: the expiry, the claimant. */
  readonly guard?: (standing: SpeechStanding) => SpeechRefusal | undefined;
}

/**
 * One transition, decided against the offer as it stands and landed only
 * while it still stands so: the writer refuses the event under the lock when
 * a kind it names as excluding it arrived between the read and the lock, and
 * the refusal answered is then the one the offer's new standing names.
 */
/** Where a transition landed, with the conversation the message stands in, which a claim carries onward. */
type Moved =
  | {
      readonly ok: true;
      readonly id: string;
      readonly seq: number;
      readonly conversationId: string;
    }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

const move = /* @__PURE__ */ Effect.fnUntraced(function* (
  store: SpeechStore,
  userId: string,
  messageId: string,
  { transition, deviceId, payload, guard }: Move,
): Effect.fn.Return<Moved, SpeechReadFailure, SqlClient.SqlClient> {
  const located = yield* locate(userId, messageId);
  if (!located.ok) return located;
  const refusal = transition.refusals[located.standing.state] ?? guard?.(located.standing);
  if (refusal !== undefined) return { ok: false, refusal };
  const written = yield* store.writer.recordEvent(
    { userId, conversationId: located.conversationId },
    {
      messageId,
      kind: transition.kind,
      ...(deviceId !== undefined ? { deviceId } : undefined),
      ...(payload !== undefined ? { payload: unparsedWire(payload) } : undefined),
      unless: transition.unless,
    },
  );
  if (written.ok) return { ...written, conversationId: located.conversationId };
  switch (written.refusal) {
    case STORE_WRITE_REFUSAL.ALREADY_CLAIMED:
      return { ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED };
    case STORE_WRITE_REFUSAL.SUPERSEDED: {
      const now = yield* locate(userId, messageId);
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
});

/**
 * Puts a briefing on offer on the message that announced it, expiring
 * `SPEECH_OFFER.TTL_MS` after `now`. An offer already standing on the message
 * is answered as it stands: the relay tells a settled call once, but the
 * event eve re-emits may reach it again.
 */
export const offerSpeech = /* @__PURE__ */ Effect.fn("offerSpeech")(function* (
  store: SpeechStore,
  userId: string,
  messageId: string,
  now: number,
): Effect.fn.Return<SpeechWriteResult, SpeechReadFailure, SqlClient.SqlClient> {
  const conversation = yield* findMessageConversation({ userId, messageId });
  if (Option.isNone(conversation)) return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  const standing = yield* findOfferedEvent(messageId);
  if (Option.isSome(standing)) {
    return { ok: true, id: standing.value.id, seq: standing.value.seq };
  }
  const written = yield* store.writer.recordEvent(
    { userId, conversationId: conversation.value.conversationId },
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
      const landed = yield* findOfferedEvent(messageId);
      return Option.isNone(landed)
        ? { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND }
        : { ok: true, id: landed.value.id, seq: landed.value.seq };
    }
    case STORE_WRITE_REFUSAL.ALREADY_CLAIMED:
    case STORE_WRITE_REFUSAL.NO_CONVERSATION:
    case STORE_WRITE_REFUSAL.NO_MESSAGE:
      return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
  }
});

/**
 * One device takes the offer, while it is offered, not yet due, and not
 * held. Two devices reading the same offer both reach the writer, which
 * re-reads the claim under the conversation's lock and answers the second
 * by name; the partial unique index stands behind that as the backstop.
 */
export const claimSpeech = /* @__PURE__ */ Effect.fn("claimSpeech")(function* (
  store: SpeechStore,
  userId: string,
  messageId: string,
  deviceId: string,
  now: number,
): Effect.fn.Return<SpeechClaimResult, SpeechReadFailure, SqlClient.SqlClient> {
  const moved = yield* move(store, userId, messageId, {
    transition: CLAIM,
    deviceId,
    guard: (standing) => (standing.expiresAt <= now ? SPEECH_REFUSAL.EXPIRED : undefined),
  });
  if (!moved.ok) return moved;
  // SAFETY: the claim event is on the record under this device; this is the one place the brand is minted.
  const claim = {
    userId,
    conversationId: moved.conversationId,
    messageId,
    deviceId,
  } as SpeechClaim;
  return { ok: true, id: moved.id, seq: moved.seq, claim };
});

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
): SpeechEffect<SpeechWriteResult> {
  return move(store, userId, messageId, {
    transition: SPOKEN,
    deviceId,
    payload: spoken,
    guard: (standing) =>
      standing.claimedByDeviceId === deviceId ? undefined : SPEECH_REFUSAL.NOT_CLAIMANT,
  });
}

/**
 * The service is about to push the briefing to a device instead: from an
 * offer nobody claimed, while it is not yet due and not held. The mark
 * precedes the send, so it is the one authorization to push the way the
 * claim is the one authorization to speak, and a claim standing on the
 * offer, or landing between the read and the lock, refuses it. The device
 * pushed to is recorded where the caller names one.
 */
export function markSpeechPushed(
  store: SpeechStore,
  userId: string,
  messageId: string,
  now: number,
  deviceId?: string,
): SpeechEffect<SpeechWriteResult> {
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
  /** Accounts whose offers are left out: the push pass's read past the accounts with quiet standing. */
  readonly notUserIds?: readonly string[] | undefined;
  readonly limit?: number | undefined;
}

/**
 * The query as the statement takes it: every filter present, an absent one as
 * null, so the read's shape is one declaration rather than a condition per
 * call. The bound is a whole number, because `limit` takes one.
 */
const OpenOffersRequestSchema = Schema.Struct({
  userId: Schema.NullOr(Schema.String),
  userIds: Schema.NullOr(Schema.Array(Schema.String)),
  notUserIds: Schema.Array(Schema.String),
  limit: Schema.Int,
});

/** An offer's rows before its standing is folded: the account, the conversation, and the message announcing it. */
const OfferedMessageSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  messageId: Schema.String,
});

/** An offer not yet ended: the rows that place it, folded to how it stands. */
export type SpeechOffer = typeof OfferedMessageSchema.Type & SpeechStanding;

/** The same table read again for the ends: an offer with one of these on its message is not open. */
const settled = alias(events, "settled");

const findOfferedMessages = SqlSchema.findAll({
  Request: OpenOffersRequestSchema,
  Result: OfferedMessageSchema,
  execute: (query) =>
    db
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
          query.userId === null ? undefined : eq(events.userId, query.userId),
          query.userIds === null ? undefined : inArray(events.userId, [...query.userIds]),
          query.notUserIds.length === 0
            ? undefined
            : notInArray(events.userId, [...query.notUserIds]),
          notExists(
            db
              .select({ id: settled.id })
              .from(settled)
              .where(
                and(
                  eq(settled.messageId, events.messageId),
                  inArray(settled.kind, [...SETTLED_KINDS]),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(events.createdAt), asc(events.conversationId), asc(events.seq))
      .limit(query.limit),
});

/**
 * The offers not yet ended — no spoken, pushed, or expired event on their
 * message — over standing conversations, oldest offer first, each folded to
 * how it stands now.
 */
export const openSpeechOffers = /* @__PURE__ */ Effect.fn("openSpeechOffers")(function* (
  query: OpenSpeechOffersQuery = {},
): Effect.fn.Return<readonly SpeechOffer[], SpeechReadFailure, SqlClient.SqlClient> {
  const offered = yield* findOfferedMessages({
    userId: query.userId ?? null,
    userIds: query.userIds ?? null,
    notUserIds: query.notUserIds ?? [],
    limit: query.limit ?? OPEN_OFFERS.MAX,
  });
  // A message told its offer twice is one offer; the first row keeps its place.
  const distinct = [...new Map(offered.map((row) => [row.messageId, row])).values()];
  const speech = yield* speechEventsOf(distinct.map((row) => row.messageId));
  return distinct.flatMap((row) => {
    const standing = speechStandingOf(speech.get(row.messageId) ?? []);
    return standing === undefined ? [] : [{ ...row, ...standing }];
  });
});

/** What one sweep did, as counts. */
export interface SpeechSweepOutcome {
  /** Offers past their expiry, ended unspoken. */
  readonly expired: number;
}

/** The sweep's store: the writer's events path. */
export interface SpeechSweepStore {
  readonly writer: Pick<StoreWriter, "recordEvent">;
}

interface SpeechSweepOptions {
  readonly now: number;
  /** The most offers the sweep's read takes. */
  readonly limit?: number | undefined;
  /**
   * The accounts swept; every account where absent, which is the tick's
   * call. A caller over a database other accounts are writing at the same
   * time — a test file beside others on one Postgres — names its own.
   */
  readonly userIds?: readonly string[] | undefined;
}

/** The latest quiet instant of one account's devices still ahead of the read. */
const QuietAccountSchema = Schema.Struct({
  userId: Schema.String,
  quietUntil: InstantColumnSchema,
});

const QuietRequestSchema = Schema.Struct({
  now: Schema.Date,
  userIds: Schema.NullOr(Schema.Array(Schema.String)),
});

const findQuietAccounts = SqlSchema.findAll({
  Request: QuietRequestSchema,
  Result: QuietAccountSchema,
  execute: (query) =>
    db
      .select({ userId: devices.userId, quietUntil: max(devices.quietUntil) })
      .from(devices)
      .where(
        and(
          gt(devices.quietUntil, query.now),
          query.userIds === null ? undefined : inArray(devices.userId, [...query.userIds]),
        ),
      )
      .groupBy(devices.userId),
});

/**
 * The latest quiet instant still ahead among each account's devices; an
 * account with none reports no quiet. The push pass and the briefing look
 * read it to stay their hand, so the two decide on one standing.
 */
export function quietUntilByAccount(
  now: number,
  userIds: readonly string[] | undefined,
): Effect.Effect<ReadonlyMap<string, number>, SpeechReadFailure, SqlClient.SqlClient> {
  return Effect.map(
    findQuietAccounts({ now: new Date(now), userIds: userIds ?? null }),
    (rows) => new Map(rows.map((row) => [row.userId, row.quietUntil.getTime()])),
  );
}

/** The sweep's expiry on an open offer, refused under the lock if the offer ended meanwhile; answers whether it landed. */
function sweepWrite(
  store: SpeechSweepStore,
  offer: SpeechOffer,
  payload: SpeechExpiredEventPayload,
): SpeechEffect<boolean> {
  return Effect.map(
    store.writer.recordEvent(
      { userId: offer.userId, conversationId: offer.conversationId },
      {
        messageId: offer.messageId,
        kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
        payload: unparsedWire(payload),
        unless: SETTLED_KINDS,
      },
    ),
    (written) => written.ok,
  );
}

/**
 * The scheduled pass over every open offer: expired unspoken when its own
 * instant has passed. A quiet instant on the account is no exception, since
 * the quiet mutes and saves nothing; nothing here reads a briefing's words.
 */
export const sweepSpeech = /* @__PURE__ */ Effect.fn("sweepSpeech")(function* (
  store: SpeechSweepStore,
  options: SpeechSweepOptions,
): Effect.fn.Return<SpeechSweepOutcome, SpeechReadFailure, SqlClient.SqlClient> {
  const { now, limit, userIds } = options;
  const outcome = { expired: 0 };
  for (const offer of yield* openSpeechOffers({ userIds, limit })) {
    if (offer.expiresAt > now) continue;
    if (yield* sweepWrite(store, offer, { reason: SPEECH_EXPIRY_REASON.DUE })) {
      outcome.expired += 1;
    }
  }
  return outcome;
});
