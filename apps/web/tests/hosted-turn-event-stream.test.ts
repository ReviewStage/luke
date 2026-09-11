import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  brainTurnEventsPath,
  decodeTurnEventFrame,
  HOSTED_API_ERROR,
  READ_QUERY,
  TURN_END,
  TURN_EVENT_KIND,
  TURN_EVENT_STREAM,
  TURN_SLOW_STEP,
  type TurnEvent,
} from "@sidecar/hosted";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import {
  ACTION_TOOL,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  SLOW_STEP_KIND,
  type StoredUIMessage,
  TURN_ORIGIN,
  TURN_STATUS,
  UI_PART_STATE,
  UI_PART_TYPE,
} from "../server/core";
import { DISPATCH_QUERY } from "../server/function-dispatch";
import {
  FUNCTION_GROUP,
  FUNCTION_MAX_DURATION_SECONDS,
  routeKeyOf,
} from "../server/function-durations";
import { functionPublicPath, webFunctions } from "../server/function-layout";
import { apiRewrites } from "../server/function-rewrites";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import {
  handleTurnEventStream,
  projectTurnEvents,
  TURN_EVENT_STREAM_BOUNDS,
  TURN_EVENT_STREAM_PATH,
  type TurnEventStreamOptions,
} from "../server/hosted/turn-event-stream";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * The turn event stream over the real migrations on PGlite, with the turn
 * written the way the hosted brain writes one: eve's events relayed through
 * the store writer. What these tests hold to is the acceptance: a client
 * attached mid-turn hears the remaining events and the end exactly once, and
 * one attached after the end hears the end and closes. Synthetic throughout —
 * no real title, branch, or spoken word.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});
const relay = new StreamRelay({
  writer,
  asks: askRecord(database.run),
  offer: (target, turnId) =>
    offerBriefing({ run: database.run, writer, now: () => NOW }, target, turnId),
  now: () => NOW,
  report: () => undefined,
});

/** The stream's bounds narrowed so a poll is milliseconds and an attachment lapses inside a test. */
const QUICK = { POLL_MS: 5, HEARTBEAT_MS: 20, ATTACHMENT_MS: 150 } as const;

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const EVE_TURN = "turn_0";

/** One spoken ask's turn as eve emits it: a transcript read, then a two-sentence answer. */
function spokenTurn(turnId: string): readonly MessageStreamEvent[] {
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "what changed?" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-1",
            toolName: BRAIN_TOOL.READ_TRANSCRIPT,
            input: { provider_id: "conductor", provider_session_id: "s-1" },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: BRAIN_TOOL.READ_TRANSCRIPT,
          output: { lines: ["a"] },
        },
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "One agent finished. Another is waiting on you.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

function standingFor(target: ConversationTarget): RelayStanding {
  return {
    sessionId: `wrun_${randomUUID()}`,
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await relay.handle(event, standing);
}

/** The eve events up to and including the transcript read's request: the turn is running with one slow call on its journal. */
function untilRequested(events: readonly MessageStreamEvent[]): number {
  return events.findIndex((event) => event.type === "actions.requested") + 1;
}

function request(turnId: string, after?: number, method = "GET"): Request {
  const url = new URL(`https://luke.test${TURN_EVENT_STREAM_PATH}`);
  url.searchParams.set("id", turnId);
  if (after !== undefined) url.searchParams.set(READ_QUERY.AFTER, String(after));
  return new Request(url, { method, headers: { authorization: "Bearer token-1" } });
}

function options(
  userId: string | undefined,
  req: Request,
  bounds: TurnEventStreamOptions["bounds"] = QUICK,
): TurnEventStreamOptions {
  return { request: req, resolveUserId: async () => userId, store: database.store, bounds };
}

interface StreamReading {
  readonly events: readonly TurnEvent[];
  /** How many frames carried no event: the heartbeats. */
  readonly heartbeats: number;
}

/** Reads the stream to its close, decoding every frame as the wire's client would. */
async function readStream(response: Response): Promise<StreamReading> {
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    `${TURN_EVENT_STREAM.MEDIA_TYPE}; charset=utf-8`,
  );
  const text = await response.text();
  const frames = text.split(TURN_EVENT_STREAM.FRAME_END).filter((frame) => frame.length > 0);
  const events: TurnEvent[] = [];
  let heartbeats = 0;
  for (const frame of frames) {
    const event = decodeTurnEventFrame(`${frame}${TURN_EVENT_STREAM.FRAME_END}`);
    if (event === undefined) heartbeats += 1;
    else events.push(event);
  }
  return { events, heartbeats };
}

