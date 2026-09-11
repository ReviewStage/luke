import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  LIVE_BRAIN_SUBMISSION,
  type LiveSessionSource,
  sidebandOverSocket,
} from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { asc, eq } from "drizzle-orm";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import { CONVERSATION_EVENT_KIND, DEVICE_PLATFORM, MESSAGE_ROLE } from "../server/core";
import { devices } from "../server/db/devices-schema";
import { CONVERSATION_KIND, conversations, events, messages } from "../server/db/storage-schema";
import { voiceSessions, voiceTranscriptSegments } from "../server/db/voice-schema";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { payloadKeyRing } from "../server/hosted/encryption";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_SERVER_EVENT,
  type LiveAppendEvent,
  type LiveClientEvent,
  type LiveServerEventType,
} from "../server/live";
import { hostedLiveExchange } from "../server/voice/live-exchange";
import { voiceSessionRecord } from "../server/voice/session-record";
import { announceTurn, FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase, TEST_PAYLOAD_SECRET } from "./support/hosted-store-database";
import { delegated, heard, sessionStarted } from "./support/live-events";

/**
 * The hosted live exchange composed whole over the real store on PGlite: a
 * scripted sideband stands for the session, a fake eve for the judgment, and
 * the real relay for eve's stream. What these tests hold to is the lift's
 * acceptance in the parts this build can run: a spoken ask runs a turn
 * through the ask door and is spoken from the service's own appends, its
 * words and Luke's landing as segments and one user message; a briefing on
 * offer is claimed as the session's device before it is appended and marked
 * spoken by the session's own voice after; and a session with no device
 * speaks no briefing. Every row is an account's this test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
const KEYS = payloadKeyRing(TEST_PAYLOAD_SECRET);
/** Where every acknowledged append ends on the session's clock; the voice that follows begins past it. */
const APPEND_END_MS = 1_000;

/** The acknowledgment each append type earns, as the API names them. */
const ACKNOWLEDGMENT_OF: ReadonlyMap<LiveClientEvent["type"], LiveServerEventType> = new Map([
  [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND, LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED],
  [LIVE_CLIENT_EVENT.THINKING_APPEND, LIVE_SERVER_EVENT.THINKING_APPENDED],
  [LIVE_CLIENT_EVENT.COMMENTARY_APPEND, LIVE_SERVER_EVENT.COMMENTARY_APPENDED],
]);

const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});
const asks = askRecord(database.run);
const relay = new StreamRelay({
  writer,
  asks,
  offer: (target, turnId) =>
    offerBriefing({ run: database.run, writer, now: () => NOW }, target, turnId),
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(database.run, () => NOW);

/** An eve session id of this test's own: the relay names a turn by session and eve turn, so a counted id would collide across the files that share one database on CI. */
function mintEveSession(): string {
  return `wrun_${randomUUID()}`;
}

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    async open(message) {
      eve.opened.push(message);
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintEveSession() };
    },
    async send(sessionId) {
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: "delivery-1" };
    },
    async cancel() {
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED };
    },
  };
  return eve;
}

async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
}

async function device(userId: string): Promise<string> {
  const id = randomUUID();
  await database.db.insert(devices).values({
    id,
    userId,
    installationId: `install-${id}`,
    platform: DEVICE_PLATFORM.IOS,
    lastSeenAt: new Date(NOW),
  });
  return id;
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await relay.handle(event, standing);
}

