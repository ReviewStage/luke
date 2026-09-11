import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { afterAll, test } from "vitest";
import {
  BRAIN_TOOL,
  BRIEFING_PUSH_PAYLOAD_KEY,
  CONVERSATION_EVENT_KIND,
  DEVICE_PLATFORM,
  type DevicePlatform,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  PUSH_ENVIRONMENT,
  SPEECH_EXPIRY_REASON,
  type StoredUIMessage,
  TURN_ORIGIN,
  TURN_STATUS,
  type WireRecord,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/schema";
import {
  APNS_DELIVERY,
  APNS_INTERRUPTION_LEVEL,
  type ApnsDelivery,
  type ApnsNotification,
  apnsWireBody,
} from "../server/hosted/apns";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { deviceSeams } from "../server/hosted/device-store";
import {
  briefingNotification,
  pushSpeech,
  SPEECH_PUSH,
  SPEECH_PUSH_DECISION,
  type SpeechPushOutcome,
  type SpeechPushSeams,
  speechPushDecision,
} from "../server/hosted/speech-push";
import {
  claimSpeech,
  markSpeechPushed,
  type OpenSpeechOffersQuery,
  offerSpeech,
  openSpeechOffers,
  SPEECH_OFFER,
  SPEECH_REFUSAL,
  SPEECH_STATE,
  type SpeechOffer,
  type SpeechSweepStore,
  storeWriter,
  sweepSpeech,
} from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import {
  DeviceRowSchema,
  insertConversation,
  insertDevice,
  insertMessage,
  insertTurn,
  readDevicesByUser,
  readEventsByMessage,
  setDeviceActiveUntil,
  setDeviceQuietUntil,
} from "./support/store-rows";

/**
 * The push over the briefings on offer, against the real migrations. The
 * file shares one Postgres with every other store test on CI, so every pass
 * here names the accounts it created and every device row is minted fresh.
 * Synthetic fixtures throughout: the briefing is a fixture sentence, and no
 * real title, branch, or token appears.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = Date.parse("2026-09-11T10:00:00.000Z");
const BRIEFING = "One fixture agent finished and another is waiting on you.";
const SESSION = { providerId: "conductor", providerSessionId: "s-push-fixture" } as const;

let clock = NOW;
/** The sweep's store and the push pass's in one. */
const store: SpeechSweepStore = {
  run: database.run,
  writer: await storeWriter({
    run: database.run,
    tools: CATALOG_TOOL_SET,
    now: () => new Date(clock),
  }),
};

const openOffers = (query: OpenSpeechOffersQuery) => database.run(openSpeechOffers(query));

const NOTHING: SpeechPushOutcome = {
  pushed: 0,
  undelivered: 0,
  unaddressed: 0,
  unreadable: 0,
  waiting: 0,
};

interface Announced {
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
}

type MessageParts = StoredUIMessage["parts"];

function announcePart(input: WireRecord): MessageParts[number] {
  // SAFETY: a stored tool part in the SDK's own shape; the read under the catalog registry is the validation.
  return {
    type: `tool-${BRAIN_TOOL.ANNOUNCE}`,
    toolCallId: `call_${randomUUID()}`,
    state: "output-available",
    input,
    output: { status: "accepted" },
  } as unknown as MessageParts[number];
}

/** An observed conversation with one settled turn whose assistant row carries the parts given, as the relay leaves them. */
async function announced(userId: string, parts: MessageParts): Promise<Announced> {
  const conversationId = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
    providerId: SESSION.providerId,
    providerSessionId: `${SESSION.providerSessionId}-${randomUUID()}`,
  });
  const turnId = await insertTurn(database.run, {
    userId,
    conversationId,
    origin: TURN_ORIGIN.ROSTER_DIFF,
    status: TURN_STATUS.SETTLED,
    queuedAt: new Date(clock),
    settledAt: new Date(clock),
  });
  const messageId = await insertMessage(database.run, {
    userId,
    conversationId,
    seq: 1,
    turnId,
    clientId: turnId,
    role: MESSAGE_ROLE.ASSISTANT,
    parts,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    createdAt: new Date(clock),
    finishedAt: new Date(clock),
  });
  return { userId, conversationId, messageId };
}

async function offered(userId: string, briefing = BRIEFING): Promise<Announced> {
  const row = await announced(userId, [announcePart({ briefing })]);
  const offer = await offerSpeech(store, userId, row.messageId, clock);
  assert.equal(offer.ok, true);
  return row;
}

