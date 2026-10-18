import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { it } from "@effect/vitest";
import { askRecord } from "@luke/database/models/asks";
import { openTaskConversation, readTask } from "@luke/database/models/task-store";
import { voiceSessionRecord } from "@luke/database/models/voice-session-record";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  joinWorkspace,
  openHostedStoreTestDatabase,
  readMessagesByConversationTyped,
  readVoiceSessionsByUserTyped,
  startTask,
} from "@luke/database/testing";
import { VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@luke/features";
import {
  callOpeningHistory,
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  LIVE_VOICE,
  type LiveClientEvent,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  sessionInstructions,
} from "@luke/live";
import { isRecord, unparsedWire, type WireRecord } from "@luke/wire";
import { Effect, Exit, Option, Redacted, Schema, Scope, Stream } from "effect";
import { afterAll } from "vitest";
import { BRAIN_HOST_TURN } from "../agents/brain-host/bounds.js";
import { BRAIN_EXPLORE_ASK } from "../agents/brain-host/brain.js";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../agents/brain-host/eve-sessions.js";
import { memoryRelayState, StreamRelay } from "../agents/brain-host/relay.js";
import { HOSTED_API_ERROR, MESSAGE_ROLE } from "../core.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import { FIRST_EVE_TURN, spokenTurn } from "../testing/eve-turns.js";
import {
  appended,
  delegated,
  heard,
  sessionStarted,
  thinkingAppended,
} from "../testing/live-events.js";
import {
  connect,
  fakeAccounts,
  hangUpDevice,
  readSocket,
  type SocketReader,
  send,
  sendText,
  startFakeOpenAi,
} from "../testing/voice-fakes.js";
import { deploymentExchange } from "./deployment-exchange.js";
import type { AttachedSession } from "./live-exchange.js";
import { LOG_EVENT, type LogEntry } from "./log.js";
import { listening, VoiceService, type VoiceServiceOptions, voiceServer } from "./service.js";
import { SOCKET_CLOSE_CODE } from "./socket.js";

/**
 * The hosted exchange attached to the sessions route, over the real store on
 * PGlite, a fake OpenAI at the far end of the sideband, and a fake eve behind
 * the ask door. The exchange is offered as the route itself offers it: through
 * `deploymentExchange`, the composition `voice/function.ts` passes, over this
 * suite's database rather than the deployment's, with eve alone
 * handed in as a fake. What these tests hold to is the production case: the
 * exchange stands before the desktop is answered, seeds nothing a second
 * time, reads the developer's words off the same sideband the relay pipes,
 * answers through eve and appends the reply upstream while the desktop still
 * receives every server frame; the desktop's stop passes and its idle report
 * reaches the exchange, which closes the session on it; an older desktop's
 * own append is refused with the close; a deployment missing a secret, or an
 * exchange that cannot stand, refuses the session; and when the relay settles
 * the exchange's record writes are drained before the session is reported
 * ended; and every call lands in the conversation of the task it is about.
 * The inert case stays as the statement of what the service does without a
 * seam, a configuration nothing ships. Every row is an account's this test
 * created.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;

const DelegatedMetadataSchema = Schema.Struct({ delegation_id: Schema.String });

/** The delegation a row's metadata names, where it names one. */
function delegationOf(row: { readonly metadata: unknown }): string | undefined {
  return Schema.is(DelegatedMetadataSchema)(row.metadata) ? row.metadata.delegation_id : undefined;
}
const API_KEY = "sk-test-project-key";
const BEARER = "Bearer account-token-1";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const CLOSE_TIMEOUT_MS = 300;
/** How long a frame is waited on where none is expected, before its absence counts. */
const QUIET_MS = 150;

const SEED = [
  {
    type: SEED_ITEM_TYPE,
    role: SEED_ROLE.USER,
    content: [{ type: SEED_CONTENT_TYPE.INPUT_TEXT, text: "What needs me?" }],
  },
  {
    type: SEED_ITEM_TYPE,
    role: SEED_ROLE.ASSISTANT,
    content: [{ type: SEED_CONTENT_TYPE.OUTPUT_TEXT, text: "Nothing yet." }],
  },
];

const writer = await database.run(
  storeWriter({
    tools: HOSTED_TOOL_SET,
  }),
);
const askEffects = askRecord();
const asks = {
  latestSession: (userId: string, conversationId: string) =>
    database.run(askEffects.latestSession(userId, conversationId)),
};
const relay = new StreamRelay({
  writer,
  asks: { binding: askEffects, stopTurn: () => Effect.void },
  now: () => NOW,
  report: () => undefined,
});
const sessionRecord = voiceSessionRecord(() => NOW);

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
  /** Every exploring a fresh session asked for, which eve declines, so a test of the developer's asks finds their first ask opens the session. */
  readonly explored: EveMessage[];
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    explored: [],
    open(message) {
      if (message.message === BRAIN_EXPLORE_ASK) {
        eve.explored.push(message);
        return Effect.succeed({
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: HOSTED_HTTP_STATUS.BAD_GATEWAY,
        });
      }
      eve.opened.push(message);
      return Effect.succeed({
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId: `wrun_${randomUUID()}`,
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

/** A task the account starts, as the Tasks tab's new-task form saves one. */
const TASK = {
  name: "Teammate invitations",
} as const;

/** An account holding one task, and the task's conversation every call about it lands in. */
async function account(): Promise<{ target: ConversationTarget; taskId: string }> {
  const userId = await database.createUser();
  const task = await database.run(startTask(userId, TASK));
  const conversationId = Option.getOrThrow(
    await database.run(openTaskConversation(userId, task.id)),
  ).conversationId;
  return { target: { userId, conversationId }, taskId: task.id };
}

function record(text: string): WireRecord {
  const value = unparsedWire(JSON.parse(text));
  assert.ok(isRecord(value));
  return value;
}

function clientEvent(text: string): LiveClientEvent {
  // SAFETY: the fake upstream is handed only what the service and the desktop send, which is Live client events.
  return JSON.parse(text) as LiveClientEvent;
}

/** Every frame the upstream reader has within the quiet window; none is a claim, not a timeout. */
async function framesWithin(reader: SocketReader, ms: number): Promise<LiveClientEvent[]> {
  const frames: LiveClientEvent[] = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      frames.push(clientEvent(await reader.next(Math.max(1, deadline - Date.now()))));
    } catch {
      break;
    }
  }
  return frames;
}

/** The service's own word about the task, sent beside the relayed frames as the call goes. */
const TASK_FRAMES: readonly unknown[] = [
  VOICE_SERVICE_FRAME.TASK_ACTIVITY,
  VOICE_SERVICE_FRAME.PLAN_DRAFT,
  VOICE_SERVICE_FRAME.TASK_WORK,
];

/** The next frame relayed to the desktop, past the service's own word about the task. */
async function relayedFrame(reader: SocketReader, timeoutMs?: number): Promise<WireRecord> {
  for (;;) {
    const frame = record(await reader.next(timeoutMs));
    if (!TASK_FRAMES.includes(frame.type)) return frame;
  }
}

async function until(predicate: () => boolean, what: () => string): Promise<void> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`timed out waiting for ${what()}`);
}