function kinds(events: readonly TurnEvent[]): readonly string[] {
  return events.map((event) => event.kind);
}

test("a client attached mid-turn hears the slow step at once, then the settled mark, the sentences, and the end exactly once, numbered in order", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilRequested(events)), standing);

  const response = await handleTurnEventStream(
    options(target.userId, request(turnId), { POLL_MS: QUICK.POLL_MS, HEARTBEAT_MS: 60_000 }),
  );
  const reading = readStream(response);
  await play(events.slice(untilRequested(events)), standing);
  const heard = await reading;

  assert.deepEqual(kinds(heard.events), [
    TURN_EVENT_KIND.SLOW_STEP,
    TURN_EVENT_KIND.ACTIONS_SETTLED,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.ENDED,
  ]);
  assert.deepEqual(
    heard.events.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(new Set(heard.events.map((event) => event.turnId)), new Set([turnId]));
  const [slow, , first, second, end] = heard.events;
  assert.deepEqual(slow, {
    turnId,
    seq: 1,
    kind: TURN_EVENT_KIND.SLOW_STEP,
    step: TURN_SLOW_STEP.TRANSCRIPT_READ,
  });
  assert.equal(
    first?.kind === TURN_EVENT_KIND.REPLY_SENTENCE && first.sentence,
    "One agent finished.",
  );
  assert.equal(
    second?.kind === TURN_EVENT_KIND.REPLY_SENTENCE && second.sentence,
    "Another is waiting on you.",
  );
  assert.deepEqual(end, { turnId, seq: 5, kind: TURN_EVENT_KIND.ENDED, end: TURN_END.COMPLETED });

  // A fresh client attached after the end hears the same numbered events and closes.
  const afterwards = await readStream(
    await handleTurnEventStream(options(target.userId, request(turnId))),
  );
  assert.deepEqual(afterwards.events, heard.events);
  assert.equal(afterwards.heartbeats, 0);
});

test("a client that attaches again with its cursor hears only what it had not, and one that took the end hears nothing and closes", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events, standing);

  const whole = await readStream(
    await handleTurnEventStream(options(target.userId, request(turnId))),
  );
  assert.equal(whole.events.length, 5);

  const rest = await readStream(
    await handleTurnEventStream(options(target.userId, request(turnId, 2))),
  );
  assert.deepEqual(rest.events, whole.events.slice(2));

  const done = await readStream(
    await handleTurnEventStream(options(target.userId, request(turnId, 5))),
  );
  assert.deepEqual(done.events, []);
});

test("an attachment lapses without an end while the turn runs, heartbeats meanwhile, and the next attachment from the cursor hears the rest", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilRequested(events)), standing);

  const lapsed = await readStream(
    await handleTurnEventStream(options(target.userId, request(turnId))),
  );
  assert.deepEqual(kinds(lapsed.events), [TURN_EVENT_KIND.SLOW_STEP]);
  assert.ok(lapsed.heartbeats >= 1);

  await play(events.slice(untilRequested(events)), standing);
  const resumed = await readStream(
    await handleTurnEventStream(options(target.userId, request(turnId, 1))),
  );
  assert.deepEqual(kinds(resumed.events), [
    TURN_EVENT_KIND.ACTIONS_SETTLED,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.ENDED,
  ]);
  assert.deepEqual(
    resumed.events.map((event) => event.seq),
    [2, 3, 4, 5],
  );
});

test("a client that disconnects stops the polling", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilRequested(events)), standing);

  let polls = 0;
  const response = await handleTurnEventStream({
    ...options(target.userId, request(turnId), {
      POLL_MS: 5,
      HEARTBEAT_MS: 60_000,
      ATTACHMENT_MS: 60_000,
    }),
    sleep: async (ms) => {
      polls += 1;
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
  });
  assert.ok(response.body);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  const seen = polls;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(polls <= seen + 1);
});

