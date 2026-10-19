import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { askRecord } from "@luke/database/models/asks";
import { hostTurnId } from "@luke/database/models/ids";
import { openTaskConversation } from "@luke/database/models/task-store";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  openHostedStoreTestDatabase,
  readMessagesByConversationTyped,
  readVoiceSessionByLiveSessionId,
  readVoiceTranscriptSegmentsBySession,
  startTask,
} from "@luke/database/testing";
import {
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DEFAULTS,
  LIVE_SERVER_EVENT,
  type LiveAppendEvent,
  type LiveClientEvent,
  type LiveServerEventType,
} from "@luke/live";
import { sidebandOverSocket } from "@luke/voice/live-session";
import { FakeLiveSocket } from "@luke/voice/testing";
import { Deferred, Duration, Effect, Exit, Option, Schema, Scope, Stream } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { BRAIN_HOST_TURN } from "../agents/brain-host/bounds.js";
import { BRAIN_EXPLORE_ASK } from "../agents/brain-host/brain.js";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../agents/brain-host/eve-sessions.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "../agents/brain-host/relay.js";
import { MESSAGE_ROLE } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import { FIRST_EVE_TURN, spokenTurn } from "../testing/eve-turns.js";
import { delegated, heard, sessionStarted } from "../testing/live-events.js";
import { tickingLiveWake } from "../testing/live-wake.js";
import { settled } from "../testing/settle.js";
import { hostedLiveExchange } from "./live-exchange.js";

/**
 * The hosted live exchange composed whole over the real store on PGlite: a
 * scripted sideband stands for the session, a fake eve for the judgment, and
 * the real relay for eve's stream. What these tests hold to is the lift's
 * acceptance in the parts this build can run: a spoken ask runs a turn
 * through the ask door and is spoken from the service's own appends, its
 * words and Luke's landing as segments and one user message; an ask once the
 * task is gone reaches nobody; and the plan's notetaker saves what was said.
 * Every row is an account's this test created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;

const DelegatedMetadataSchema = Schema.Struct({ delegation_id: Schema.String });

/** The delegation a row's metadata names, where it names one. */
function delegationOf(row: { readonly metadata: unknown }): string | undefined {
  return Schema.is(DelegatedMetadataSchema)(row.metadata) ? row.metadata.delegation_id : undefined;
}
/** Where every acknowledged append ends on the session's clock; the voice that follows begins past it. */
const APPEND_END_MS = 1_000;

/** The acknowledgment each append type earns, as the API names them. */
const ACKNOWLEDGMENT_OF: ReadonlyMap<LiveClientEvent["type"], LiveServerEventType> = new Map([
  [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND, LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED],
  [LIVE_CLIENT_EVENT.THINKING_APPEND, LIVE_SERVER_EVENT.THINKING_APPENDED],
  [LIVE_CLIENT_EVENT.COMMENTARY_APPEND, LIVE_SERVER_EVENT.COMMENTARY_APPENDED],
]);