interface Stand {
  /** The account and the conversation of the task its calls are about by default. */
  readonly target: ConversationTarget;
  readonly taskId: string;
  readonly eve: FakeEve;
  /** Every account eve was reached as the deployment for, in order. */
  readonly eveAccounts: string[];
  readonly log: LogEntry[];
  readonly reports: string[];
  readonly openAi: Awaited<ReturnType<typeof startFakeOpenAi>>;
  /** Every session the attachment was offered, in order, as the route described it. */
  readonly offered: AttachedSession[];
  /** Lets a gated attachment proceed; a no-op for every other offer. */
  release(): void;
  url(path: string): string;
  stop(): Promise<void>;
}

/** How the exchange is offered: as the route does, not at all, one that cannot stand, one on a deployment missing its secret, or one held until the test releases it. */
const OFFER = {
  NONE: "none",
  EXCHANGE: "exchange",
  FAILING: "failing",
  UNCONFIGURED: "unconfigured",
  GATED: "gated",
} as const;

type Offer = (typeof OFFER)[keyof typeof OFFER];

/** The service for one account, with the exchange offered as the route would offer it, or nothing, or one that cannot stand. */
async function stand(offer: Offer): Promise<Stand> {
  const { target, taskId } = await account();
  const openAi = await startFakeOpenAi();
  const eve = fakeEve();
  const eveAccounts: string[] = [];
  const log: LogEntry[] = [];
  const reports: string[] = [];
  const accounts = { ...fakeAccounts(), resolveUserId: () => Effect.succeedSome(target.userId) };
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const attachment: VoiceServiceOptions["exchange"] =
    offer === OFFER.NONE
      ? undefined
      : offer === OFFER.FAILING
        ? () => Effect.fail(new Error("the store is not reachable"))
        : deploymentExchange({
            deploymentSecret: () =>
              offer === OFFER.UNCONFIGURED ? undefined : Redacted.make("deployment-secret"),
            eveOrigin: () => "https://eve.test",
            eve: (accountId) => {
              eveAccounts.push(accountId);
              return eve;
            },
            report: (reported) => reports.push(reported),
          });
  const offered: AttachedSession[] = [];
  const exchange: VoiceServiceOptions["exchange"] =
    attachment === undefined
      ? undefined
      : (session) =>
          Effect.gen(function* () {
            offered.push(session);
            if (offer === OFFER.GATED) yield* Effect.promise(() => gate);
            return yield* attachment(session);
          });
  const voice = voiceServer();
  const scope = await database.run(Scope.make());
  const port = await database.run(
    Scope.provide(
      Effect.gen(function* () {
        const listener = yield* listening(voice, 0, "127.0.0.1");
        yield* VoiceService.make({
          server: voice,
          apiKey: API_KEY,
          accounts,
          record: sessionRecord,
          openAiBaseUrl: openAi.baseUrl,
          log: (entry) => {
            log.push(entry);
          },
          closeTimeoutMs: CLOSE_TIMEOUT_MS,
          firstFrameTimeoutMs: 1_000,
          attachTimeoutMs: 2_000,
          ...(exchange === undefined ? undefined : { exchange }),
        });
        return listener;
      }),
      scope,
    ),
  );
  return {
    target,
    taskId,
    eve,
    eveAccounts,
    log,
    reports,
    openAi,
    offered,
    release: () => release(),
    url: (path) => `ws://127.0.0.1:${port}${path}`,
    stop: async () => {
      await database.run(Scope.close(scope, Exit.void));
      await openAi.close();
    },
  };
}