async function until(predicate: () => boolean, what: () => string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what()}`);
}

/** The exchange composed over one scripted session, the way the voice service would compose it once it attaches. */
async function stand(target: ConversationTarget, deviceId: string | undefined) {
  const liveSessionId = `sess_${randomUUID()}`;
  await sessionRecord.register({ userId: target.userId, sessionId: liveSessionId });
  if (deviceId !== undefined) {
    await database.db
      .update(voiceSessions)
      .set({ deviceId })
      .where(eq(voiceSessions.liveSessionId, liveSessionId));
  }
  const socket = new FakeLiveSocket();
  const source: LiveSessionSource = {
    create: async (input) => ({
      sessionId: liveSessionId,
      sdpAnswer: `answer-for-${input.sdpOffer}`,
      attach: async () => sidebandOverSocket(socket),
    }),
    setVoice: () => undefined,
    diagnostics: () => {
      throw new Error("not read here");
    },
  };
  // The session's side of every send, as OpenAI would answer it: each append acknowledged
  // on the timeline at once, and a close answered with the final event.
  socket.onSent((frame) => {
    const sent: LiveClientEvent = JSON.parse(frame);
    if (sent.type === LIVE_CLIENT_EVENT.CLOSE) {
      socket.receive({
        type: LIVE_SERVER_EVENT.SESSION_CLOSED,
        event_id: "closed",
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
        usage: { seconds: 1 },
      });
      return;
    }
    const acknowledged = ACKNOWLEDGMENT_OF.get(sent.type);
    if (acknowledged === undefined) return;
    socket.receive({
      type: acknowledged,
      event_id: `ack-${sent.event_id}`,
      client_event_id: sent.event_id,
      start_ms: 0,
      end_ms: APPEND_END_MS,
    });
  });
  const eve = fakeEve();
  const reports: string[] = [];
  const exchange = hostedLiveExchange({
    userId: target.userId,
    liveSessionId,
    conversationId: target.conversationId,
    context: { db: database.db, run: database.run, keys: KEYS },
    writer,
    eve,
    source: () => source,
    conversationEntries: () => [],
    rosterView: () => "roster: one session",
    emit: () => undefined,
    now: () => NOW,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (timer) => {
      // SAFETY: a timer this composition cancels is one the scheduler above made, a Node timeout.
      clearTimeout(timer as NodeJS.Timeout);
    },
    createId: () => randomUUID(),
    report: (message) => reports.push(message),
  });
  const created = await exchange.service.createSession("offer");
  assert.ok(created);
  socket.receive(sessionStarted(liveSessionId));
  const commentary = (): LiveAppendEvent[] =>
    socket.sent
      .map((frame): LiveClientEvent => JSON.parse(frame))
      .filter(
        (event): event is LiveAppendEvent => event.type === LIVE_CLIENT_EVENT.COMMENTARY_APPEND,
      );
  return { liveSessionId, socket, eve, exchange, reports, commentary };
}

function socketSent(f: { socket: FakeLiveSocket }): string {
  const types = f.socket.sent.map((frame) => {
    const sent: LiveClientEvent = JSON.parse(frame);
    return sent.type;
  });
  return JSON.stringify(types);
}

async function speechEventsOf(messageId: string) {
  const rows = await database.db
    .select({ kind: events.kind })
    .from(events)
    .where(eq(events.messageId, messageId))
    .orderBy(asc(events.seq));
  return rows.map((row) => row.kind);
}

test("a spoken ask runs a turn through the ask door and is spoken from the service's own appends, its words one user message and both speakers' words segments", async () => {
  const target = await account();
  const f = await stand(target, undefined);
  f.socket.receive(heard("What needs me?", 1000, 2400));
  f.socket.receive(delegated("dl_1", 2500));
  await until(
    () => f.eve.opened.length === 1,
    () => `the ask to reach eve; reports ${JSON.stringify(f.reports)}`,
  );
  assert.deepEqual(
    f.eve.opened.map((message) => [message.conversationId, message.turn]),
    [[target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
  );
  const recorded = await asks.latestSession(target.userId, target.conversationId);
  assert.ok(recorded);
  await play(spokenTurn(FIRST_EVE_TURN, NOW), {
    sessionId: recorded,
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  });
  const diagnosis = async () => {
    const ask = (await asks.latestSession(target.userId, target.conversationId)) ?? "none";
    const turn = await database.store.turns.named(target.userId, [
      hostTurnId(recorded, FIRST_EVE_TURN),
    ]);
    const rows = await database.db
      .select({ clientId: messages.clientId, role: messages.role })
      .from(messages)
      .where(eq(messages.conversationId, target.conversationId));
    return `ask session ${ask}; turn rows ${turn.length} (${turn[0]?.status}); messages ${JSON.stringify(rows)}; commentary ${JSON.stringify(f.commentary().map((e) => e.content))}; reports ${JSON.stringify(f.reports)}; sent ${socketSent(f)}`;
  };
  for (let attempt = 0; attempt < 400 && f.commentary().length < 2; attempt += 1) await sleep(5);
  if (f.commentary().length !== 2) assert.fail(`the reply was not spoken: ${await diagnosis()}`);
  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [
      ["dl_1", "One agent finished."],
      ["dl_1", "Another is waiting on you."],
    ],
  );
  const rows = await database.db
    .select({ clientId: messages.clientId, role: messages.role })
    .from(messages)
    .where(eq(messages.conversationId, target.conversationId))
    .orderBy(asc(messages.seq));
  // One user row stands for one spoken ask: the developer's words as the session transcribed
  // them, under the delegation's id. The question as eve received it is on the ask's record,
  // never a second line.
  const userRows = rows.filter((row) => row.role === MESSAGE_ROLE.USER).map((row) => row.clientId);
  assert.deepEqual(userRows, ["dl_1"]);
  const [session] = await database.db
    .select({ id: voiceSessions.id })
    .from(voiceSessions)
    .where(eq(voiceSessions.liveSessionId, f.liveSessionId));
  assert.ok(session);
  const segments = await database.db
    .select({ text: voiceTranscriptSegments.text })
    .from(voiceTranscriptSegments)
    .where(eq(voiceTranscriptSegments.voiceSessionId, session.id));
  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["What needs me?"],
  );
  await f.exchange.stop();
});

test("a briefing on offer is claimed as the session's device before it is appended, and the session's own voice past the append marks it spoken", async () => {
  const target = await account();
  const deviceId = await device(target.userId);
  const f = await stand(target, deviceId);
  const standing: RelayStanding = {
    sessionId: mintEveSession(),
    target,
    turn: BRAIN_HOST_TURN.OBSERVATION,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  await play(announceTurn(FIRST_EVE_TURN, "One agent finished.", NOW), standing);
  const [offer] = await database.store.speech.open(target.userId);
  assert.ok(offer);

  await f.exchange.briefings.look();
  await until(
    () => f.commentary().length === 1,
    () => `the briefing to be appended; reports ${JSON.stringify(f.reports)}`,
  );
  assert.deepEqual(
    f.commentary().map((event) => [event.delegation_id, event.content]),
    [[null, "One agent finished."]],
  );
  assert.deepEqual(await speechEventsOf(offer.messageId), [
    CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
    CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
  ]);

  f.socket.receive({
    type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
    event_id: "out-1",
    delta: "One agent finished.",
    start_ms: 4000,
    end_ms: 5200,
  });
  await until(
    () => f.reports.length === 0 && true,
    () => "nothing refused",
  );
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await speechEventsOf(offer.messageId)).length === 3) break;
    await sleep(5);
  }
  assert.deepEqual(await speechEventsOf(offer.messageId), [
    CONVERSATION_EVENT_KIND.SPEECH_OFFERED,
    CONVERSATION_EVENT_KIND.SPEECH_CLAIMED,
    CONVERSATION_EVENT_KIND.SPEECH_SPOKEN,
  ]);
  assert.deepEqual(f.reports, []);
  await f.exchange.stop();
});

test("a session whose row names no device appends no briefing: the offer stands unclaimed for the push or the sweep", async () => {
  const target = await account();
  const f = await stand(target, undefined);
  await play(announceTurn(FIRST_EVE_TURN, "Not for this session.", NOW), {
    sessionId: mintEveSession(),
    target,
    turn: BRAIN_HOST_TURN.OBSERVATION,
    model: "scripted-model",
    state: memoryRelayState(),
  });
  const [offer] = await database.store.speech.open(target.userId);
  assert.ok(offer);
  await f.exchange.briefings.look();
  await sleep(30);
  assert.deepEqual(f.commentary(), []);
  assert.deepEqual(await speechEventsOf(offer.messageId), [CONVERSATION_EVENT_KIND.SPEECH_OFFERED]);
  assert.equal(f.reports.length, 1);
  await f.exchange.stop();
});

test("after a Clear, a spoken ask is refused at the door and eve is not reached: the record and the ask name one conversation, never the record's old main and eve's new one", async () => {
  const target = await account();
  const f = await stand(target, await device(target.userId));
  const cleared = await database.store.main.clear(target.userId, new Date(NOW));
  assert.deepEqual(cleared.cleared, [target.conversationId]);

  const refused = await f.exchange.brain.submitAsk({
    submissionId: randomUUID(),
    question: "Developer: still there?",
  });
  assert.equal(refused.outcome, LIVE_BRAIN_SUBMISSION.REFUSED);
  assert.deepEqual(f.eve.opened, []);
  await f.exchange.stop();
});
