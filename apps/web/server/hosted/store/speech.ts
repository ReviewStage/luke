import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Either, Option, type ParseResult, Schema } from "effect";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  type ConversationEventKind,
  isRecord,
  isSpeechEventKind,
  isWireString,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  SPEECH_EXPIRY_REASON,
  SPEECH_HELD_EVENT_PAYLOAD,
  SPEECH_OFFERED_EVENT_PAYLOAD,
  type SpeechEventKind,
  type SpeechExpiredEventPayload,
  type SpeechHeldEventPayload,
  type SpeechOfferedEventPayload,
  type SpeechSpokenEventPayload,
  TURN_ORIGIN,
  toolPartType,
  unparsedWire,
  type WireBoundaryInput,
  WireValueSchema,
} from "../../core.js";
import { EpochMillisColumnSchema } from "./database.js";
import {
  ConversationEventKindSchema,
  type ConversationTarget,
  STORE_WRITE_REFUSAL,
  type StoreWriter,
} from "./writer.js";

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
 * Every read below is an `Effect<A, SqlError | ParseError, SqlClient>` whose
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

export type SpeechClaimResult =
  | { readonly ok: true; readonly id: string; readonly seq: number; readonly claim: SpeechClaim }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

export interface SpeechStore {
  readonly writer: Pick<StoreWriter, "recordEvent">;
}

/** What every transition here answers: an effect over the ambient client, run by whoever composed the request. */
type SpeechEffect<A> = Effect.Effect<A, SpeechReadFailure, SqlClient.SqlClient>;

/** How a read here fails: the driver's own refusal, or a row the schema refused. */
type SpeechReadFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

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

/**
 * One event on a message, as the `events` row holds it. The payload is the
 * `jsonb` column read as the wire value it is, which the payload schemas
 * above are what hold to a shape; the kind is one of the vocabulary's own,
 * so a row naming anything else is refused rather than folded.
 */
const SpeechEventRowSchema = Schema.Struct({
  messageId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("message_id")),
  kind: ConversationEventKindSchema,
  deviceId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("device_id"),
  ),
  payload: WireValueSchema,
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
});

type SpeechEventRow = Schema.Schema.Type<typeof SpeechEventRowSchema>;

/** The conversation a message belongs to, where the message is the account's and its conversation stands. */
const MessageConversationSchema = Schema.Struct({
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
});

const MessageKeySchema = Schema.Struct({
  userId: Schema.String,
  messageId: Schema.String,
});

/** Where an event landed, which is what an offer already standing answers with. */
const EventPositionSchema = Schema.Struct({
  id: Schema.String,
  seq: EpochMillisColumnSchema,
});