const writer = await database.run(
  storeWriter({
    tools: HOSTED_TOOL_SET,
  }),
);
const askEffects = askRecord();
const asks = {
  record: (write: Parameters<typeof askEffects.record>[0]) =>
    database.run(askEffects.record(write)),
  named: (userId: string, id: string) => database.run(askEffects.named(userId, id)),
  latestSession: (userId: string, conversationId: string) =>
    database.run(askEffects.latestSession(userId, conversationId)),
  dispatchOnce: (
    target: Parameters<typeof askEffects.dispatchOnce>[0],
    id: string,
    dispatch: Parameters<typeof askEffects.dispatchOnce>[2],
  ) => database.run(askEffects.dispatchOnce(target, id, dispatch)),
  bindDeliveries: (
    target: Parameters<typeof askEffects.bindDeliveries>[0],
    deliveryIds: Parameters<typeof askEffects.bindDeliveries>[1],
    turnId: string,
  ) => database.run(askEffects.bindDeliveries(target, deliveryIds, turnId)),
};
const relay = new StreamRelay({
  writer,
  asks: { binding: askEffects, stopTurn: () => Effect.void },
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(() => NOW);

/** An eve session id of this test's own: the relay names a turn by session and eve turn, so a counted id would collide across the files that share one database on CI. */
function mintEveSession(): string {
  return `wrun_${randomUUID()}`;
}

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
  /** Every exploring a fresh session asked for, which eve declines unless `explores` is set. */
  readonly explored: EveMessage[];
  /** Whether eve takes a fresh session's exploring; off, so a test of the developer's asks finds their first ask opens the session. */
  explores: boolean;
  /** The session each open was answered with, in order: eve's own record of what it took. */
  readonly sessions: string[];
  /** While set, an open has taken the message and answers only once this settles, as eve across the network does. */
  answerWhen: Deferred.Deferred<void> | undefined;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    explored: [],
    explores: false,
    sessions: [],
    answerWhen: undefined,
    open(message) {
      return Effect.gen(function* () {
        if (message.message === BRAIN_EXPLORE_ASK) {
          eve.explored.push(message);
          if (!eve.explores) {
            return { outcome: EVE_SEND_OUTCOME.FAILED, status: HOSTED_HTTP_STATUS.BAD_GATEWAY };
          }
        }
        const sessionId = mintEveSession();
        eve.opened.push(message);
        eve.sessions.push(sessionId);
        if (eve.answerWhen !== undefined) yield* Deferred.await(eve.answerWhen);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId };
      });
    },
    send(sessionId) {
      return Effect.succeed({
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId,
        deliveryId: "delivery-1",
      });
    },
    cancel() {
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED });
    },
    reset() {
      return Effect.die(new Error("this suite retires no session"));
    },
    stream() {
      return Stream.empty;
    },
  };
  return eve;
}

/** An account holding one task, and the task's conversation every call about it lands in. */
interface TaskTarget extends ConversationTarget {
  readonly taskId: string;
}

async function account(): Promise<TaskTarget> {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, { name: "Teammate invitations" }));
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(userId, task.id)),
  ).conversationId;
  return { userId, conversationId, taskId: task.id };
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await database.run(relay.handle(event, standing));
}

/** How often a follow's watch hears a change on the real clock, as Realtime would hear each write the turn makes. */
const FOLLOW_TICK = Duration.millis(5);

