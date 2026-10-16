import assert from "node:assert/strict";
import { runWithoutDatabase } from "@luke/database/testing/no-database";
import { VOICE_SEGMENT_ROLE } from "@luke/database/voice-vocabulary";
import {
  HOSTED_API_ERROR,
  hostedErrorSchema,
  sessionCreatedFrameFromWire,
  VOICE_SERVICE_FRAME,
  VOICE_SERVICE_PATH,
} from "@luke/features";
import type { Task } from "@luke/features/task-wire";
import {
  callOpeningHistory,
  type InitialItem,
  LIVE_DEFAULTS,
  LIVE_DELEGATION_TARGET,
  LIVE_INPUT_BOUNDS,
  LIVE_TRANSPORT_TYPE,
  LIVE_VOICE,
  RENDERER_CLIENT_EVENTS,
  RENDERER_SERVER_EVENTS,
  SEED_CONTENT_TYPE,
  SEED_ITEM_TYPE,
  SEED_ROLE,
  seedItemTokens,
  sessionInstructions,
} from "@luke/live";
import { EXCESS_KEYS, isRecord, unparsedWire, type WireRecord } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Exit, Result, Scope } from "effect";
import { onTestFinished, test } from "vitest";
import {
  connect,
  FAKE_BEARER,
  FAKE_SDP_ANSWER,
  FAKE_USER_ID,
  type FakeAccounts,
  type FakeOpenAi,
  type FakeSessionRecord,
  fakeAccounts,
  fakeSessionRecord,
  readSocket,
  send,
  startFakeOpenAi,
} from "../testing/voice-fakes.js";
import type { LogEntry } from "./log.js";
import {
  listening,
  UPGRADE_STATUS,
  VoiceService,
  type VoiceServiceOptions,
  voiceServer,
} from "./service.js";
import { SOCKET_CLOSE_CODE } from "./socket.js";

const API_KEY = "sk-test-project-key";
const BEARER = FAKE_BEARER;
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const CLOSE_TIMEOUT_MS = 300;

const developerMessage = (text: string) => ({
  type: SEED_ITEM_TYPE,
  role: SEED_ROLE.DEVELOPER,
  content: [{ type: SEED_CONTENT_TYPE.INPUT_TEXT, text }],
});