/** The desktop's opening frame for a call about the task named. */
function createFrame(taskId: string, input: readonly WireRecord[] = []): WireRecord {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input: [...input],
    planId: taskId,
  };
}

/** A signed-in desktop through to a standing session: the created frame read, and OpenAI's end of the sideband. */
async function openSession(
  context: Stand,
  taskId: string = context.taskId,
  input: readonly WireRecord[] = [],
) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame(taskId, input));
  const attach = await context.openAi.nextAttach();
  // The upstream reader stands the instant the attach lands, ahead of the created frame, so a frame
  // the service sent between its attach and its answer is seen rather than lost before any listener.
  const upstream = readSocket(attach.socket);
  const created = record(await desktop.next());
  return { desktop, upstream, attach, created };
}

/** The session speaks: started, the developer's words, and the delegation that cuts them. */
async function speak(attachSocket: Parameters<typeof sendText>[0], sessionId: string) {
  await sendText(attachSocket, JSON.stringify(sessionStarted(sessionId)));
  await sendText(attachSocket, JSON.stringify(heard("What needs me?", 1000, 2400)));
  await sendText(attachSocket, JSON.stringify(delegated("dl_1", 2500)));
}

/** The desktop hangs up; the session answers the relay's close; the service reports the session ended. */
async function hangUp(context: Stand, session: Awaited<ReturnType<typeof openSession>>) {
  await hangUpDevice(session.desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  const closing = clientEvent(await session.upstream.next());
  assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    session.attach.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason: "close_requested",
      usage: { seconds: 4 },
    }),
  );
  await until(
    () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
    () => `the session to be reported ended; log ${JSON.stringify(context.log)}`,
  );
}

