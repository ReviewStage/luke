import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, test } from "vitest";
import {
  BRAIN_TOOL,
  CONVERSATION_EVENT_KIND,
  CONVERSATION_VIEW_TOOL_KIND,
  type ConversationViewEvent,
  DEVICE_PLATFORM,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  readStoredUIMessages,
  SPEECH_EXPIRY_REASON,
  type StoredUIMessage,
  selectConversationView,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
  type WireRecord,
} from "../server/core";
import { devices } from "../server/db/devices-schema";
import { db } from "../server/db/query";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  claimSpeech,
  markSpeechPushed,
  offerSpeech,
  openSpeechOffers,
  SPEECH_STATE,
  type SpeechStore,
  storeWriter,
  sweepSpeech,
} from "../server/hosted/store";
import {
  markSpeechSpoken,
  type OpenSpeechOffersQuery,
  SPEECH_OFFER,
  SPEECH_REFUSAL,
  type SpeechSweepStore,
} from "../server/hosted/store/speech";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  insertConversation,
  insertEvent,
  insertMessage,
  insertTurn,
  readEventsByMessage,
  readMessageById,
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
  writer: await database.run(
    storeWriter({
      tools: CATALOG_TOOL_SET,
      now: () => new Date(clock),
    }),
  ),
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

/** An observed conversation with one settled transcript-change turn whose answer announced a briefing, as the relay leaves them. */
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
    origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
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
  const offer = await database.run(offerSpeech(store, row.userId, row.messageId, clock));
  assert.equal(offer.ok, true);
  return row;
}

async function speechEvents(messageId: string) {
  const rows = await readEventsByMessage(database.run, messageId);
  return rows.map((row) => ({ kind: row.kind, deviceId: row.deviceId, payload: row.payload }));
}

async function reportQuiet(userId: string, deviceId: string, quietUntil: number | null) {
  await database.run(
    Effect.gen(function* () {
      const at = quietUntil === null ? null : new Date(quietUntil);
      const installationId = `install-${deviceId}-${userId}`;
      // Note that the conflicting update sets the values the insert carried
      // rather than reading them back out of `excluded`, because a single-row
      // insert's `excluded` row is exactly those values.
      yield* db
        .insert(devices)
        .values({
          id: deviceId,
          userId,
          installationId,
          platform: DEVICE_PLATFORM.MACOS,
          quietUntil: at,
        })
        .onConflictDoUpdate({
          target: devices.id,
          set: { userId, installationId, quietUntil: at },
        });
    }),
  );
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
        messages: [{ message, seq: 1, turnId: row.turnId, createdAt: NOW, placedAt: NOW }],
      },
    ],
    turns: [
      {
        id: row.turnId,
        origin: TURN_ORIGIN.TRANSCRIPT_CHANGE,
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
  const first = await database.run(offerSpeech(store, row.userId, row.messageId, clock));
  assert.equal(first.ok, true);
  const again = await database.run(offerSpeech(store, row.userId, row.messageId, clock + 5_000));
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
  assert.deepEqual(await database.run(offerSpeech(store, stranger, row.messageId, clock)), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_FOUND,
  });
  assert.deepEqual(await database.run(offerSpeech(store, row.userId, randomUUID(), clock)), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_FOUND,
  });
  const unoffered = await announced(row.userId);
  assert.deepEqual(
    await database.run(markSpeechSpoken(store, row.userId, unoffered.messageId, MAC)),
    {
      ok: false,
      refusal: SPEECH_REFUSAL.NOT_OFFERED,
    },
  );
  assert.equal(await viewMarksUnspoken(row), false);
});

test("at most one authorization to speak per briefing, never that it was heard: of two devices claiming at once exactly one is authorized, only that one can report it spoken, and the report closes the offer", async () => {
  clock = NOW;
  const row = await offered();
  const [mac, phone] = await Promise.all([
    database.run(claimSpeech(store, row.userId, row.messageId, MAC, clock)),
    database.run(claimSpeech(store, row.userId, row.messageId, PHONE, clock)),
  ]);
  const outcomes = [mac, phone];
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.deepEqual(
    outcomes.filter((outcome) => !outcome.ok),
    [{ ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED }],
  );
  const winner = mac.ok ? MAC : PHONE;
  const loser = mac.ok ? PHONE : MAC;
  assert.deepEqual(
    await database.run(claimSpeech(store, row.userId, row.messageId, loser, clock)),
    {
      ok: false,
      refusal: SPEECH_REFUSAL.ALREADY_CLAIMED,
    },
  );
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

  assert.deepEqual(await database.run(markSpeechSpoken(store, row.userId, row.messageId, loser)), {
    ok: false,
    refusal: SPEECH_REFUSAL.NOT_CLAIMANT,
  });
  const spoken = await database.run(markSpeechSpoken(store, row.userId, row.messageId, winner));
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
    database.run(markSpeechSpoken(store, row.userId, row.messageId, winner)),
    database.run(claimSpeech(store, row.userId, row.messageId, PHONE, clock)),
    database.run(markSpeechPushed(store, row.userId, row.messageId, clock)),
  ]) {
    assert.deepEqual(await late, { ok: false, refusal: SPEECH_REFUSAL.SETTLED });
  }
  assert.equal(await viewMarksUnspoken(row), false);

  const unclaimed = await offered(row.userId);
  assert.deepEqual(
    await database.run(markSpeechSpoken(store, row.userId, unclaimed.messageId, MAC)),
    {
      ok: false,
      refusal: SPEECH_REFUSAL.NOT_CLAIMED,
    },
  );
});