const SEED = [
  developerMessage("Roster: one session working."),
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

/** A plan the account holds, untouched since it was started. */
const TASK: Task = {
  id: "7d4f3c2a-1b0e-4f6a-9c8d-2e1f0a9b8c7d",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1_000,
  updatedAt: 1_000,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

/** The desktop's opening frame for a call about the plan the account holds. */
function createFrame(input: WireRecord[] = SEED): WireRecord {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATE,
    sdp: SDP_OFFER,
    voice: LIVE_VOICE.MARIN,
    input,
    planId: TASK.id,
  };
}

function record(text: string): WireRecord {
  const value = unparsedWire(JSON.parse(text));
  assert.ok(isRecord(value));
  return value;
}

function hostedError(text: WireRecord): string | undefined {
  // The hosted error record was declared tolerant, so the read drops a key a
  // newer service may have added.
  return Result.getOrUndefined(readEither(hostedErrorSchema, { excess: EXCESS_KEYS.DROP })(text));
}

interface Stand {
  openAi: FakeOpenAi;
  accounts: FakeAccounts;
  record: FakeSessionRecord;
  service: VoiceService;
  log: LogEntry[];
  url(path: string): string;
  /** How many sessions the service holds, read where the test is not inside a fiber. */
  sessions(): Promise<number>;
  /** Closes the scope the service stands in, which is its whole close. */
  close(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * One service in a scope of the test's own, standing on a server built as a
 * function module builds one. The listener is acquired ahead of the service,
 * so closing the scope drains the sessions before it stops listening.
 */
async function stand(overrides: Partial<VoiceServiceOptions> = {}): Promise<Stand> {
  const openAi = await startFakeOpenAi();
  const accounts = fakeAccounts();
  const record = fakeSessionRecord();
  record.tasks.push({ userId: FAKE_USER_ID, task: TASK });
  const log: LogEntry[] = [];
  const voice = voiceServer();
  const scope = await runWithoutDatabase(Scope.make());
  const standing = await runWithoutDatabase(
    Scope.provide(
      Effect.gen(function* () {
        const port = yield* listening(voice, 0, "127.0.0.1");
        const service = yield* VoiceService.make({
          server: voice,
          apiKey: API_KEY,
          accounts,
          record,
          openAiBaseUrl: openAi.baseUrl,
          log: (entry) => {
            log.push(entry);
          },
          closeTimeoutMs: CLOSE_TIMEOUT_MS,
          firstFrameTimeoutMs: 1_000,
          attachTimeoutMs: 2_000,
          ...overrides,
        });
        return { port, service };
      }),
      scope,
    ),
  );
  const close = () => runWithoutDatabase(Scope.close(scope, Exit.void));
  return {
    openAi,
    accounts,
    record,
    service: standing.service,
    log,
    url: (path) => `ws://127.0.0.1:${standing.port}${path}`,
    sessions: () => runWithoutDatabase(standing.service.sessions),
    close,
    stop: async () => {
      await close();
      await openAi.close();
    },
  };
}

/** A signed-in desktop through to a standing session: the created frame read, and OpenAI's end of the sideband. */
async function openSession(context: Stand) {
  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), { authorization: BEARER });
  assert.ok("reader" in opened);
  const desktop = opened.reader;
  await send(desktop.socket, createFrame());
  const attach = await context.openAi.nextAttach();
  const created = sessionCreatedFrameFromWire(record(await desktop.next()));
  assert.ok(created);
  return { desktop, upstream: readSocket(attach.socket), attach, created };
}

test("a long history of earlier calls is cut to leave room for the opening, which stays the startup history's last message", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const said = "We went over how invitations expire and who may send them. ".repeat(40);
  context.record.earlierCalls = () =>
    Effect.succeed(
      Array.from({ length: 60 }, (_, index) => ({
        voiceSessionId: "earlier-call",
        role: index % 2 === 0 ? VOICE_SEGMENT_ROLE.USER : VOICE_SEGMENT_ROLE.ASSISTANT,
        text: said,
      })),
    );

  await openSession(context);

  const session = context.openAi.creates[0]?.body.session;
  assert.ok(isRecord(session) && Array.isArray(session.input));
  // SAFETY: the service builds `input` from `InitialItem`s alone, which the request carries as sent.
  const input = session.input as InitialItem[];
  assert.deepEqual(input.at(-1), callOpeningHistory());
  assert.ok(seedItemTokens(input) <= LIVE_INPUT_BOUNDS.TOKENS);
  assert.ok(input.length <= LIVE_INPUT_BOUNDS.MESSAGES);
});

test("a /sessions upgrade without a bearer is refused with 401 before any socket stands", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const refused = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS));
  assert.deepEqual(refused, { status: UPGRADE_STATUS.UNAUTHORIZED });
  const blank = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer  ",
  });
  assert.deepEqual(blank, { status: UPGRADE_STATUS.UNAUTHORIZED });
  assert.equal(context.accounts.resolved.length, 0);
});

test("a bearer no account stands behind is refused as an invalid token and counts nothing", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer stale",
  });
  assert.ok("reader" in opened);
  await send(opened.reader.socket, createFrame());
  assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(context.openAi.creates.length, 0);
  assert.equal(context.accounts.spent.length, 0);
});