const findMessageConversation = SqlSchema.findOne({
  Request: MessageKeySchema,
  Result: MessageConversationSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select messages.conversation_id
        from messages
        join conversations
          on conversations.id = messages.conversation_id and conversations.deleted_at is null
        where messages.id = ${key.messageId} and messages.user_id = ${key.userId}
      `,
    ),
});

const findSpeechEvents = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: SpeechEventRowSchema,
  execute: (messageIds) =>
    statement(
      (sql) => sql`
        select message_id, kind, device_id, payload, created_at
        from events
        where message_id in ${sql.in(messageIds)}
        order by message_id asc, seq asc
      `,
    ),
});

const findOfferedEvent = SqlSchema.findOne({
  Request: Schema.String,
  Result: EventPositionSchema,
  execute: (messageId) =>
    statement(
      (sql) => sql`
        select id, seq
        from events
        where message_id = ${messageId}
          and kind = ${CONVERSATION_EVENT_KIND.SPEECH_OFFERED}
      `,
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
      const payload = Either.getOrUndefined(readEither(SPEECH_OFFERED_EVENT_PAYLOAD)(row.payload));
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
      const held = Either.getOrUndefined(readEither(SPEECH_HELD_EVENT_PAYLOAD)(row.payload));
      standing = held === undefined ? standing : { ...standing, quietUntil: held.quietUntil };
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
function locate(
  userId: string,
  messageId: string,
): Effect.Effect<Located, SpeechReadFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const conversation = yield* findMessageConversation({ userId, messageId });
    if (Option.isNone(conversation)) return { ok: false, refusal: SPEECH_REFUSAL.NOT_FOUND };
    const events = yield* speechEventsOf([messageId]);
    const standing = speechStandingOf(events.get(messageId) ?? []);
    if (standing === undefined) return { ok: false, refusal: SPEECH_REFUSAL.NOT_OFFERED };
    return { ok: true, conversationId: conversation.value.conversationId, standing };
  });
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
  refusals: {
    [SPEECH_STATE.CLAIMED]: SPEECH_REFUSAL.ALREADY_CLAIMED,
    [SPEECH_STATE.HELD]: SPEECH_REFUSAL.HELD,
    ...ENDED_REFUSALS,
  },
  unless: [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, ...NOT_OPEN_KINDS],
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
/** Where a transition landed, with the conversation the message stands in, which a claim carries onward. */
type Moved =
  | {
      readonly ok: true;
      readonly id: string;
      readonly seq: number;
      readonly conversationId: string;
    }
  | { readonly ok: false; readonly refusal: SpeechRefusal };

function move(
  store: SpeechStore,
  userId: string,
  messageId: string,
  { transition, deviceId, payload, guard }: Move,
): SpeechEffect<Moved> {
  return Effect.gen(function* () {
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
}

/**
 * Puts a briefing on offer on the message that announced it, expiring
 * `SPEECH_OFFER.TTL_MS` after `now`. An offer already standing on the message
 * is answered as it stands: the relay tells a settled call once, but the
 * event eve re-emits may reach it again.
 */
export function offerSpeech(
  store: SpeechStore,
  userId: string,
  messageId: string,
  now: number,
): SpeechEffect<SpeechWriteResult> {
  return Effect.gen(function* () {
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
): SpeechEffect<SpeechClaimResult> {
  return Effect.gen(function* () {
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
  /** Accounts whose offers are left out: the sweep's read of the accounts with no quiet standing. */
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
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  messageId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("message_id")),
});

const findOfferedMessages = SqlSchema.findAll({
  Request: OpenOffersRequestSchema,
  Result: OfferedMessageSchema,
  execute: (query) =>
    statement(
      (sql) => sql`
        select events.user_id, events.conversation_id, events.message_id
        from events
        join conversations
          on conversations.id = events.conversation_id and conversations.deleted_at is null
        where ${sql.and([
          sql`events.kind = ${CONVERSATION_EVENT_KIND.SPEECH_OFFERED}`,
          ...(query.userId === null ? [] : [sql`events.user_id = ${query.userId}`]),
          ...(query.userIds === null ? [] : [sql`events.user_id in ${sql.in(query.userIds)}`]),
          ...(query.notUserIds.length === 0
            ? []
            : [sql`events.user_id not in ${sql.in(query.notUserIds)}`]),
          sql`not exists (
            select 1 from events settled
            where settled.message_id = events.message_id
              and settled.kind in ${sql.in(SETTLED_KINDS)}
          )`,
        ])}
        order by events.created_at asc, events.conversation_id asc, events.seq asc
        limit ${query.limit}
      `,
    ),
});

/**
 * The offers not yet ended — no spoken, pushed, or expired event on their
 * message — over standing conversations, oldest offer first, each folded to
 * how it stands now.
 */
export function openSpeechOffers(
  query: OpenSpeechOffersQuery = {},
): Effect.Effect<readonly SpeechOffer[], SpeechReadFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
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

/** The latest quiet instant of one account's devices still ahead of the read. */
const QuietAccountSchema = Schema.Struct({
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  quietUntil: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("quiet_until")),
});

const QuietRequestSchema = Schema.Struct({
  now: Schema.DateFromSelf,
  userIds: Schema.NullOr(Schema.Array(Schema.String)),
});

const findQuietAccounts = SqlSchema.findAll({
  Request: QuietRequestSchema,
  Result: QuietAccountSchema,
  execute: (query) =>
    statement(
      (sql) => sql`
        select devices.user_id, max(devices.quiet_until) as quiet_until
        from devices
        where ${sql.and([
          sql`devices.quiet_until > ${query.now}`,
          ...(query.userIds === null ? [] : [sql`devices.user_id in ${sql.in(query.userIds)}`]),
        ])}
        group by devices.user_id
      `,
    ),
});

/**
 * The latest quiet instant still ahead among each account's devices; an
 * account with none reports no hold. The sweep reads it to hold and the push
 * pass to stay its hand, so the two decide on one standing.
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

/** One of the sweep's writes on an open offer, refused under the lock if the offer ended meanwhile; answers whether it landed. */
function sweepWrite(
  store: SpeechSweepStore,
  offer: SpeechOffer,
  kind: typeof CONVERSATION_EVENT_KIND.SPEECH_HELD | typeof CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
  payload: SpeechHeldEventPayload | SpeechExpiredEventPayload,
): SpeechEffect<boolean> {
  return Effect.map(
    store.writer.recordEvent(
      { userId: offer.userId, conversationId: offer.conversationId },
      { messageId: offer.messageId, kind, payload: unparsedWire(payload), unless: SETTLED_KINDS },
    ),
    (written) => written.ok,
  );
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
export function sweepSpeech(
  store: SpeechSweepStore,
  options: SpeechSweepOptions,
): SpeechEffect<SpeechSweepOutcome> {
  return Effect.gen(function* () {
    const { now, limit, userIds } = options;
    const quiet = yield* quietUntilByAccount(now, userIds);
    const outcome = { held: 0, released: 0, expired: 0, turns: 0 };
    for (const [userId, quietUntil] of quiet) {
      for (const offer of yield* openSpeechOffers({ userId, limit })) {
        if (offer.state === SPEECH_STATE.HELD && (offer.quietUntil ?? 0) >= quietUntil) continue;
        if (yield* sweepWrite(store, offer, CONVERSATION_EVENT_KIND.SPEECH_HELD, { quietUntil })) {
          outcome.held += 1;
        }
      }
    }
    const released = new Set<string>();
    const unheld = yield* openSpeechOffers({
      userIds,
      notUserIds: [...quiet.keys()],
      limit,
    });
    for (const offer of unheld) {
      if (offer.state === SPEECH_STATE.HELD) {
        const ended = yield* sweepWrite(store, offer, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED, {
          reason: SPEECH_EXPIRY_REASON.HOLD_RELEASED,
        });
        if (!ended) continue;
        outcome.released += 1;
        if (released.has(offer.conversationId)) continue;
        released.add(offer.conversationId);
        const queued = yield* store.writer.enqueueTurn(
          { userId: offer.userId, conversationId: offer.conversationId },
          { origin: TURN_ORIGIN.HOLD_RELEASE },
        );
        if (queued.ok) outcome.turns += 1;
        continue;
      }
      if (offer.expiresAt <= now) {
        const ended = yield* sweepWrite(store, offer, CONVERSATION_EVENT_KIND.SPEECH_EXPIRED, {
          reason: SPEECH_EXPIRY_REASON.DUE,
        });
        if (ended) outcome.expired += 1;
      }
    }
    return outcome;
  });
}

/** One briefing a hold released unspoken: the words the announce call carried, and when the brain decided them. */
export interface ReleasedBriefing {
  readonly messageId: string;
  readonly briefing: string;
  /** Epoch milliseconds the announcing message was written. */
  readonly decidedAt: number;
  /** Epoch milliseconds the release ended the offer. */
  readonly releasedAt: number;
}

export interface ReleasedBriefingsQuery {
  /** The most uncarried releases answered, oldest first. */
  readonly limit: number;
}

/** How many release events one page of the read takes before it looks for more. */
const RELEASE_PAGE = 64;

/**
 * The most hold-release messages read, newest first, for what earlier
 * re-decisions carried. Past it the oldest carried set falls out of view and
 * its releases are listed again — a judgment made twice, never a release
 * lost — which is the direction a bound here may fail in.
 */
const CARRIED_MESSAGES_READ = 256;

/**
 * A message's parts as this module reads them: only a part's type, its text
 * where it is a text part, and its input where it is a tool part are looked
 * at, so the column is held that far and no further; the vocabulary the
 * parts belong to is the writer's, which admitted every row before it landed.
 */
const ReadPartsColumnSchema = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    text: Schema.optional(Schema.String),
    input: Schema.optional(Schema.Unknown),
  }),
);

type ReadParts = Schema.Schema.Type<typeof ReadPartsColumnSchema>;

const UI_TEXT_PART = "text";

/** The words an announce call carried, read off the message's own stored part; nothing for a message with no announce call. */
function briefingOf(parts: ReadParts): string | undefined {
  for (const part of parts) {
    if (part.type !== toolPartType(BRAIN_TOOL.ANNOUNCE)) continue;
    // SAFETY: a stored part's input is the JSON the writer admitted under the announce schema; the record read below is what holds it here.
    const input = unparsedWire(part.input as WireBoundaryInput);
    if (isRecord(input) && isWireString(input.briefing)) return input.briefing;
  }
  return undefined;
}

/**
 * The briefings a hold-release turn's opening words named, as the brain's
 * own input item spells them: the marker line, then the JSON the host
 * wrote. A message this build cannot read as one names nothing.
 */
const ignoringExtraKeys = { parseOptions: { onExcessProperty: "ignore" } } as const;

const trimmedText = Schema.transform(Schema.String, Schema.String, {
  strict: true,
  decode: (value) => value.trim(),
  encode: (value) => value,
}).pipe(
  Schema.filter((value) => value.trim().length > 0, {
    schemaId: Schema.MinLengthSchemaId,
    jsonSchema: { minLength: 1 },
  }),
);

const heldBriefingsWords = Schema.Struct({
  held_briefings: Schema.Array(
    Schema.Struct({ briefing: trimmedText, decided_at: trimmedText }).annotations(
      ignoringExtraKeys,
    ),
  ),
}).annotations(ignoringExtraKeys);

/** One briefing as a hold-release item names it: what it said and, in epoch milliseconds, when the brain decided it. */
export interface NamedBriefing {
  readonly briefing: string;
  readonly decidedAt: number;
}

/** The end of the JSON object that starts at `start`, or nothing where no balanced object stands there. */
function objectEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\\") index += 1;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

/**
 * The briefings a received message's words name as held: every
 * `[hold released]` item in the text, read back through the same record the
 * host wrote it as. The text is eve's, which may fold two deliveries into
 * one received message with a blank line between, so each marked item is
 * read where it stands and an item this build cannot read names nothing.
 * The one coupling to the words' format is this reader against
 * `holdReleasedInputText`, and the round-trip test is what holds the two
 * together: a wording change that broke the read would re-list every
 * release, which is a judgment made twice and a briefing heard twice.
 */
export function heldBriefingsNamed(text: string): readonly NamedBriefing[] {
  const named: NamedBriefing[] = [];
  let from = 0;
  while (from < text.length) {
    const marker = text.indexOf(BRAIN_INPUT_MARKER.HOLD_RELEASED, from);
    if (marker < 0) break;
    const start = text.indexOf("{", marker);
    if (start < 0) break;
    const end = objectEnd(text, start);
    if (end === undefined) break;
    from = end;
    let parsed: WireBoundaryInput;
    try {
      // SAFETY: the host's own JSON behind the marker; the record read that follows is what holds it to a shape.
      parsed = JSON.parse(text.slice(start, end)) as WireBoundaryInput;
    } catch {
      continue;
    }
    const words = readEither(heldBriefingsWords)(unparsedWire(parsed));
    if (Either.isLeft(words)) continue;
    for (const held of words.right.held_briefings) {
      const decidedAt = Date.parse(held.decided_at);
      if (Number.isNaN(decidedAt)) continue;
      named.push({ briefing: held.briefing, decidedAt });
    }
  }
  return named;
}

/** One carried briefing's identity: when the brain decided it and what it said, which is what the words name it by. */
function carriedKey(decidedAt: number, briefing: string): string {
  return JSON.stringify([decidedAt, briefing]);
}

const CarriedMessagesRequestSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  marked: Schema.String,
  limit: Schema.Int,
});

const findHoldReleaseMessages = SqlSchema.findAll({
  Request: CarriedMessagesRequestSchema,
  Result: Schema.Struct({ parts: ReadPartsColumnSchema }),
  execute: (request) =>
    statement(
      (sql) => sql`
        select parts
        from messages
        where conversation_id = ${request.conversationId}
          and user_id = ${request.userId}
          and role = ${MESSAGE_ROLE.USER}
          and metadata ->> 'author' = ${MESSAGE_AUTHOR.BRAIN}
          and parts::text like ${request.marked}
        order by seq desc
        limit ${request.limit}
      `,
    ),
});

/**
 * The briefings every hold-release item among the conversation's messages
 * has named: what earlier re-decisions already carried. The messages are
 * found by the brain's own authorship and the marker in their words, never
 * by the source a message's metadata names: under eve a folded message
 * carries the last delivery's kind, so which delivery produced a message is
 * not a property of the message, while who wrote it is — and the authorship
 * is what keeps a developer's own typed ask from ever counting as a carried
 * set, whatever words it quotes.
 */
function carriedBriefings(
  target: ConversationTarget,
): Effect.Effect<ReadonlySet<string>, SpeechReadFailure, SqlClient.SqlClient> {
  return Effect.map(
    findHoldReleaseMessages({
      userId: target.userId,
      conversationId: target.conversationId,
      marked: `%${BRAIN_INPUT_MARKER.HOLD_RELEASED}%`,
      limit: CARRIED_MESSAGES_READ,
    }),
    (rows) => {
      const keys = new Set<string>();
      for (const row of rows) {
        for (const part of row.parts) {
          if (part.type !== UI_TEXT_PART || part.text === undefined) continue;
          for (const held of heldBriefingsNamed(part.text)) {
            keys.add(carriedKey(held.decidedAt, held.briefing));
          }
        }
      }
      return keys;
    },
  );
}

const ReleasesRequestSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  afterSeq: Schema.Number,
  limit: Schema.Int,
});

const ReleaseRowSchema = Schema.Struct({
  seq: EpochMillisColumnSchema,
  messageId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("message_id")),
  parts: ReadPartsColumnSchema,
  decidedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("decided_at")),
  releasedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("released_at")),
});

const findReleases = SqlSchema.findAll({
  Request: ReleasesRequestSchema,
  Result: ReleaseRowSchema,
  execute: (request) =>
    statement(
      (sql) => sql`
        select events.seq, messages.id as message_id, messages.parts,
          messages.created_at as decided_at, events.created_at as released_at
        from events
        join messages on messages.id = events.message_id
        where events.conversation_id = ${request.conversationId}
          and events.user_id = ${request.userId}
          and events.kind = ${CONVERSATION_EVENT_KIND.SPEECH_EXPIRED}
          and events.payload ->> 'reason' = ${SPEECH_EXPIRY_REASON.HOLD_RELEASED}
          and events.seq > ${request.afterSeq}
        order by events.seq asc
        limit ${request.limit}
      `,
    ),
});

/**
 * The briefings of one conversation a hold released unspoken and no
 * hold-release turn has yet carried, oldest release first: what the next
 * `hold_release` turn opens with, so the brain decides each again against
 * the roster as it then is. The boundary is the record's own contents and
 * no clock's: a release is carried once a hold-release message of the
 * conversation names it, by the instant the brain decided it and its words,
 * so a message the relay has not yet written can only re-list a release,
 * never lose one. Read from the events and the announcing messages — the
 * release is the `speech.expired` event whose reason is the hold's, one per
 * message since a settled offer takes no second transition — and never from
 * the words of anything else.
 */
export function releasedBriefings(
  target: ConversationTarget,
  query: ReleasedBriefingsQuery,
): Effect.Effect<readonly ReleasedBriefing[], SpeechReadFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const carried = yield* carriedBriefings(target);
    const uncarried: ReleasedBriefing[] = [];
    let afterSeq = 0;
    while (uncarried.length < query.limit) {
      const rows = yield* findReleases({
        userId: target.userId,
        conversationId: target.conversationId,
        afterSeq,
        limit: RELEASE_PAGE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        afterSeq = row.seq;
        const briefing = briefingOf(row.parts);
        if (briefing === undefined) continue;
        if (carried.has(carriedKey(row.decidedAt.getTime(), briefing))) continue;
        uncarried.push({
          messageId: row.messageId,
          briefing,
          decidedAt: row.decidedAt.getTime(),
          releasedAt: row.releasedAt.getTime(),
        });
        if (uncarried.length >= query.limit) break;
      }
      if (rows.length < RELEASE_PAGE) break;
    }
    return uncarried;
  });
}