test("a cancelled turn and a failed one end without a settled mark or a sentence", async () => {
  for (const [end, ending] of [
    [TURN_END.CANCELLED, { type: "turn.cancelled", data: { turnId: EVE_TURN, sequence: 0 } }],
    [
      TURN_END.FAILED,
      {
        type: "turn.failed",
        data: { turnId: EVE_TURN, sequence: 0, code: "model_error", message: "upstream failed" },
      },
    ],
  ] as const) {
    const target = await conversation();
    const standing = standingFor(target);
    const events = spokenTurn(EVE_TURN);
    const turnId = hostTurnId(standing.sessionId, EVE_TURN);
    await play(events.slice(0, untilRequested(events)), standing);
    await relay.handle(stamped(ending), standing);

    const heard = await readStream(
      await handleTurnEventStream(options(target.userId, request(turnId))),
    );
    assert.deepEqual(heard.events, [
      { turnId, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.TRANSCRIPT_READ },
      { turnId, seq: 2, kind: TURN_EVENT_KIND.ENDED, end },
    ]);
  }
});

test("the door: the method, the id, the bearer, and ownership are refused before anything streams", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events, standing);
  const other = await database.createUser();

  const refused = async (opts: TurnEventStreamOptions, status: number, error: string) => {
    const response = await handleTurnEventStream(opts);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  };

  await refused(
    options(target.userId, request(turnId, undefined, "POST")),
    405,
    HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
  );
  await refused(options(undefined, request(turnId)), 401, HOSTED_API_ERROR.INVALID_TOKEN);
  await refused(options(other, request(turnId)), 404, HOSTED_API_ERROR.NOT_FOUND);
  await refused(options(target.userId, request(randomUUID())), 404, HOSTED_API_ERROR.NOT_FOUND);
  await refused(options(target.userId, request("turn-1")), 404, HOSTED_API_ERROR.NOT_FOUND);

  const noId = new Request(`https://luke.test${TURN_EVENT_STREAM_PATH}`, {
    headers: { authorization: "Bearer token-1" },
  });
  await refused(options(target.userId, noId), 400, HOSTED_API_ERROR.INVALID_REQUEST);
  const twoIds = new URL(`https://luke.test${TURN_EVENT_STREAM_PATH}`);
  twoIds.searchParams.append("id", turnId);
  twoIds.searchParams.append("id", turnId);
  await refused(
    options(target.userId, new Request(twoIds, { headers: { authorization: "Bearer token-1" } })),
    400,
    HOSTED_API_ERROR.INVALID_REQUEST,
  );
  for (const after of ["-1", "1.5", "many", "", "0x10", " 3"]) {
    const url = new URL(`https://luke.test${TURN_EVENT_STREAM_PATH}`);
    url.searchParams.set("id", turnId);
    url.searchParams.set(READ_QUERY.AFTER, after);
    await refused(
      options(target.userId, new Request(url, { headers: { authorization: "Bearer token-1" } })),
      400,
      HOSTED_API_ERROR.INVALID_REQUEST,
    );
  }
});

const TURN = {
  id: "1a000000-0000-4000-8000-000000000003",
  origin: TURN_ORIGIN.SPOKEN,
  status: TURN_STATUS.RUNNING,
} as const;

function journal(parts: StoredUIMessage["parts"]): StoredUIMessage {
  return {
    id: TURN.id,
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: { author: MESSAGE_AUTHOR.BRAIN },
    parts,
  };
}

function toolPart(name: string, callId: string): StoredUIMessage["parts"][number] {
  // SAFETY: a stored tool part in the SDK's own shape, as the writer lands one ahead of its run.
  return {
    type: `tool-${name}`,
    toolCallId: callId,
    state: "input-available",
    input: {},
  } as unknown as StoredUIMessage["parts"][number];
}

