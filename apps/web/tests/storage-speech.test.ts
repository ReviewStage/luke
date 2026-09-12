import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";
import { afterAll, test } from "vitest";
import {
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewEvent,
  DEVICE_PLATFORM,
  holdReleasedInputText,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  readStoredUIMessages,
  SPEECH_EXPIRY_REASON,
  type StoredUIMessage,
  selectConversationView,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireRecord,
  wakeInputText,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  claimSpeech,
  heldBriefingsNamed,
  markSpeechPushed,
  markSpeechSpoken,
  type OpenSpeechOffersQuery,
  offerSpeech,
  openSpeechOffers,
  releasedBriefings,
  SPEECH_OFFER,
  SPEECH_REFUSAL,
  SPEECH_STATE,
  type SpeechStore,
  type SpeechSweepStore,
  storeWriter,
  sweepSpeech,
} from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertEvent,
  insertMessage,
  insertTurn,
  readEventsByMessage,
  readMessageById,
  readTurnsByConversation,
  setConversationDeletedAt,
} from "./support/store-rows";

/**
 * A briefing's delivery as events, against the real migrations on PGlite.
 * Synthetic fixtures throughout: no real title, branch, or spoken word. What
 * these tests hold to is the guarantee the events carry — at most one
 * authorization to speak per briefing, never that it was heard — and the
 * hold that suspends the clock: while a device reports quiet, nothing is
 * claimed, pushed, or expired, and when it lifts the briefing is decided
 * again rather than spoken stale.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-11T09:00:00.000Z");
const MAC = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";
const PHONE = "7d2f3f25-ab1c-4d3e-9f4a-1b2c3d4e5f61";
const SESSION = { providerId: "conductor", providerSessionId: "s-fixture-1" } as const;

let clock = NOW;
const store: SpeechSweepStore = {
  run: database.run,
  writer: await storeWriter({
    run: database.run,
    tools: CATALOG_TOOL_SET,
    now: () => new Date(clock),
  }),
};

const openOffers = (query: OpenSpeechOffersQuery) => database.run(openSpeechOffers(query));

interface Announced {
  readonly userId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly messageId: string;
}

type MessageParts = StoredUIMessage["parts"];

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
  const conversationId = await insertConversation(database.run, {
    userId: owner,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: SESSION.providerId,
    providerSessionId: `${SESSION.providerSessionId}-${randomUUID()}`,
  });
  const turnId = await insertTurn(database.run, {
    userId: owner,
    conversationId,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.SETTLED,
    queuedAt: new Date(clock),
    settledAt: new Date(clock),
  });
  const messageId = await insertMessage(database.run, {
    userId: owner,
    conversationId,
    seq: 1,
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [announcePart(`call_${randomUUID()}`, { briefing: "One fixture agent finished." })],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    createdAt: new Date(clock),
    finishedAt: new Date(clock),
  });
  return { userId: owner, conversationId, turnId, messageId };
}

async function offered(userId?: string): Promise<Announced> {
  const row = await announced(userId);
  const offer = await offerSpeech(store, row.userId, row.messageId, clock);
  assert.equal(offer.ok, true);
  return row;
}

async function speechEvents(messageId: string) {
  const rows = await readEventsByMessage(database.run, messageId);
  return rows.map((row) => ({ kind: row.kind, deviceId: row.device_id, payload: row.payload }));
}

async function reportQuiet(userId: string, deviceId: string, quietUntil: number | null) {
  await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const at = quietUntil === null ? null : new Date(quietUntil);
      const installationId = `install-${deviceId}-${userId}`;
      yield* sql`
        insert into devices (id, user_id, installation_id, platform, quiet_until)
        values (${deviceId}, ${userId}, ${installationId}, ${DEVICE_PLATFORM.MACOS}, ${at})
        on conflict (id) do update
          set user_id = excluded.user_id,
              installation_id = excluded.installation_id,
              quiet_until = excluded.quiet_until
      `;
    }),
  );
}

async function queuedTurns(conversationId: string) {
  const rows = await readTurnsByConversation(database.run, conversationId);
  return rows
    .filter((row) => row.status === TURN_STATUS.QUEUED)
    .map((row) => ({ origin: row.origin, status: row.status }));
}

/** Whether the Conversation view, over the announcement's row and its events as stored, marks it unspoken. */
async function viewMarksUnspoken(row: Announced): Promise<boolean> {
  const stored = await readMessageById(database.run, row.messageId);
  assert.ok(stored);
  const { id, role, parts, metadata } = stored;
  const read = await readStoredUIMessages(
    unparsedWire(JSON.parse(JSON.stringify([{ id, role, parts, metadata }]))),
    CATALOG_TOOL_SET,
  );
  assert.ok(read.ok);
  const [message] = read.value;
  assert.ok(message);
  const viewEvents: ConversationViewEvent[] = (
    await database.run(database.store.events.forMessages(row.userId, [row.messageId]))
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
  assert.deepEqual(await database.run(database.store.speech.open(row.userId)), [
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
    (await openOffers({ userId: row.userId })).map((offer) => [
      offer.state,
      offer.claimedByDeviceId,
    ]),
    [[SPEECH_STATE.CLAIMED, winner]],
  );

  // The index is the backstop behind the writer's own check: a second claim
  // row that reaches the table without the writer is refused by the schema.
  await assert.rejects(
    insertEvent(database.run, {
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
  assert.deepEqual(await openOffers({ userId: row.userId }), []);
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

test("a claim racing a push: exactly one lands, whichever reached the lock first, two pushes racing land one, and a duplicate offer told again is the same offer rather than a state", async () => {
  clock = NOW;
  const raced = await offered();
  const [claim, push] = await Promise.all([
    claimSpeech(store, raced.userId, raced.messageId, MAC, clock),
    markSpeechPushed(store, raced.userId, raced.messageId, clock, PHONE),
  ]);
  assert.equal([claim, push].filter((outcome) => outcome.ok).length, 1);
  const kinds = (await speechEvents(raced.messageId)).map((event) => event.kind);
  if (claim.ok) {
    assert.deepEqual(push, { ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED });
    assert.deepEqual(kinds, [
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
    ]);
    assert.deepEqual(
      (await openOffers({ userId: raced.userId })).map((offer) => offer.state),
      [SPEECH_STATE.CLAIMED],
    );
  } else {
    assert.deepEqual(claim, { ok: false, refusal: SPEECH_REFUSAL.SETTLED });
    assert.deepEqual(kinds, [
      CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      CONVERSATION_EVENT_KIND.SPEECH_PUSHED,
    ]);
    assert.deepEqual(await openOffers({ userId: raced.userId }), []);
  }

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
    run: database.run,
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

  // The mirror interleaving: the claim lands between the push's read and its
  // lock, and the push is refused under it rather than told over the claim.
  const claimedUnderneath: SpeechStore = {
    run: database.run,
    writer: {
      recordEvent: async (target, event) => {
        if (event.kind === CONVERSATION_EVENT_KIND.SPEECH_PUSHED) {
          assert.equal(
            (await claimSpeech(store, target.userId, event.messageId, MAC, clock)).ok,
            true,
          );
        }
        return store.writer.recordEvent(target, event);
      },
    },
  };
  const takenUnderneath = await offered(raced.userId);
  assert.deepEqual(
    await markSpeechPushed(
      claimedUnderneath,
      takenUnderneath.userId,
      takenUnderneath.messageId,
      clock,
      PHONE,
    ),
    { ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED },
  );
  assert.deepEqual(
    (await speechEvents(takenUnderneath.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED],
  );

  const claimed = await offered(raced.userId);
  assert.equal((await claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock)).ok, true);
  await store.writer.recordEvent(
    { userId: claimed.userId, conversationId: claimed.conversationId },
    { messageId: claimed.messageId, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, unless: [] },
  );
  assert.deepEqual(
    (await openOffers({ userId: raced.userId }))
      .filter((offer) => offer.messageId === claimed.messageId)
      .map((offer) => [offer.state, offer.expiresAt]),
    [[SPEECH_STATE.CLAIMED, NOW + SPEECH_OFFER.TTL_MS]],
  );
});

test("a push closes an offer nobody claimed, records the device pushed to, never takes a claimed one, and refuses one already due", async () => {
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
  assert.deepEqual(await markSpeechPushed(store, claimed.userId, claimed.messageId, clock), {
    ok: false,
    refusal: SPEECH_REFUSAL.ALREADY_CLAIMED,
  });
  assert.equal((await markSpeechSpoken(store, claimed.userId, claimed.messageId, MAC)).ok, true);

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
  assert.deepEqual(await openOffers({ userId: unclaimed.userId }), [
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

test("the sweep expires an offer past its instant, claimed or not, marks it unspoken in the view, and never offers it again", async () => {
  clock = NOW;
  const unclaimed = await offered();
  const claimed = await offered(unclaimed.userId);
  assert.equal((await claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock)).ok, true);
  clock = NOW + 60_000;
  const fresh = await offered(unclaimed.userId);
  clock = NOW;
  const unreadable = await announced(unclaimed.userId);
  await store.writer.recordEvent(
    { userId: unreadable.userId, conversationId: unreadable.conversationId },
    { messageId: unreadable.messageId, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, unless: [] },
  );

  const accounts = [unclaimed.userId];
  const early = await sweepSpeech(store, {
    now: clock + SPEECH_OFFER.TTL_MS - 1,
    userIds: accounts,
  });
  assert.deepEqual(early, { held: 0, released: 0, expired: 1, turns: 0 });
  assert.deepEqual(await speechEvents(unreadable.messageId), [
    { kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, deviceId: null, payload: null },
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      deviceId: null,
      payload: { reason: SPEECH_EXPIRY_REASON.DUE },
    },
  ]);

  clock = NOW + SPEECH_OFFER.TTL_MS;
  const due = await sweepSpeech(store, { now: clock, userIds: accounts });
  assert.deepEqual(due, { held: 0, released: 0, expired: 2, turns: 0 });
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: accounts }), {
    held: 0,
    released: 0,
    expired: 0,
    turns: 0,
  });
  for (const row of [unclaimed, claimed]) {
    assert.deepEqual((await speechEvents(row.messageId)).at(-1), {
      kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      deviceId: null,
      payload: { reason: SPEECH_EXPIRY_REASON.DUE },
    });
    assert.equal(await viewMarksUnspoken(row), true);
    assert.deepEqual(await claimSpeech(store, row.userId, row.messageId, PHONE, clock), {
      ok: false,
      refusal: SPEECH_REFUSAL.SETTLED,
    });
  }
  assert.deepEqual(
    (await openOffers({ userId: unclaimed.userId })).map((offer) => offer.messageId),
    [fresh.messageId],
  );
  assert.equal(await viewMarksUnspoken(fresh), false);
});

test("while a device reports quiet nothing is claimed, pushed, or expired; when it lifts the offer ends unspoken and one hold_release turn is queued per conversation", async () => {
  clock = NOW;
  const first = await offered();
  const { userId } = first;
  const second = await offered(userId);
  const claimed = await offered(userId);
  assert.equal((await claimSpeech(store, userId, claimed.messageId, MAC, clock)).ok, true);
  const elsewhere = await offered();
  const accounts = [userId, elsewhere.userId];
  const quietUntil = NOW + 30 * 60_000;
  await reportQuiet(userId, MAC, quietUntil);
  await reportQuiet(userId, PHONE, null);

  const held = await sweepSpeech(store, { now: clock, userIds: accounts });
  assert.deepEqual(held, { held: 3, released: 0, expired: 0, turns: 0 });
  assert.deepEqual((await speechEvents(first.messageId)).at(-1), {
    kind: CONVERSATION_EVENT_KIND.SPEECH_HELD,
    deviceId: null,
    payload: { quietUntil },
  });
  assert.deepEqual(
    new Map(
      (await openOffers({ userId })).map((offer) => [
        offer.messageId,
        [offer.state, offer.quietUntil, offer.claimedByDeviceId],
      ]),
    ),
    new Map([
      [first.messageId, [SPEECH_STATE.HELD, quietUntil, undefined]],
      [second.messageId, [SPEECH_STATE.HELD, quietUntil, undefined]],
      [claimed.messageId, [SPEECH_STATE.HELD, quietUntil, MAC]],
    ]),
  );
  assert.deepEqual(
    (await openOffers({ userId: elsewhere.userId })).map((offer) => offer.state),
    [SPEECH_STATE.OFFERED],
  );
  for (const refused of [
    claimSpeech(store, userId, first.messageId, PHONE, clock),
    markSpeechPushed(store, userId, first.messageId, clock, PHONE),
    markSpeechSpoken(store, userId, claimed.messageId, MAC),
  ]) {
    assert.deepEqual(await refused, { ok: false, refusal: SPEECH_REFUSAL.HELD });
  }

  // The same quiet standing writes nothing again, and the offers' own expiry passes under the hold.
  clock = NOW + SPEECH_OFFER.TTL_MS + 60_000;
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: accounts }), {
    held: 0,
    released: 0,
    expired: 1,
    turns: 0,
  });
  assert.deepEqual(
    (await speechEvents(elsewhere.messageId)).at(-1)?.kind,
    CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
  );
  assert.equal((await speechEvents(first.messageId)).length, 2);

  // A quiet moved later is held again; one moved earlier is not.
  const extended = quietUntil + 15 * 60_000;
  await reportQuiet(userId, PHONE, extended);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: accounts }), {
    held: 3,
    released: 0,
    expired: 0,
    turns: 0,
  });
  assert.deepEqual((await speechEvents(first.messageId)).at(-1)?.payload, { quietUntil: extended });
  await reportQuiet(userId, PHONE, null);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: accounts }), {
    held: 0,
    released: 0,
    expired: 0,
    turns: 0,
  });

  clock = extended;
  const released = await sweepSpeech(store, { now: clock, userIds: accounts });
  assert.deepEqual(released, { held: 0, released: 3, expired: 0, turns: 3 });
  for (const row of [first, second, claimed]) {
    assert.deepEqual((await speechEvents(row.messageId)).at(-1), {
      kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      deviceId: null,
      payload: { reason: SPEECH_EXPIRY_REASON.HOLD_RELEASED },
    });
    assert.equal(await viewMarksUnspoken(row), true);
    assert.deepEqual(await queuedTurns(row.conversationId), [
      { origin: TURN_ORIGIN.HOLD_RELEASE, status: TURN_STATUS.QUEUED },
    ]);
  }
  assert.deepEqual(await openOffers({ userId }), []);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: accounts }), {
    held: 0,
    released: 0,
    expired: 0,
    turns: 0,
  });
});

