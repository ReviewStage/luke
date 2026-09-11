import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterAll, test } from "vitest";
import {
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewEvent,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  readStoredUIMessages,
  selectConversationView,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireRecord,
} from "../server/core";
import { CONVERSATION_KIND, conversations, events, messages, turns } from "../server/db/schema";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  claimSpeech,
  markSpeechPushed,
  markSpeechSpoken,
  offerSpeech,
  openSpeechOffers,
  SPEECH_OFFER,
  SPEECH_REFUSAL,
  SPEECH_STATE,
  type SpeechStore,
  storeWriter,
} from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * A briefing's delivery as events, against the real migrations on PGlite.
 * Synthetic fixtures throughout: no real title, branch, or spoken word. What
 * these tests hold to is the guarantee the events carry — at most one
 * authorization to speak per briefing, never that it was heard.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-11T09:00:00.000Z");
const MAC = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";
const PHONE = "7d2f3f25-ab1c-4d3e-9f4a-1b2c3d4e5f61";
const SESSION = { providerId: "conductor", providerSessionId: "s-fixture-1" } as const;

let clock = NOW;
const store: SpeechStore = {
  db: database.db,
  writer: await storeWriter({
    db: database.db,
    tools: CATALOG_TOOL_SET,
    now: () => new Date(clock),
  }),
};

interface Announced {
  readonly userId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly messageId: string;
}

type MessageParts = (typeof messages.$inferInsert)["parts"];

function announcePart(callId: string, input: WireRecord): MessageParts[number] {
  // SAFETY: a stored tool part in the SDK's own shape; the read under the catalog registry is the validation.
  return {
    type: `tool-${BRAIN_TOOL.ANNOUNCE}`,
    toolCallId: callId,
    state: "output-available",
    input,
    output: { status: "accepted" },
  } as unknown as MessageParts[number];
}

/** An observed conversation with one settled roster-diff turn whose answer announced a briefing, as the relay leaves them. */
async function announced(userId?: string): Promise<Announced> {
  const owner = userId ?? (await database.createUser());
  const [conversation] = await database.db
    .insert(conversations)
    .values({
      userId: owner,
      kind: CONVERSATION_KIND.OBSERVED,
      providerId: SESSION.providerId,
      providerSessionId: `${SESSION.providerSessionId}-${randomUUID()}`,
    })
    .returning({ id: conversations.id });
  assert.ok(conversation);
  const [turn] = await database.db
    .insert(turns)
    .values({
      userId: owner,
      conversationId: conversation.id,
      origin: TURN_ORIGIN.ROSTER_DIFF,
      status: TURN_STATUS.SETTLED,
      queuedAt: new Date(clock),
      settledAt: new Date(clock),
    })
    .returning({ id: turns.id });
  assert.ok(turn);
  const [message] = await database.db
    .insert(messages)
    .values({
      userId: owner,
      conversationId: conversation.id,
      seq: 1,
      turnId: turn.id,
      clientId: turn.id,
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [announcePart(`call_${randomUUID()}`, { briefing: "One fixture agent finished." })],
      metadata: { author: MESSAGE_AUTHOR.BRAIN },
      createdAt: new Date(clock),
      finishedAt: new Date(clock),
    })
    .returning({ id: messages.id });
  assert.ok(message);
  return { userId: owner, conversationId: conversation.id, turnId: turn.id, messageId: message.id };
}

async function offered(userId?: string): Promise<Announced> {
  const row = await announced(userId);
  const offer = await offerSpeech(store, row.userId, row.messageId, clock);
  assert.equal(offer.ok, true);
  return row;
}

async function speechEvents(messageId: string) {
  return database.db
    .select({ kind: events.kind, deviceId: events.deviceId, payload: events.payload })
    .from(events)
    .where(eq(events.messageId, messageId))
    .orderBy(asc(events.seq));
}

/** Whether the Conversation view, over the announcement's row and its events as stored, marks it unspoken. */
async function viewMarksUnspoken(row: Announced): Promise<boolean> {
  const [stored] = await database.db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
      metadata: messages.metadata,
    })
    .from(messages)
    .where(eq(messages.id, row.messageId));
  const read = await readStoredUIMessages(
    unparsedWire(JSON.parse(JSON.stringify([stored]))),
    CATALOG_TOOL_SET,
  );
  assert.ok(read.ok);
  const [message] = read.value;
  assert.ok(message);
  const viewEvents: ConversationViewEvent[] = (
    await database.store.events.forMessages(row.userId, [row.messageId])
  ).map((event) => ({ messageId: event.messageId, kind: event.kind, seq: event.seq }));
  const [group] = selectConversationView({
    main: [],
    observed: [
      {
        session: SESSION,
        messages: [{ message, seq: 1, turnId: row.turnId, createdAt: NOW }],
      },
    ],
    turns: [
      {
        id: row.turnId,
        origin: TURN_ORIGIN.ROSTER_DIFF,
        status: TURN_STATUS.SETTLED,
        queuedAt: NOW,
      },
    ],
    events: viewEvents,
    toolKinds: new Map([[BRAIN_TOOL.ANNOUNCE, CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE]]),
  });
  const tool = group?.messages[0]?.tools[0];
  assert.ok(tool && tool.kind === CONVERSATION_VIEW_TOOL_KIND.ANNOUNCE);
  return tool.unspoken;
}