test("a session is authorized, counted, created, registered to its account, attached, and answered in that order", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  const { attach, created } = await openSession(context);

  assert.deepEqual(context.accounts.resolved, [BEARER]);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
  assert.deepEqual(context.record.registered, [
    {
      userId: FAKE_USER_ID,
      sessionId: created.sessionId,
      taskId: TASK.id,
      model: LIVE_DEFAULTS.MODEL,
    },
  ]);

  assert.equal(context.openAi.creates.length, 1);
  const create = context.openAi.creates[0];
  assert.ok(create);
  assert.equal(create.authorization, `Bearer ${API_KEY}`);
  const session = create.body.session;
  assert.ok(isRecord(session));
  assert.deepEqual(create.body.transport, { type: LIVE_TRANSPORT_TYPE, sdp: SDP_OFFER });
  assert.equal(session.instructions, sessionInstructions());
  assert.deepEqual(session.delegation, { type: LIVE_DELEGATION_TARGET.CLIENT });
  assert.equal(session.store, false);
  assert.equal(session.model, LIVE_DEFAULTS.MODEL);
  assert.deepEqual(session.audio, { output: { voice: LIVE_VOICE.MARIN } });
  // The plan's own seed goes ahead of the desktop's input, which follows it untouched, and the
  // call's opening comes last, so Luke speaks first with nothing appended once it starts.
  assert.ok(Array.isArray(session.input));
  assert.deepEqual(session.input.slice(1, -1), SEED);
  assert.deepEqual(session.input.at(-1), callOpeningHistory());
  assert.deepEqual(session.client, {
    data_channel: {
      allowed_client_events: RENDERER_CLIENT_EVENTS,
      allowed_server_events: RENDERER_SERVER_EVENTS,
    },
  });
  assert.deepEqual(Object.keys(session).sort(), [
    "audio",
    "client",
    "delegation",
    "input",
    "instructions",
    "model",
    "store",
  ]);

  assert.equal(attach.sessionId, created.sessionId);
  assert.equal(attach.authorization, `Bearer ${API_KEY}`);
  assert.equal(created.sdpAnswer, FAKE_SDP_ANSWER);
  // The answer names the store's own row for the session, as register answered it.
  assert.equal(created.voiceSessionId, context.record.voiceSessionIds.get(created.sessionId));
  assert.ok(created.voiceSessionId);
  assert.equal("quota" in created, false);
  assert.equal(await context.sessions(), 1);
});

test("an upgrade carrying a browser Origin is refused with 403", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());

  assert.deepEqual(
    await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
      origin: "https://evil.test",
    }),
    { status: UPGRADE_STATUS.FORBIDDEN },
  );
  assert.equal(context.accounts.resolved.length, 0);
});

test("an attach to a session another account created, or one never created, is refused as the bearer's own failure", async () => {
  const context = await stand();
  onTestFinished(() => context.stop());
  const { created } = await openSession(context);
  await runWithoutDatabase(
    context.record.register({
      userId: "user-2",
      sessionId: "live_theirs",
      taskId: TASK.id,
      attachId: "attach-theirs",
      model: LIVE_DEFAULTS.MODEL,
    }),
  );

  for (const sessionId of ["live_theirs", "live_never"]) {
    const opened = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
      authorization: BEARER,
    });
    assert.ok("reader" in opened);
    await send(opened.reader.socket, { type: VOICE_SERVICE_FRAME.SESSION_ATTACH, sessionId });
    assert.equal(hostedError(record(await opened.reader.next())), HOSTED_API_ERROR.INVALID_TOKEN);
    assert.equal((await opened.reader.closed).code, SOCKET_CLOSE_CODE.POLICY_VIOLATION);
  }
  const stale = await connect(context.url(VOICE_SERVICE_PATH.SESSIONS), {
    authorization: "Bearer stale",
  });
  assert.ok("reader" in stale);
  await send(stale.reader.socket, {
    type: VOICE_SERVICE_FRAME.SESSION_ATTACH,
    sessionId: created.sessionId,
  });
  assert.equal(hostedError(record(await stale.reader.next())), HOSTED_API_ERROR.INVALID_TOKEN);
  assert.equal(context.openAi.attaches.length, 1);
  assert.deepEqual(context.accounts.spent, [FAKE_USER_ID]);
});