interface DeviceReport {
  readonly platform?: DevicePlatform;
  readonly activeUntil?: number | null;
  readonly quietUntil?: number | null;
  readonly push?: { readonly token: string; readonly environment: string } | null;
  readonly lastSeenAt?: number;
}

/** One device row of the account as it last reported itself; answers the row's id. */
async function device(userId: string, report: DeviceReport = {}): Promise<string> {
  const id = randomUUID();
  await insertDevice(database.run, {
    id,
    userId,
    installationId: `install-${id}`,
    platform: report.platform ?? DEVICE_PLATFORM.IOS,
    lastSeenAt: new Date(report.lastSeenAt ?? clock),
    activeUntil: report.activeUntil == null ? null : new Date(report.activeUntil),
    quietUntil: report.quietUntil == null ? null : new Date(report.quietUntil),
    pushToken: report.push?.token ?? null,
    pushEnvironment: report.push?.environment ?? null,
  });
  return id;
}

async function report(deviceId: string, change: Pick<DeviceReport, "activeUntil" | "quietUntil">) {
  if (change.activeUntil !== undefined) {
    await setDeviceActiveUntil(
      database.run,
      deviceId,
      change.activeUntil === null ? null : new Date(change.activeUntil),
    );
  }
  if (change.quietUntil !== undefined) {
    await setDeviceQuietUntil(
      database.run,
      deviceId,
      change.quietUntil === null ? null : new Date(change.quietUntil),
    );
  }
}

function token(): string {
  return randomUUID().replaceAll("-", "").repeat(2);
}

/** A sender that answers as scripted and keeps every notification it was handed. */
function fakeSender(answer: ApnsDelivery = APNS_DELIVERY.DELIVERED) {
  const sent: ApnsNotification[] = [];
  const forgotten: Array<{ userId: string; deviceId: string }> = [];
  const seams: SpeechPushSeams = {
    store,
    tools: CATALOG_TOOL_SET,
    send: async (notification) => {
      sent.push(notification);
      return answer;
    },
    forgetDevice: async (userId, deviceId) => {
      forgotten.push({ userId, deviceId });
      return deviceSeams(database.run).forgetDevice(userId, deviceId);
    },
  };
  return { seams, sent, forgotten };
}

async function speechEvents(messageId: string) {
  const rows = await readEventsByMessage(database.run, messageId);
  return rows.map((row) => ({ kind: row.kind, deviceId: row.device_id }));
}

async function deviceIds(userId: string): Promise<string[]> {
  const rows = await readDevicesByUser(database.run, userId);
  return rows.map((row) => Schema.decodeUnknownSync(DeviceRowSchema)(row).id);
}

function offer(overrides: Partial<SpeechOffer> = {}): SpeechOffer {
  return {
    userId: "user",
    conversationId: "conversation",
    messageId: "message",
    state: SPEECH_STATE.OFFERED,
    offeredAt: NOW,
    expiresAt: NOW + SPEECH_OFFER.TTL_MS,
    ...overrides,
  };
}

test("the rule: no active device pushes at once, an active device is given the grace and then pushed, a claim is never pushed, a hold is the sweep's, and a due offer is the sweep's", () => {
  assert.equal(speechPushDecision(offer(), false, NOW), SPEECH_PUSH_DECISION.PUSH);
  assert.equal(speechPushDecision(offer(), true, NOW), SPEECH_PUSH_DECISION.WAIT);
  assert.equal(
    speechPushDecision(offer(), true, NOW + SPEECH_PUSH.GRACE_MS - 1),
    SPEECH_PUSH_DECISION.WAIT,
  );
  assert.equal(
    speechPushDecision(offer(), true, NOW + SPEECH_PUSH.GRACE_MS),
    SPEECH_PUSH_DECISION.PUSH,
  );
  for (const active of [false, true]) {
    assert.equal(
      speechPushDecision(
        offer({ state: SPEECH_STATE.CLAIMED, claimedByDeviceId: "mac" }),
        active,
        NOW + SPEECH_PUSH.GRACE_MS,
      ),
      SPEECH_PUSH_DECISION.CLAIMED,
    );
    assert.equal(
      speechPushDecision(
        offer({ state: SPEECH_STATE.HELD, quietUntil: NOW + 60_000 }),
        active,
        NOW,
      ),
      SPEECH_PUSH_DECISION.HELD,
    );
    assert.equal(
      speechPushDecision(offer(), active, NOW + SPEECH_OFFER.TTL_MS),
      SPEECH_PUSH_DECISION.DUE,
    );
  }
  // A held offer past its instant is still held, not due: nothing expires under a hold.
  assert.equal(
    speechPushDecision(offer({ state: SPEECH_STATE.HELD }), false, NOW + SPEECH_OFFER.TTL_MS),
    SPEECH_PUSH_DECISION.HELD,
  );
});