it.effect(
  "with the exchange offered it stands before the desktop is answered, seeds nothing a second time, reads the developer's words off the piped sideband, answers through eve, and appends the reply upstream while the desktop still receives every server frame",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const session = await openSession(context, context.taskId, SEED);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      assert.deepEqual(
        context.log.map((entry) => entry.event),
        [LOG_EVENT.EXCHANGE_ATTACHED, LOG_EVENT.SESSION_CREATED],
      );
      // One creation, seeded by the plan and the desktop's frame alone: the exchange adopted the session and seeded nothing.
      assert.equal(context.openAi.creates.length, 1);
      const create = context.openAi.creates[0];
      assert.ok(create && isRecord(create.body.session));
      assert.ok(Array.isArray(create.body.session.input));
      // The call's opening is the history's last message, so nothing is appended once it starts.
      assert.deepEqual(create.body.session.input.slice(1, -1), SEED);
      assert.deepEqual(create.body.session.input.at(-1), callOpeningHistory());
      assert.deepEqual(await framesWithin(session.upstream, QUIET_MS), []);

      const upstreamSessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, upstreamSessionId);
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[context.target.conversationId, BRAIN_HOST_TURN.SPOKEN]],
      );
      // The desktop was handed every server frame the session spoke, raw, as the relay always did.
      const relayed = [await relayedFrame(session.desktop), await relayedFrame(session.desktop)];
      assert.deepEqual(
        relayed.map((frame) => frame.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA],
      );

      const eveSession = await asks.latestSession(
        context.target.userId,
        context.target.conversationId,
      );
      assert.ok(eveSession);
      const standing = {
        sessionId: eveSession,
        target: context.target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      for (const event of spokenTurn(FIRST_EVE_TURN, NOW))
        await database.run(relay.handle(event, standing));
      // The reply reaches the session as the service's own appends, each acknowledged here as OpenAI
      // would: the thinking note the reply streams under, then the sentences, which alone are spoken.
      const spoken: string[] = [];
      const kinds: string[] = [];
      const diagnosis = async () => {
        const rows = await readMessagesByConversationTyped(
          database.run,
          context.target.conversationId,
        );
        return `kinds ${JSON.stringify(kinds)}; reports ${JSON.stringify(context.reports)}; rows ${JSON.stringify(rows.map((row) => [row.role, row.clientId, row.finishedAt !== null]))}; log ${JSON.stringify(context.log.map((entry) => entry.event))}`;
      };
      while (spoken.length < 2) {
        const sent = clientEvent(
          await session.upstream.next(5_000).catch(async (error: Error) => {
            assert.fail(`${error.message}: ${await diagnosis()}`);
          }),
        );
        kinds.push(sent.type);
        if (sent.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
          await sendText(session.attach.socket, JSON.stringify(thinkingAppended(sent.event_id)));
          continue;
        }
        assert.equal(sent.type, LIVE_CLIENT_EVENT.COMMENTARY_APPEND);
        if (sent.type !== LIVE_CLIENT_EVENT.COMMENTARY_APPEND) break;
        assert.equal(sent.delegation_id, "dl_1");
        spoken.push(sent.content);
        await sendText(
          session.attach.socket,
          JSON.stringify(
            appended(sent.event_id, 3000 + spoken.length * 1000, 4000 + spoken.length * 1000),
          ),
        );
      }
      assert.deepEqual(spoken, ["One agent finished.", "Another is waiting on you."]);
      assert.equal(kinds.includes(LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND), false);

      await hangUp(context, session);
      // The record was drained before the session was reported ended: the developer's line stands attached to the delegation.
      const rows = await readMessagesByConversationTyped(
        database.run,
        context.target.conversationId,
      );
      assert.deepEqual(
        rows.filter((row) => row.role === MESSAGE_ROLE.USER).map((row) => delegationOf(row)),
        ["dl_1"],
      );
      await context.stop();
    }),
);