test("a claim racing a push: exactly one lands, whichever reached the lock first, two pushes racing land one, and a duplicate offer told again is the same offer rather than a state", async () => {
  clock = NOW;
  const raced = await offered();
  const [claim, push] = await Promise.all([
    database.run(claimSpeech(store, raced.userId, raced.messageId, MAC, clock)),
    database.run(markSpeechPushed(store, raced.userId, raced.messageId, clock, PHONE)),
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
    database.run(markSpeechPushed(store, twice.userId, twice.messageId, clock, MAC)),
    database.run(markSpeechPushed(store, twice.userId, twice.messageId, clock, PHONE)),
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
    writer: {
      recordEvent: (target, event) =>
        Effect.flatMap(
          event.kind === CONVERSATION_EVENT_KIND.SPEECH_CLAIMED
            ? Effect.tap(
                markSpeechPushed(store, target.userId, event.messageId, clock, PHONE),
                (pushed) => Effect.sync(() => assert.equal(pushed.ok, true)),
              )
            : Effect.void,
          () => store.writer.recordEvent(target, event),
        ),
    },
  };
  const settledUnderneath = await offered(raced.userId);
  assert.deepEqual(
    await database.run(
      claimSpeech(interposed, settledUnderneath.userId, settledUnderneath.messageId, MAC, clock),
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
    writer: {
      recordEvent: (target, event) =>
        Effect.flatMap(
          event.kind === CONVERSATION_EVENT_KIND.SPEECH_PUSHED
            ? Effect.tap(
                claimSpeech(store, target.userId, event.messageId, MAC, clock),
                (claimed) => Effect.sync(() => assert.equal(claimed.ok, true)),
              )
            : Effect.void,
          () => store.writer.recordEvent(target, event),
        ),
    },
  };
  const takenUnderneath = await offered(raced.userId);
  assert.deepEqual(
    await database.run(
      markSpeechPushed(
        claimedUnderneath,
        takenUnderneath.userId,
        takenUnderneath.messageId,
        clock,
        PHONE,
      ),
    ),
    { ok: false, refusal: SPEECH_REFUSAL.ALREADY_CLAIMED },
  );
  assert.deepEqual(
    (await speechEvents(takenUnderneath.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED],
  );

  const claimed = await offered(raced.userId);
  assert.equal(
    (await database.run(claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock))).ok,
    true,
  );
  await database.run(
    store.writer.recordEvent(
      { userId: claimed.userId, conversationId: claimed.conversationId },
      { messageId: claimed.messageId, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, unless: [] },
    ),
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
  const pushed = await database.run(
    markSpeechPushed(store, unclaimed.userId, unclaimed.messageId, clock, PHONE),
  );
  assert.equal(pushed.ok, true);
  assert.deepEqual(
    (await speechEvents(unclaimed.messageId)).map((event) => [event.kind, event.deviceId]),
    [
      [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
      [CONVERSATION_EVENT_KIND.SPEECH_PUSHED, PHONE],
    ],
  );

  const claimed = await offered(unclaimed.userId);
  assert.equal(
    (await database.run(claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock))).ok,
    true,
  );
  assert.deepEqual(
    await database.run(markSpeechPushed(store, claimed.userId, claimed.messageId, clock)),
    {
      ok: false,
      refusal: SPEECH_REFUSAL.ALREADY_CLAIMED,
    },
  );
  assert.equal(
    (await database.run(markSpeechSpoken(store, claimed.userId, claimed.messageId, MAC))).ok,
    true,
  );

  const due = await offered(unclaimed.userId);
  const later = clock + SPEECH_OFFER.TTL_MS;
  assert.deepEqual(await database.run(markSpeechPushed(store, due.userId, due.messageId, later)), {
    ok: false,
    refusal: SPEECH_REFUSAL.EXPIRED,
  });
  assert.deepEqual(await database.run(claimSpeech(store, due.userId, due.messageId, MAC, later)), {
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
  assert.equal(
    (await database.run(claimSpeech(store, claimed.userId, claimed.messageId, MAC, clock))).ok,
    true,
  );
  clock = NOW + 60_000;
  const fresh = await offered(unclaimed.userId);
  clock = NOW;
  const unreadable = await announced(unclaimed.userId);
  await database.run(
    store.writer.recordEvent(
      { userId: unreadable.userId, conversationId: unreadable.conversationId },
      { messageId: unreadable.messageId, kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, unless: [] },
    ),
  );

  const accounts = [unclaimed.userId];
  const early = await database.run(
    sweepSpeech(store, {
      now: clock + SPEECH_OFFER.TTL_MS - 1,
      userIds: accounts,
    }),
  );
  assert.deepEqual(early, { expired: 1 });
  assert.deepEqual(await speechEvents(unreadable.messageId), [
    { kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, deviceId: null, payload: null },
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      deviceId: null,
      payload: { reason: SPEECH_EXPIRY_REASON.DUE },
    },
  ]);

  clock = NOW + SPEECH_OFFER.TTL_MS;
  const due = await database.run(sweepSpeech(store, { now: clock, userIds: accounts }));
  assert.deepEqual(due, { expired: 2 });
  assert.deepEqual(await database.run(sweepSpeech(store, { now: clock, userIds: accounts })), {
    expired: 0,
  });
  for (const row of [unclaimed, claimed]) {
    assert.deepEqual((await speechEvents(row.messageId)).at(-1), {
      kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      deviceId: null,
      payload: { reason: SPEECH_EXPIRY_REASON.DUE },
    });
    assert.equal(await viewMarksUnspoken(row), true);
    assert.deepEqual(
      await database.run(claimSpeech(store, row.userId, row.messageId, PHONE, clock)),
      {
        ok: false,
        refusal: SPEECH_REFUSAL.SETTLED,
      },
    );
  }
  assert.deepEqual(
    (await openOffers({ userId: unclaimed.userId })).map((offer) => offer.messageId),
    [fresh.messageId],
  );
  assert.equal(await viewMarksUnspoken(fresh), false);
});

test("a quiet instant mutes and saves nothing: an offer of an account reporting quiet expires due on its own instant like any other, and the sweep skips a conversation the Clear stamped and stops at its bound", async () => {
  clock = NOW;
  const first = await offered();
  const { userId } = first;
  const cleared = await offered(userId);
  await setConversationDeletedAt(database.run, cleared.conversationId, new Date(clock));
  clock = NOW + 1_000;
  const second = await offered(userId);
  await reportQuiet(userId, MAC, NOW + 30 * 60_000);

  assert.deepEqual(await database.run(sweepSpeech(store, { now: clock, userIds: [userId] })), {
    expired: 0,
  });
  assert.deepEqual(
    (await openOffers({ userId })).map((offer) => offer.state),
    [SPEECH_STATE.OFFERED, SPEECH_STATE.OFFERED],
  );

  // Under the quiet the offers still expire on their instant, the bound taking the oldest first.
  clock = NOW + SPEECH_OFFER.TTL_MS;
  assert.deepEqual(
    await database.run(sweepSpeech(store, { now: clock, limit: 1, userIds: [userId] })),
    { expired: 1 },
  );
  assert.deepEqual(
    (await openOffers({ userId })).map((offer) => offer.messageId),
    [second.messageId],
  );
  clock = NOW + 1_000 + SPEECH_OFFER.TTL_MS;
  assert.deepEqual(await database.run(sweepSpeech(store, { now: clock, userIds: [userId] })), {
    expired: 1,
  });
  for (const row of [first, second]) {
    assert.deepEqual((await speechEvents(row.messageId)).at(-1), {
      kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
      deviceId: null,
      payload: { reason: SPEECH_EXPIRY_REASON.DUE },
    });
  }
  assert.deepEqual(await speechEvents(cleared.messageId), [
    {
      kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
      deviceId: null,
      payload: { expiresAt: NOW + SPEECH_OFFER.TTL_MS },
    },
  ]);
  await reportQuiet(userId, MAC, null);
  assert.deepEqual(await database.run(sweepSpeech(store, { now: clock, userIds: [userId] })), {
    expired: 0,
  });
});

test("a sweep write racing a settled transition is refused under the lock: the offer pushed between the read and the expiry stays pushed, and the sweep counts nothing", async () => {
  clock = NOW;
  const due = await offered();
  const settling: SpeechSweepStore = {
    writer: {
      recordEvent: (target, event) =>
        Effect.flatMap(
          event.kind === CONVERSATION_EVENT_KIND.SPEECH_EXPIRED
            ? Effect.tap(
                markSpeechPushed(store, target.userId, event.messageId, clock, PHONE),
                (pushed) => Effect.sync(() => assert.equal(pushed.ok, true)),
              )
            : Effect.void,
          () => store.writer.recordEvent(target, event),
        ),
    },
  };
  assert.deepEqual(
    await database.run(
      sweepSpeech(settling, { now: NOW + SPEECH_OFFER.TTL_MS, userIds: [due.userId] }),
    ),
    { expired: 0 },
  );
  assert.deepEqual(
    (await speechEvents(due.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
  assert.equal(await viewMarksUnspoken(due), false);
});