test("the notification carries the briefing and the message's id and nothing else: one alert body, the default sound, the ordinary level, one custom key, no thread, no collapse id", () => {
  const messageId = randomUUID();
  const notification = briefingNotification(BRIEFING, messageId, {
    deviceId: "device",
    token: "ab".repeat(32),
    environment: PUSH_ENVIRONMENT.SANDBOX,
  });
  assert.equal("collapseId" in notification, false);
  assert.deepEqual(notification, {
    token: "ab".repeat(32),
    environment: PUSH_ENVIRONMENT.SANDBOX,
    payload: {
      aps: {
        alert: { body: BRIEFING },
        sound: "default",
        "interruption-level": APNS_INTERRUPTION_LEVEL.ACTIVE,
      },
      custom: { [BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID]: messageId },
    },
  });
  assert.deepEqual(JSON.parse(apnsWireBody(notification.payload)), {
    [BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID]: messageId,
    aps: {
      alert: { body: BRIEFING },
      sound: "default",
      "interruption-level": APNS_INTERRUPTION_LEVEL.ACTIVE,
    },
  });
});

test("Mac inactive: the briefing is pushed once to the most recently seen device with a token, whatever presence the phone itself reports, speech.pushed is written naming it, and a second pass pushes nothing", async () => {
  clock = NOW;
  const userId = await database.createUser();
  await device(userId, { platform: DEVICE_PLATFORM.MACOS, activeUntil: null, lastSeenAt: NOW });
  const older = await device(userId, {
    push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION },
    lastSeenAt: NOW - 60_000,
  });
  const phoneToken = token();
  // The phone's conversation screen reports presence on its poll, and nothing on it speaks: not a reason to wait.
  const phone = await device(userId, {
    push: { token: phoneToken, environment: PUSH_ENVIRONMENT.SANDBOX },
    activeUntil: NOW + SPEECH_OFFER.TTL_MS,
    lastSeenAt: NOW - 1_000,
  });
  const row = await offered(userId);
  const { seams, sent } = fakeSender();

  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.deepEqual(
    sent.map((notification) => [notification.token, notification.environment]),
    [[phoneToken, PUSH_ENVIRONMENT.SANDBOX]],
  );
  assert.deepEqual(
    sent.map((notification) => notification.payload.aps.alert),
    [{ body: BRIEFING }],
  );
  // The tap opens the Conversation at this offer's message, so the id sent is the offer's own.
  assert.deepEqual(
    sent.map((notification) => notification.payload.custom),
    [{ [BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID]: row.messageId }],
  );
  assert.deepEqual(await speechEvents(row.messageId), [
    { kind: CONVERSATION_EVENT_KIND.SPEECH_OFFERED, deviceId: null },
    { kind: CONVERSATION_EVENT_KIND.SPEECH_PUSHED, deviceId: phone },
  ]);
  assert.notEqual(phone, older);
  assert.deepEqual(await openOffers({ userId }), []);

  clock = NOW + 60_000;
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), NOTHING);
  assert.equal(sent.length, 1);
  // The settled state is what refuses a second push, at the store and not only in the pass.
  assert.deepEqual(await markSpeechPushed(store, userId, row.messageId, clock, phone), {
    ok: false,
    refusal: SPEECH_REFUSAL.SETTLED,
  });
});