test("the projection: a turn with no journal or no slow call tells no slow step, a provider write is the other slow kind, and one slow step is told however many slow calls follow", () => {
  assert.deepEqual(projectTurnEvents(TURN, undefined), []);
  assert.deepEqual(projectTurnEvents(TURN, journal([toolPart(ACTION_TOOL.REMEMBER_FACT, "c1")])), [
    {
      turnId: TURN.id,
      seq: 1,
      kind: TURN_EVENT_KIND.SLOW_STEP,
      step: TURN_SLOW_STEP.PROVIDER_WRITE,
    },
  ]);
  assert.deepEqual(
    projectTurnEvents(
      TURN,
      journal([
        toolPart(BRAIN_TOOL.READ_TRANSCRIPT, "c1"),
        toolPart(ACTION_TOOL.SEND_SESSION_MESSAGE, "c2"),
      ]),
    ),
    [
      {
        turnId: TURN.id,
        seq: 1,
        kind: TURN_EVENT_KIND.SLOW_STEP,
        step: TURN_SLOW_STEP.TRANSCRIPT_READ,
      },
    ],
  );
  assert.deepEqual(projectTurnEvents({ ...TURN, status: TURN_STATUS.QUEUED }, undefined), []);
});

test("the projection: a settled turn with no words tells the settled mark and the end alone, and one with words tells each sentence once, in order", () => {
  const settled = { ...TURN, status: TURN_STATUS.SETTLED } as const;
  assert.deepEqual(kinds(projectTurnEvents(settled, journal([]))), [
    TURN_EVENT_KIND.ACTIONS_SETTLED,
    TURN_EVENT_KIND.ENDED,
  ]);
  const words = projectTurnEvents(
    settled,
    journal([
      { type: UI_PART_TYPE.TEXT, text: "First. Second!", state: UI_PART_STATE.DONE },
      { type: UI_PART_TYPE.TEXT, text: "Third?", state: UI_PART_STATE.DONE },
    ]),
  );
  assert.deepEqual(
    words.flatMap((event) =>
      event.kind === TURN_EVENT_KIND.REPLY_SENTENCE ? [event.sentence] : [],
    ),
    ["First.", "Second!", "Third?"],
  );
  assert.deepEqual(
    words.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
});

test("the stream's words are the brain's own: the event kinds are members of the run stream's set, and the slow step kinds are its", () => {
  const runEventKinds = new Set<string>(Object.values(BRAIN_RUN_EVENT));
  for (const kind of Object.values(TURN_EVENT_KIND)) assert.equal(runEventKinds.has(kind), true);
  assert.deepEqual(TURN_SLOW_STEP, SLOW_STEP_KIND);
});

test("the function's duration outlasts an attachment, the rewrite hands the path's id over, and the route carries the duration", async () => {
  assert.ok(
    TURN_EVENT_STREAM_BOUNDS.ATTACHMENT_MS < TURN_EVENT_STREAM_BOUNDS.MAX_DURATION_SECONDS * 1000,
  );
  assert.ok(TURN_EVENT_STREAM_BOUNDS.HEARTBEAT_MS < TURN_EVENT_STREAM_BOUNDS.ATTACHMENT_MS);
  assert.equal(
    FUNCTION_MAX_DURATION_SECONDS.get(TURN_EVENT_STREAM_PATH),
    TURN_EVENT_STREAM_BOUNDS.MAX_DURATION_SECONDS,
  );
  const functions = await webFunctions(fileURLToPath(new URL("..", import.meta.url)));
  const rewrite = apiRewrites(functions).find(
    (candidate) =>
      new URL(candidate.dest, "http://localhost").searchParams.get(DISPATCH_QUERY.ROUTE) ===
      routeKeyOf(TURN_EVENT_STREAM_PATH),
  );
  assert.ok(rewrite);
  const turnId = TURN.id;
  const match = new RegExp(`^${rewrite.src}$`).exec(brainTurnEventsPath(turnId));
  assert.ok(match);
  const destination = new URL(rewrite.dest.replace("$1", match[1] ?? ""), "http://localhost");
  const turnEvents = functions.find((definition) => definition.file === FUNCTION_GROUP.TURN_EVENTS);
  assert.ok(turnEvents);
  assert.equal(destination.pathname, `/${functionPublicPath(turnEvents)}`);
  assert.deepEqual(destination.searchParams.getAll("id"), [turnId]);
});