/** The conversation the task resumes in, as the task's row names it now. */
async function taskConversationOf(userId: string, taskId: string): Promise<string | undefined> {
  const stored = await database.run(readTask(userId, taskId));
  return Option.getOrUndefined(stored)?.conversationId;
}

/** The delegations the conversation's developer lines were written under, in order. */
async function sessionRowOf(userId: string, sessionId: string) {
  const rows = await readVoiceSessionsByUserTyped(database.run, userId);
  return rows.find((row) => row.liveSessionId === sessionId);
}

async function spokenDelegations(conversationId: string): Promise<(string | undefined)[]> {
  const rows = await readMessagesByConversationTyped(database.run, conversationId);
  return rows.filter((row) => row.role === MESSAGE_ROLE.USER).map((row) => delegationOf(row));
}

/** The session hangs up from the desktop's side and answers the relay's close, as `hangUp` does for any connection. */
async function hangUpConnection(
  desktop: SocketReader,
  attach: { readonly socket: Parameters<typeof sendText>[0] },
  upstream: SocketReader,
): Promise<void> {
  await hangUpDevice(desktop.socket, SOCKET_CLOSE_CODE.NORMAL);
  const closing = clientEvent(await upstream.next(5_000));
  assert.equal(closing.type, LIVE_CLIENT_EVENT.CLOSE);
  await sendText(
    attach.socket,
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: `closed-${randomUUID()}`,
      reason: "close_requested",
      usage: { seconds: 1 },
    }),
  );
}