test("Mac active and claimed: never pushed; Mac active and unclaimed: waited on inside the grace and pushed past it; a device gone idle ends the wait", async () => {
  clock = NOW;
  const userId = await database.createUser();
  const mac = await device(userId, {
    platform: DEVICE_PLATFORM.MACOS,
    activeUntil: NOW + SPEECH_OFFER.TTL_MS,
  });
  await device(userId, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const claimed = await offered(userId);
  assert.equal((await claimSpeech(store, userId, claimed.messageId, mac, clock)).ok, true);
  const unclaimed = await offered(userId);
  const { seams, sent } = fakeSender();

  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), {
    ...NOTHING,
    waiting: 1,
  });
  clock = NOW + SPEECH_PUSH.GRACE_MS - 1;
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), {
    ...NOTHING,
    waiting: 1,
  });
  assert.deepEqual(sent, []);

  clock = NOW + SPEECH_PUSH.GRACE_MS;
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(
    (await speechEvents(unclaimed.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
  assert.deepEqual(
    (await speechEvents(claimed.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_CLAIMED],
  );
  clock = NOW + SPEECH_OFFER.TTL_MS - 1;
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), NOTHING);
  assert.equal(sent.length, 1);

  // A fresh offer while the Mac is active waits; the Mac reporting idle is what ends the wait.
  const fresh = await offered(userId);
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), {
    ...NOTHING,
    waiting: 1,
  });
  await report(mac, { activeUntil: null });
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.deepEqual(
    (await speechEvents(fresh.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
});

test("quiet reported: nothing is pushed and nothing expires while it stands, whether or not the sweep has marked the hold, and when it lifts the offer is re-decided rather than pushed", async () => {
  clock = NOW;
  const userId = await database.createUser();
  const quietUntil = NOW + 30 * 60_000;
  const mac = await device(userId, { platform: DEVICE_PLATFORM.MACOS, quietUntil });
  await device(userId, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const row = await offered(userId);
  const { seams, sent } = fakeSender();

  // Before the sweep marks it, the push reads the devices' quiet itself.
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), NOTHING);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: [userId] }), {
    held: 1,
    released: 0,
    expired: 0,
    turns: 0,
  });
  // Past the offer's own instant, the hold still stands over both the push and the expiry.
  clock = NOW + SPEECH_OFFER.TTL_MS + 60_000;
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), NOTHING);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: [userId] }), {
    held: 0,
    released: 0,
    expired: 0,
    turns: 0,
  });
  assert.deepEqual(
    (await openOffers({ userId })).map((open) => open.state),
    [SPEECH_STATE.HELD],
  );
  assert.deepEqual(sent, []);

  // A quiet account's held offers are the oldest open rows; under a read bound of one they must not hide another account's push.
  const other = await database.createUser();
  await device(other, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const unheld = await offered(other);
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId, other], limit: 1 }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.deepEqual(
    (await speechEvents(unheld.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
  assert.equal(sent.length, 1);
  sent.length = 0;

  await report(mac, { quietUntil: null });
  // Between the quiet lifting and the sweep's release, the held offer is still not pushed.
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), NOTHING);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: [userId] }), {
    held: 0,
    released: 1,
    expired: 0,
    turns: 1,
  });
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId] }), NOTHING);
  assert.deepEqual(sent, []);
  const [, , ended] = (await readEventsByMessage(database.run, row.messageId)).map((event) => ({
    kind: event.kind,
    payload: event.payload,
  }));
  assert.deepEqual(ended, {
    kind: CONVERSATION_EVENT_KIND.SPEECH_EXPIRED,
    payload: { reason: SPEECH_EXPIRY_REASON.HOLD_RELEASED },
  });
});

test("an account with no token-holding device leaves the offer standing for the sweep; a due offer is never pushed stale; a row this build cannot read the words of is left standing", async () => {
  clock = NOW;
  const unaddressed = await database.createUser();
  await device(unaddressed, { platform: DEVICE_PLATFORM.MACOS });
  const standing = await offered(unaddressed);
  const nobody = await database.createUser();
  const alone = await offered(nobody);
  const unreadable = await database.createUser();
  await device(unreadable, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const wordless = await announced(unreadable, [
    // SAFETY: a stored text part in the SDK's own shape, with no announce call beside it.
    { type: "text", text: "A reply with no briefing on offer." } as unknown as MessageParts[number],
  ]);
  assert.equal((await offerSpeech(store, unreadable, wordless.messageId, clock)).ok, true);
  const accounts = [unaddressed, nobody, unreadable];
  const { seams, sent } = fakeSender();

  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: accounts }), {
    ...NOTHING,
    unaddressed: 2,
    unreadable: 1,
  });
  assert.deepEqual(sent, []);
  assert.deepEqual(
    (await openOffers({ userIds: accounts })).map((open) => open.messageId).sort(),
    [standing.messageId, alone.messageId, wordless.messageId].sort(),
  );

  // A token arriving at the offer's own instant is too late: a due offer is the sweep's, never pushed stale.
  clock = NOW + SPEECH_OFFER.TTL_MS;
  await device(unaddressed, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: accounts }), NOTHING);
  assert.deepEqual(sent, []);
  assert.deepEqual(await sweepSpeech(store, { now: clock, userIds: accounts }), {
    held: 0,
    released: 0,
    expired: 3,
    turns: 0,
  });
});