test("announce puts the briefing on offer once, with its expiry, and the offer reads back as it stands", async () => {
  clock = NOW;
  const row = await announced();
  const first = await offerSpeech(store, row.userId, row.messageId, clock);
  assert.equal(first.ok, true);
  const again = await offerSpeech(store, row.userId, row.messageId, clock + 5_000);
  assert.deepEqual(again, first);
  assert.deepEqual(await speechEvents(row.messageId), [
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      deviceId: null,
      payload: { expiresAt: NOW + SPEECH_OFFER.TTL_MS },
    },
  ]);
  assert.deepEqual(await database.store.speech.open(row.userId), [
    {
      userId: row.userId,
      conversationId: row.conversationId,
      messageId: row.messageId,
      state: SPEECH_STATE.OFFERED,
      offeredAt: NOW,
      expiresAt: NOW + SPEECH_OFFER.TTL_MS,
    },
  ]);

  const stranger = await database.createUser();
  assert.deepEqual(await offerSpeech(store, stranger, row.messageId, clock), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_FOUND,
  });
  assert.deepEqual(await offerSpeech(store, row.userId, randomUUID(), clock), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_FOUND,
  });
  const unoffered = await announced(row.userId);
  assert.deepEqual(await markSpeechSpoken(store, row.userId, unoffered.messageId, MAC), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_OFFERED,
  });
  assert.equal(await viewMarksUnspoken(row), false);
});

test("at most one authorization to speak per briefing, never that it was heard: of two devices claiming at once exactly one is authorized, only that one can report it spoken, and the report closes the offer", async () => {
  clock = NOW;
  const row = await offered();
  const [mac, phone] = await Promise.all([
    claimSpeech(store, row.userId, row.messageId, MAC, clock),
    claimSpeech(store, row.userId, row.messageId, PHONE, clock),
  ]);
  const outcomes = [mac, phone];
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.deepEqual(
    outcomes.filter((outcome) => !outcome.ok),
    [{ ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED }],
  );
  const winner = mac.ok ? MAC : PHONE;
  const loser = mac.ok ? PHONE : MAC;
  assert.deepEqual(await claimSpeech(store, row.userId, row.messageId, loser, clock), {
    ok: false,
    refusal: SPEECH_REFUSAL.ALREADY_CLAIMED,
  });
  assert.deepEqual(
    (await openSpeechOffers(database.db, { userId: row.userId })).map((offer) => [
      offer.state,
      offer.claimedByDeviceId,
    ]),
    [[SPEECH_STATE.CLAIMED, winner]],
  );

  // The index is the backstop behind the writer's own check: a second claim
  // row that reaches the table without the writer is refused by the schema.
  await assert.rejects(
    database.db.insert(events).values({
      userId: row.userId,
      conversationId: row.conversationId,
      seq: 99,
      messageId: row.messageId,
      kind: CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      deviceId: loser,
    }),
  );

  assert.deepEqual(await markSpeechSpoken(store, row.userId, row.messageId, loser), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_CLAIMANT,
  });
  const spoken = await markSpeechSpoken(store, row.userId, row.messageId, winner);
  assert.equal(spoken.ok, true);
  assert.deepEqual(
    (await speechEvents(row.messageId)).map((event) => [event.kind, event.deviceId]),
    [
      [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
      [CONVERSATION_EVENT_KIND.SPEECH_CLAIMED, winner],
      [CONVERSATION_EVENT_KIND.SPEECH_SPOKEN, winner],
    ],
  );
  assert.deepEqual(await openSpeechOffers(database.db, { userId: row.userId }), []);
  for (const late of [
    markSpeechSpoken(store, row.userId, row.messageId, winner),
    claimSpeech(store, row.userId, row.messageId, PHONE, clock),
    markSpeechPushed(store, row.userId, row.messageId, clock),
  ]) {
    assert.deepEqual(await late, { ok: false, refusal: SPEECH_REFUSAL.SETTLED });
  }
  assert.equal(await viewMarksUnspoken(row), false);

  const unclaimed = await offered(row.userId);
  assert.deepEqual(await markSpeechSpoken(store, row.userId, unclaimed.messageId, MAC), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_CLAIMED,
  });
});