test("two held offers on one conversation release with one turn between them, and the sweep skips a conversation the Clear stamped and stops at its bound", async () => {
  clock = NOW;
  const first = await offered();
  const { userId, conversationId } = first;
  const messageId = await insertMessage(database.run, {
    userId,
    conversationId,
    seq: 2,
    turnId: first.turnId,
    clientId: `client-${randomUUID()}`,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [announcePart(`call_${randomUUID()}`, { briefing: "Another fixture agent finished." })],
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    createdAt: new Date(clock),
    finishedAt: new Date(clock),
  });
  assert.equal((await offerSpeech(store, userId, messageId, clock)).ok, true);
  const cleared = await offered(userId);
  await setConversationDeletedAt(database.run, cleared.conversationId, new Date(clock));

  const quietUntil = NOW + 30 * 60_000;
  await reportQuiet(userId, MAC, quietUntil);
  assert.deepEqual(await sweepSpeech(store, { now: clock, limit: 1, userIds: [userId] }), {
    held: 1,
    released: 0,
    expired: 0,
    turns: 0,
  });
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: [userId] }), {
    held: 1,
    released: 0,
    expired: 0,
    turns: 0,
  });

  // A standing hold does not starve the bound: with the held account's two
  // offers older than everything else, a read bounded to one still reaches
  // another account's due offer, because the held account is read apart.
  clock = NOW + 60_000;
  const starved = await offered();
  assert.deepEqual(
    await sweepSpeech(store, {
      now: NOW + 60_000 + SPEECH_OFFER.TTL_MS,
      limit: 1,
      userIds: [userId, starved.userId],
    }),
    { held: 0, released: 0, expired: 1, turns: 0 },
  );
  assert.deepEqual(
    (await speechEvents(starved.messageId)).at(-1)?.kind,
    CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
  );
  assert.deepEqual(
    (await openOffers({ userId })).map((offer) => offer.state),
    [SPEECH_STATE.HELD, SPEECH_STATE.HELD],
  );
  clock = NOW;
  assert.deepEqual(await speechEvents(cleared.messageId), [
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      deviceId: null,
      payload: { expiresAt: NOW + SPEECH_OFFER.TTL_MS },
    },
  ]);

  await reportQuiet(userId, MAC, null);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: [userId] }), {
    held: 0,
    released: 2,
    expired: 0,
    turns: 1,
  });
  assert.deepEqual(await queuedTurns(conversationId), [
    { origin: TURN_ORIGIN.HOLD_RELEASE, status: TURN_STATUS.QUEUED },
  ]);
});