test("a send Apple refuses or the network drops leaves that offer settled and counted undelivered and ends the pass, leaving the rest standing; a token Apple reports gone takes its device row with it and the pass goes on", async () => {
  clock = NOW;
  const refused = await database.createUser();
  await device(refused, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const dropped = await offered(refused);
  clock = NOW + 1_000;
  const spared = await offered(refused);
  const failing = fakeSender(APNS_DELIVERY.FAILED);
  assert.deepEqual(await pushSpeech(failing.seams, { now: clock, userIds: [refused] }), {
    ...NOTHING,
    undelivered: 1,
  });
  assert.equal(failing.sent.length, 1);
  assert.deepEqual(failing.forgotten, []);
  assert.deepEqual(
    (await speechEvents(dropped.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
  assert.deepEqual(
    (await openOffers({ userId: refused })).map((open) => open.messageId),
    [spared.messageId],
  );
  // The next tick, with Apple answering, delivers the one left standing and the settled one is not sent again.
  const recovered = fakeSender();
  assert.deepEqual(await pushSpeech(recovered.seams, { now: clock, userIds: [refused] }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.equal(recovered.sent.length, 1);
  assert.deepEqual(await openOffers({ userId: refused }), []);

  const gone = await database.createUser();
  const stale = await device(gone, {
    push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION },
  });
  clock = NOW;
  const first = await offered(gone);
  clock = NOW + 1_000;
  const second = await offered(gone);
  const rejecting = fakeSender(APNS_DELIVERY.TOKEN_GONE);
  assert.deepEqual(await pushSpeech(rejecting.seams, { now: clock, userIds: [gone] }), {
    ...NOTHING,
    undelivered: 1,
    unaddressed: 1,
  });
  assert.deepEqual(rejecting.forgotten, [{ userId: gone, deviceId: stale }]);
  assert.deepEqual(await deviceIds(gone), []);
  assert.deepEqual(
    (await speechEvents(first.messageId)).map((event) => [event.kind, event.deviceId]),
    [
      [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, null],
      [CONVERSATION_EVENT_KIND.SPEECH_PUSHED, stale],
    ],
  );
  assert.deepEqual(
    (await openOffers({ userId: gone })).map((open) => open.messageId),
    [second.messageId],
  );
});

test("a pass spends its budget and leaves the rest standing unsettled for the next tick", async () => {
  clock = NOW;
  const userId = await database.createUser();
  await device(userId, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const first = await offered(userId);
  clock = NOW + 1_000;
  const second = await offered(userId);
  let wall = 0;
  const slow = fakeSender();
  const seams: SpeechPushSeams = {
    ...slow.seams,
    send: async (notification) => {
      wall += SPEECH_PUSH.BUDGET_MS;
      return slow.seams.send(notification);
    },
  };

  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId], clock: () => wall }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.equal(slow.sent.length, 1);
  assert.deepEqual(
    (await speechEvents(first.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
  assert.deepEqual(
    (await openOffers({ userId })).map((open) => open.messageId),
    [second.messageId],
  );
  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [userId], clock: () => wall }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.deepEqual(await openOffers({ userId }), []);
});

test("a pass reads only the accounts it is told", async () => {
  clock = NOW;
  const mine = await database.createUser();
  await device(mine, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const row = await offered(mine);
  const theirs = await database.createUser();
  await device(theirs, { push: { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION } });
  const other = await offered(theirs);
  const { seams, sent } = fakeSender();

  assert.deepEqual(await pushSpeech(seams, { now: clock, userIds: [mine] }), {
    ...NOTHING,
    pushed: 1,
  });
  assert.equal(sent.length, 1);
  assert.deepEqual(
    (await openOffers({ userIds: [mine, theirs] })).map((open) => open.messageId),
    [other.messageId],
  );
  assert.deepEqual(
    (await speechEvents(row.messageId)).map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED, CONVERSATION_EVENT_KIND.SPEECH_PUSHED],
  );
});