/** The exchange composed over one scripted session, the way the voice service would compose it once it attaches. */
async function stand(
  target: TaskTarget,
  options: {
    /** A session an earlier exchange stood on, attached to again as a device's re-attach finds it: already started. */
    readonly reattach?: string;
    /** Whether eve takes the session's exploring as it starts. */
    readonly explores?: boolean;
  } = {},
) {
  const liveSessionId = options.reattach ?? `sess_${randomUUID()}`;
  if (options.reattach === undefined) {
    await database.run(
      sessionRecord.register({
        userId: target.userId,
        sessionId: liveSessionId,
        taskId: target.taskId,
        attachId: randomUUID(),
        model: LIVE_DEFAULTS.MODEL,
      }),
    );
  }
  const socket = new FakeLiveSocket();
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
  eve.explores = options.explores ?? false;
  const reports: string[] = [];
  // The socket's own scope, as the attachment opens one: the exchange is built in it and the test's own stop closes it.
  const scope = await database.run(Scope.make());
  const standing = await database.run(
    Scope.provide(
      hostedLiveExchange({
        accountId: target.userId,
        liveSessionId,
        conversation: { userId: target.userId, conversationId: target.conversationId },
        taskId: target.taskId,
        writer,
        eve,
        createId: () => randomUUID(),
        report: (message) => reports.push(message),
      }).pipe(Effect.provide(tickingLiveWake(FOLLOW_TICK))),
      scope,
    ),
  );
  const exchange = { ...standing, stop: () => database.run(Scope.close(scope, Exit.void)) };
  const adopted = await database.run(
    exchange.adopt({
      sessionId: liveSessionId,
      attach: () => Effect.succeed(sidebandOverSocket(socket)),
      started: options.reattach !== undefined,
    }),
  );
  assert.ok(adopted);
  if (options.reattach === undefined) socket.receive(sessionStarted(liveSessionId));
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

it.live(
  "a spoken ask runs a turn through the ask door and is spoken from the service's own appends, its words one user message and both speakers' words segments",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      f.socket.receive(heard("What needs me?", 1000, 2400));
      f.socket.receive(delegated("dl_1", 2500));
      yield* settled(
        () => f.eve.opened.length === 1,
        "the ask to reach eve",
        async () => `reports ${JSON.stringify(f.reports)}`,
      );
      assert.deepEqual(
        f.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      const recorded = yield* Effect.promise(() =>
        asks.latestSession(target.userId, target.conversationId),
      );
      assert.ok(recorded);
      yield* Effect.promise(() =>
        play(spokenTurn(FIRST_EVE_TURN, NOW), {
          sessionId: recorded,
          target,
          turn: BRAIN_HOST_TURN.SPOKEN,
          model: "scripted-model",
          state: memoryRelayState(),
        }),
      );
      const diagnosis = async () => {
        const ask = (await asks.latestSession(target.userId, target.conversationId)) ?? "none";
        const turn = await database.run(
          database.store.turns.named(target.userId, [hostTurnId(recorded, FIRST_EVE_TURN)]),
        );
        const rows = (
          await readMessagesByConversationTyped(database.run, target.conversationId)
        ).map((row) => ({ clientId: row.clientId, role: row.role }));
        return `ask session ${ask}; turn rows ${turn.length} (${turn[0]?.status}); messages ${JSON.stringify(rows)}; commentary ${JSON.stringify(f.commentary().map((e) => e.content))}; reports ${JSON.stringify(f.reports)}; sent ${socketSent(f)}`;
      };
      yield* settled(() => f.commentary().length >= 2, "the reply to be spoken", diagnosis);
      assert.deepEqual(
        f.commentary().map((event) => [event.delegation_id, event.content]),
        [
          ["dl_1", "One agent finished."],
          ["dl_1", "Another is waiting on you."],
        ],
      );
      const rows = yield* Effect.promise(() =>
        readMessagesByConversationTyped(database.run, target.conversationId),
      );
      // One user row stands for one spoken ask: the developer's words as the session transcribed
      // them, under the id the service's ledger minted, naming the delegation that is the ask's
      // id, and tied to the turn the ask ran. The question as eve received it is on the ask's
      // record, never a second line.
      const userRows = rows
        .filter((row) => row.role === MESSAGE_ROLE.USER)
        .map((row) => [delegationOf(row), row.turnId]);
      assert.deepEqual(userRows, [["dl_1", hostTurnId(recorded, FIRST_EVE_TURN)]]);
      const [session] = yield* Effect.promise(() =>
        readVoiceSessionByLiveSessionId(database.run, f.liveSessionId),
      );
      assert.ok(session);
      const segments = yield* Effect.promise(() =>
        readVoiceTranscriptSegmentsBySession(
          database.run,
          Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(session).id,
        ),
      );
      assert.deepEqual(
        segments.map((segment) => segment.text),
        ["What needs me?"],
      );
      yield* Effect.promise(() => f.exchange.stop());
    }),
);

it.live(
  "the developer's words no ask carried reach Luke as the call's exchange closes, so a correction said before hanging up still reaches the plan",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      f.socket.receive(heard("Make the invites expire after three days.", 1000, 2400));
      // The session ends ahead of the exchange, as the relay's own close of a hung-up device has it.
      f.socket.receive({
        type: LIVE_SERVER_EVENT.SESSION_CLOSED,
        event_id: "closed",
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
        usage: { seconds: 3 },
      });
      yield* settled(
        () => !f.exchange.service.sessionStands(),
        "the session to end of its own",
        async () => `reports ${JSON.stringify(f.reports)}`,
      );
      yield* Effect.promise(() => f.exchange.stop());
      assert.deepEqual(
        f.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      assert.ok(
        JSON.stringify(f.eve.opened[0]?.message).includes(
          "Make the invites expire after three days.",
        ),
        `opened ${JSON.stringify(f.eve.opened.map((message) => message.message))}; reports ${JSON.stringify(f.reports)}`,
      );
    }),
);