test("a sweep write racing a settled transition is refused under the lock: the offer pushed between the read and the expiry stays pushed, and the sweep counts nothing", async () => {
  clock = NOW;
  const due = await offered();
  const settling: SpeechSweepStore = {
    run: database.run,
    writer: {
      enqueueTurn: (target, enqueue) => store.writer.enqueueTurn(target, enqueue),
      recordEvent: async (target, event) => {
        if (event.kind === CONVERSATION_EVENT_KIND.SPEECH_EXPIRED) {
          assert.equal(
            (await markSpeechPushed(store, target.userId, event.messageId, clock, PHONE)).ok,
            true,
          );
        }
        return store.writer.recordEvent(target, event);
      },
    },
  };
  assert.deepEqual(
    await sweepSpeech(settling, { now: NOW + SPEECH_OFFER.TTL_MS, userIds: [due.userId] }),
    {
      held: 0,
      released: 0,
      expired: 0,
      turns: 0,
    },
  );
  assert.deepEqual(
    (await speechEvents(due.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
  assert.equal(await viewMarksUnspoken(due), false);
});

test("the briefings a hold released are read back with their words and instants, a due expiry among them is not, and one a hold-release message already names is not read again", async () => {
  clock = NOW;
  const held = await offered();
  const { userId } = held;
  const alsoHeld = await offered(userId);
  const target = { userId, conversationId: held.conversationId };
  await reportQuiet(userId, MAC, NOW + 30 * 60_000);
  clock = NOW + 60_000;
  await sweepSpeech(store, { now: clock, userIds: [userId] });
  await reportQuiet(userId, MAC, null);
  clock = NOW + 120_000;
  const released = await sweepSpeech(store, { now: clock, userIds: [userId] });
  assert.equal(released.released, 2);

  const read = await database.run(releasedBriefings(target, { limit: 8 }));
  assert.deepEqual(
    read.map((briefing) => [briefing.messageId, briefing.briefing, briefing.decidedAt]),
    [[held.messageId, "One fixture agent finished.", NOW]],
  );
  assert.equal(read[0]?.releasedAt, NOW + 120_000);
  assert.equal(
    (
      await database.run(
        releasedBriefings({ userId, conversationId: alsoHeld.conversationId }, { limit: 8 }),
      )
    ).length,
    1,
  );

  // The re-decision's own opening words, as the relay writes them, are what marks the release carried.
  const words = await storeWriter({
    run: database.run,
    tools: CATALOG_TOOL_SET,
    now: () => new Date(clock),
  });
  const carried = await words.recordUserMessage(target, {
    clientId: "hold-release-words",
    text: holdReleasedInputText(
      read.map((briefing) => ({ briefing: briefing.briefing, decidedAt: briefing.decidedAt })),
      clock,
    ),
    metadata: { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOLD_RELEASE },
  });
  assert.equal(carried.ok, true);
  assert.deepEqual(await database.run(releasedBriefings(target, { limit: 8 })), []);

  clock = NOW;
  const expiredDue = await offered();
  clock = NOW + SPEECH_OFFER.TTL_MS;
  await sweepSpeech(store, { now: clock, userIds: [expiredDue.userId] });
  assert.deepEqual(
    await database.run(
      releasedBriefings(
        { userId: expiredDue.userId, conversationId: expiredDue.conversationId },
        { limit: 8 },
      ),
    ),
    [],
  );
});

test("the hold-release item the host writes reads back to exactly the briefings it named, alone and folded by eve between other items", () => {
  const plain = { briefing: "Plain.", decidedAt: NOW + 2_000 };
  const named = [
    { briefing: 'Quoted "words", a {brace} and a comma, here.', decidedAt: NOW },
    { briefing: "Two lines\nof briefing — with a dash and 日本語.", decidedAt: NOW + 1 },
    plain,
  ];
  const item = holdReleasedInputText(named, NOW + 3_000);
  assert.deepEqual(heldBriefingsNamed(item), named);

  // eve folds the deliveries waiting when a turn settles into one received message, a blank line between.
  const folded = [wakeInputText([], NOW + 3_000), item, wakeInputText([], NOW + 4_000)].join(
    "\n\n",
  );
  assert.deepEqual(heldBriefingsNamed(folded), named);
  const twice = [item, holdReleasedInputText([plain], NOW + 5_000)].join("\n\n");
  assert.equal(heldBriefingsNamed(twice).length, 4);

  assert.deepEqual(heldBriefingsNamed(wakeInputText([], NOW)), []);
  assert.deepEqual(heldBriefingsNamed(`${item.split("\n")[0]}\nnot json`), []);
  assert.deepEqual(heldBriefingsNamed(""), []);
});