it.effect(
  "a call is created under the planning instructions, its spoken ask reaches eve in its plan's conversation and never another plan's, and a re-attach is bound to the same plan by the session's row",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const task = await database.run(startTask(context.target.userId, TASK));
      const session = await openSession(context, task.id);
      assert.equal(session.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      const create = context.openAi.creates[0];
      assert.ok(create && isRecord(create.body.session));
      assert.equal(create.body.session.instructions, sessionInstructions());

      const sessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(session.attach.socket, sessionId);
      await until(
        () => context.eve.opened.length === 1,
        () => `the ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      const planned = await taskConversationOf(context.target.userId, task.id);
      assert.ok(planned);
      assert.notEqual(planned, context.target.conversationId);
      assert.deepEqual(
        context.eve.opened.map((message) => [message.conversationId, message.turn]),
        [[planned, BRAIN_HOST_TURN.SPOKEN]],
      );

      // A fresh connection names no task; the session's row binds it, and its words land in the same task.
      const again = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in again);
      await send(again.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
      const reattach = await context.openAi.nextAttach();
      const reattachUpstream = readSocket(reattach.socket);
      assert.equal(record(await again.reader.next()).type, VOICE_SERVICE_FRAME.SESSION_ATTACHED);
      assert.deepEqual(
        context.offered.map((offered) => offered.taskId),
        [task.id, task.id],
      );
      // A re-attach creates nothing, so no opening is added and none is appended.
      assert.equal(context.openAi.creates.length, 1);
      await sendText(reattach.socket, JSON.stringify(heard("Any member can invite.", 5000, 6400)));
      await sendText(reattach.socket, JSON.stringify(delegated("dl_2", 6500)));
      // The line is attached to its ask once the brain took it, so the hang-up waits for the record.
      const taskConversation = await taskConversationOf(context.target.userId, task.id);
      assert.ok(taskConversation);
      for (let attempt = 0; attempt < 600; attempt += 1) {
        if ((await spokenDelegations(taskConversation)).includes("dl_2")) break;
        await sleep(5);
      }

      await hangUpConnection(again.reader, reattach, reattachUpstream);
      await hangUpConnection(session.desktop, session.attach, session.upstream);
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () => `both connections to be reported ended; log ${JSON.stringify(context.log)}`,
      );
      assert.deepEqual(await spokenDelegations(taskConversation), ["dl_1", "dl_2"]);
      assert.deepEqual(await spokenDelegations(context.target.conversationId), []);
      await context.stop();
    }),
);

it.effect(
  "a call about another plan lands in that plan's conversation alone, and a plan the account does not hold is refused as not found before any session is created",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const first = await database.run(startTask(context.target.userId, TASK));
      const second = await database.run(
        startTask(context.target.userId, { ...TASK, name: "Billing export" }),
      );
      const stranger = await database.createUser();
      const foreign = await database.run(startTask(stranger, TASK));

      const firstCall = await openSession(context, first.id);
      await speak(firstCall.attach.socket, context.openAi.attaches[0]?.sessionId ?? "");
      await until(
        () => context.eve.opened.length === 1,
        () => "the first plan's ask to reach eve",
      );
      await hangUpConnection(firstCall.desktop, firstCall.attach, firstCall.upstream);

      const secondCall = await openSession(context, second.id);
      await speak(secondCall.attach.socket, context.openAi.attaches[1]?.sessionId ?? "");
      await until(
        () => context.eve.opened.length === 2,
        () => "the second plan's ask to reach eve",
      );
      await hangUpConnection(secondCall.desktop, secondCall.attach, secondCall.upstream);
      await until(
        () => context.log.filter((entry) => entry.event === LOG_EVENT.SESSION_ENDED).length === 2,
        () => `both calls to be reported ended; log ${JSON.stringify(context.log)}`,
      );

      const firstConversation = await taskConversationOf(context.target.userId, first.id);
      const secondConversation = await taskConversationOf(context.target.userId, second.id);
      assert.ok(firstConversation && secondConversation);
      assert.notEqual(firstConversation, secondConversation);
      assert.deepEqual(
        context.eve.opened.map((message) => message.conversationId),
        [firstConversation, secondConversation],
      );
      assert.deepEqual(await spokenDelegations(firstConversation), ["dl_1"]);
      assert.deepEqual(await spokenDelegations(secondConversation), ["dl_1"]);

      const refused = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
        authorization: BEARER,
      });
      assert.ok("reader" in refused);
      await send(refused.reader.socket, {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: [],
        planId: foreign.id,
      });
      assert.equal(record(await refused.reader.next()).error, HOSTED_API_ERROR.NOT_FOUND);
      assert.equal(context.openAi.creates.length, 2);
      await context.stop();
    }),
);
it.effect(
  "a member's call about a plan a teammate opened lands in the plan's one conversation, recorded under the teammate who opened it, and its ask reaches eve as the member",
  () =>
    Effect.promise(async () => {
      const context = await stand(OFFER.EXCHANGE);
      const member = context.target.userId;
      const teammate = await database.createUser();
      const task = await database.run(startTask(teammate, TASK));
      await database.run(joinWorkspace(task.workspaceId, member));
      const opened = Option.getOrThrow(await database.run(openTaskConversation(teammate, task.id)));

      const call = await openSession(context, task.id);
      assert.equal(call.created.type, VOICE_SERVICE_FRAME.SESSION_CREATED);
      const sessionId = context.openAi.attaches[0]?.sessionId ?? "";
      await speak(call.attach.socket, sessionId);
      await until(
        () => context.eve.opened.length === 1,
        () => `the member's ask to reach eve; reports ${JSON.stringify(context.reports)}`,
      );
      await hangUpConnection(call.desktop, call.attach, call.upstream);
      await until(
        () => context.log.some((entry) => entry.event === LOG_EVENT.SESSION_ENDED),
        () => `the call to be reported ended; log ${JSON.stringify(context.log)}`,
      );

      assert.deepEqual(
        context.eve.opened.map((message) => message.conversationId),
        [opened.conversationId],
      );
      assert.deepEqual(context.eveAccounts, [member]);
      assert.deepEqual(await spokenDelegations(opened.conversationId), ["dl_1"]);
      assert.deepEqual(await spokenDelegations(context.target.conversationId), []);
      assert.ok(await sessionRowOf(member, sessionId));
      assert.equal(await sessionRowOf(teammate, sessionId), undefined);
      await context.stop();
    }),
);