test("a claim racing a push: the push lands either way, the claim lands only if it reached the lock first, two pushes racing land one, and a duplicate offer told again is the same offer rather than a state", async () => {
  clock = NOW;
  const raced = await offered();
  const [claim, push] = await Promise.all([
    claimSpeech(store, raced.userId, raced.messageId, MAC, clock),
    markSpeechPushed(store, raced.userId, raced.messageId, clock, PHONE),
  ]);
  assert.equal(push.ok, true);
  const kinds = (await speechEvents(raced.messageId)).map((event) => event.kind);
  if (claim.ok) {
    assert.deepEqual(kinds, [
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
      CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
    ]);
  } else {
    assert.deepEqual(claim, { ok: false, refusal: SPEECH_REFUSAL.SETTLED });
    assert.deepEqual(kinds, [
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
    ]);
  }
  assert.deepEqual(await openSpeechOffers(database.db, { userId: raced.userId }), []);

  const twice = await offered(raced.userId);
  const pushes = await Promise.all([
    markSpeechPushed(store, twice.userId, twice.messageId, clock, MAC),
    markSpeechPushed(store, twice.userId, twice.messageId, clock, PHONE),
  ]);
  assert.equal(pushes.filter((outcome) => outcome.ok).length, 1);
  assert.deepEqual(
    pushes.filter((outcome) => !outcome.ok),
    [{ ok: false, refusal: SPEECH_REFUSAL.SETTLED }],
  );
  assert.deepEqual(
    (await speechEvents(twice.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );

  // The interleaving the race above cannot be made to take: the offer settles
  // between the claim's read and its lock, and the claim is refused under it.
  const interposed: SpeechStore = {
    db: database.db,
    writer: {
      recordEvent: async (target, event) => {
        if (event.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED) {
          assert.equal(
            (await markSpeechPushed(store, target.userId, event.messageId, clock, PHONE)).ok,
            true,
          );
        }
        return store.writer.recordEvent(target, event);
      },
    },
  };
  const settledUnderneath = await offered(raced.userId);
  assert.deepEqual(
    await claimSpeech(
      interposed,
      settledUnderneath.userId,
      settledUnderneath.messageId,
      MAC,
      clock,
    ),
    { ok: false, refusal: SPEECH_REFUSAL.SETTLED },
  );
  assert.deepEqual(
    (await speechEvents(settledUnderneath.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );

  const claimed = await offered(raced.userId);
  assert.equal((await claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock)).ok, true);
  await store.writer.recordEvent(
    { userId: claimed.userId, conversationId: claimed.conversationId },
    { messageId: claimed.messageId, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, unless: [] },
  );
  assert.deepEqual(
    (await openSpeechOffers(database.db, { userId: raced.userId })).map((offer) => [
      offer.messageId,
      offer.state,
      offer.expiresAt,
    ]),
    [[claimed.messageId, SPEECH_STATE.CLAIMED, NOW + SPEECH_OFFER.TTL_MS]],
  );
});

test("a push closes an offer nobody claimed or a claim that never became speech, records the device pushed to, and refuses one already due", async () => {
  clock = NOW;
  const unclaimed = await offered();
  const pushed = await markSpeechPushed(store, unclaimed.userId, unclaimed.messageId, clock, PHONE);
  assert.equal(pushed.ok, true);
  assert.deepEqual(
    (await speechEvents(unclaimed.messageId)).map((event) => [event.kind, event.deviceId]),
    [
      [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
      [CONVERSATION_EVENT_KIND.SPEECH_PUSHED, PHONE],
    ],
  );

  const claimed = await offered(unclaimed.userId);
  assert.equal((await claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock)).ok, true);
  assert.equal((await markSpeechPushed(store, claimed.userId, claimed.messageId, clock)).ok, true);
  assert.deepEqual(await markSpeechSpoken(store, claimed.userId, claimed.messageId, MAC), {
    ok: false,
    refusal: SPEECH_REFUSAL.SETTLED,
  });

  const due = await offered(unclaimed.userId);
  const later = clock + SPEECH_OFFER.TTL_MS;
  assert.deepEqual(await markSpeechPushed(store, due.userId, due.messageId, later), {
    ok: false,
    refusal: SPEECH_REFUSAL.EXPIRED,
  });
  assert.deepEqual(await claimSpeech(store, due.userId, due.messageId, MAC, later), {
    ok: false,
    refusal: SPEECH_REFUSAL.EXPIRED,
  });
  assert.deepEqual(await openSpeechOffers(database.db, { userId: unclaimed.userId }), [
    {
      userId: due.userId,
      conversationId: due.conversationId,
      messageId: due.messageId,
      state: SPEECH_STATE.OFFERED,
      offeredAt: NOW,
      expiresAt: NOW + SPEECH_OFFER.TTL_MS,
    },
  ]);
});
