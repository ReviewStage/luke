import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TURN_END, TURN_EVENT_KIND, TURN_SLOW_STEP, type TurnEvent } from "@sidecar/hosted";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll, test } from "vitest";
import {
  BRAIN_RUN_EVENT,
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  SLOW_STEP_KIND,
  type StoredUIMessage,
  TURN_ORIGIN,
  TURN_STATUS,
  UI_PART_STATE,
  UI_PART_TYPE,
} from "../server/core";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { SEARCH_WEB_TOOL } from "../server/hosted/public-research";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";
import { SHOW_CODE_TOOL } from "../server/hosted/show-code";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import { projectTurnEvents, UNANSWERED_TURN_END_SEQ } from "../server/hosted/turn-events";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * A turn's events over the real migrations on PGlite, with the turn written
 * the way the hosted brain writes one: eve's events relayed through the store
 * writer, and the projection read over the turn row and its journal as they
 * stand. What these tests hold to is that the projection only grows: what a
 * reader heard mid-turn stays where it was numbered, and the rest follows
 * once the turn ends. Synthetic throughout — no real title, branch, or
 * spoken word.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const writer = await database.run(storeWriter({ tools: HOSTED_TOOL_SET }));
const relay = new StreamRelay({
  writer,
  asks: { binding: askRecord(), stopTurn: () => Effect.void },
  now: () => NOW,
  report: () => undefined,
});

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const EVE_TURN = "turn_0";

/** One spoken ask's turn as eve emits it: a repository command, then a two-sentence answer. */
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
            toolName: RUN_IN_REPOSITORY_TOOL.name,
            input: { command: "ls" },
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
          toolName: RUN_IN_REPOSITORY_TOOL.name,
          output: {
            status: REPOSITORY_SHELL_STATUS.RAN,
            exitCode: 0,
            stdout: "README.md\n",
            stderr: "",
          },
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

/**
 * The same turn with its answer streamed as eve streams one, a delta at a
 * time behind the settled read: up to `deltas` of them, the first sentence
 * finished inside the second and the last left forming.
 */
function streamedTurn(turnId: string, deltas = 3): readonly MessageStreamEvent[] {
  const events = spokenTurn(turnId);
  const answer = events.findIndex((event) => event.type === "message.completed");
  const appended = ["One agent fin", "ished. Another is ", "waiting on you."]
    .slice(0, deltas)
    .map((messageDelta) =>
      stamped({
        type: "message.appended",
        data: { turnId, sequence: 0, stepIndex: 1, messageDelta },
      }),
    );
  return [...events.slice(0, answer), ...appended, ...events.slice(answer)];
}

/** The eve events before the answer's first delta that finished a sentence, and that delta: the read settled, the next step's words forming. */
function untilFirstSentence(events: readonly MessageStreamEvent[]): number {
  return events.findIndex((event) => event.type === "message.appended") + 2;
}

/** The text the turn's journal holds now, as a device reading the conversation sees it. */
async function journalText(target: ConversationTarget, turnId: string): Promise<readonly string[]> {
  const read = await database.run(
    database.store.messages.byClientId(
      target.userId,
      target.conversationId,
      HOSTED_TOOL_SET,
      turnId,
    ),
  );
  assert.ok(read.ok);
  return (read.value[0]?.message.parts ?? []).flatMap((part) =>
    part.type === UI_PART_TYPE.TEXT ? [part.text] : [],
  );
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
  for (const event of events) await database.run(relay.handle(event, standing));
}

/** The eve events up to and including the repository command's request: the turn is running with one slow call on its journal. */
function untilRequested(events: readonly MessageStreamEvent[]): number {
  return events.findIndex((event) => event.type === "actions.requested") + 1;
}

/** The turn's events as its record and journal now stand, read the way the voice session reads them. */
async function projected(userId: string, turnId: string): Promise<readonly TurnEvent[]> {
  const [turn] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.ok(turn);
  const journal = await database.run(
    database.store.messages.byClientId(userId, turn.conversationId, HOSTED_TOOL_SET, turn.id),
  );
  assert.ok(journal.ok);
  return projectTurnEvents(turn, journal.value[0]?.message);
}

function kinds(events: readonly TurnEvent[]): readonly string[] {
  return events.map((event) => event.kind);
}

test("mid-turn the slow step is told at once, then the settled mark, the sentences, and the end, numbered in order after it", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = spokenTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilRequested(events)), standing);

  const midTurn = await projected(target.userId, turnId);
  assert.deepEqual(midTurn, [
    { turnId, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.REPOSITORY_READ },
  ]);

  await play(events.slice(untilRequested(events)), standing);
  const heard = await projected(target.userId, turnId);

  assert.deepEqual(kinds(heard), [
    TURN_EVENT_KIND.SLOW_STEP,
    TURN_EVENT_KIND.ACTIONS_SETTLED,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.REPLY_SENTENCE,
    TURN_EVENT_KIND.ENDED,
  ]);
  assert.deepEqual(heard.slice(0, midTurn.length), midTurn);
  assert.deepEqual(
    heard.map((event) => event.seq),
    [1, 2, 3, 4, 5],
  );
  const [, , first, second, end] = heard;
  assert.equal(
    first?.kind === TURN_EVENT_KIND.REPLY_SENTENCE && first.sentence,
    "One agent finished.",
  );
  assert.equal(
    second?.kind === TURN_EVENT_KIND.REPLY_SENTENCE && second.sentence,
    "Another is waiting on you.",
  );
  assert.deepEqual(end, { turnId, seq: 5, kind: TURN_EVENT_KIND.ENDED, end: TURN_END.COMPLETED });
});

test("a sentence that follows only settled calls is heard while the turn still runs, the one still forming waits, and the rest follow with the end", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = streamedTurn(EVE_TURN);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilFirstSentence(events) - 1), standing);
  assert.deepEqual(await journalText(target, turnId), []);
  await play(events.slice(untilFirstSentence(events) - 1, untilFirstSentence(events)), standing);
  assert.deepEqual(await journalText(target, turnId), ["One agent finished."]);

  const running = await projected(target.userId, turnId);
  assert.deepEqual(running, [
    { turnId, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.REPOSITORY_READ },
    { turnId, seq: 2, kind: TURN_EVENT_KIND.ACTIONS_SETTLED },
    { turnId, seq: 3, kind: TURN_EVENT_KIND.REPLY_SENTENCE, sentence: "One agent finished." },
  ]);

  await play(events.slice(untilFirstSentence(events)), standing);
  const rest = await projected(target.userId, turnId);
  assert.deepEqual(rest.slice(running.length), [
    {
      turnId,
      seq: 4,
      kind: TURN_EVENT_KIND.REPLY_SENTENCE,
      sentence: "Another is waiting on you.",
    },
    { turnId, seq: 5, kind: TURN_EVENT_KIND.ENDED, end: TURN_END.COMPLETED },
  ]);
});

test("a turn cancelled after a sentence it released keeps none of its words, and a reader past that sentence still hears the end", async () => {
  const target = await conversation();
  const standing = standingFor(target);
  const events = streamedTurn(EVE_TURN, 2);
  const turnId = hostTurnId(standing.sessionId, EVE_TURN);
  await play(events.slice(0, untilFirstSentence(events)), standing);
  await database.run(
    relay.handle(
      stamped({ type: "turn.cancelled", data: { turnId: EVE_TURN, sequence: 0 } }),
      standing,
    ),
  );

  assert.deepEqual(await journalText(target, turnId), []);
  const heard = await projected(target.userId, turnId);
  assert.deepEqual(
    heard.filter((event) => event.seq > 3),
    [
      {
        turnId,
        seq: UNANSWERED_TURN_END_SEQ,
        kind: TURN_EVENT_KIND.ENDED,
        end: TURN_END.CANCELLED,
      },
    ],
  );
  assert.deepEqual(
    heard.filter((event) => event.seq <= 3),
    [{ turnId, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.REPOSITORY_READ }],
  );
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
    await database.run(relay.handle(stamped(ending), standing));

    assert.deepEqual(await projected(target.userId, turnId), [
      { turnId, seq: 1, kind: TURN_EVENT_KIND.SLOW_STEP, step: TURN_SLOW_STEP.REPOSITORY_READ },
      { turnId, seq: UNANSWERED_TURN_END_SEQ, kind: TURN_EVENT_KIND.ENDED, end },
    ]);
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

function toolPart(
  name: string,
  callId: string,
  input: Readonly<Record<string, string | number>> = {},
  state = "input-available",
): StoredUIMessage["parts"][number] {
  // SAFETY: a stored tool part in the SDK's own shape, as the writer lands one ahead of its run.
  return {
    type: `tool-${name}`,
    toolCallId: callId,
    state,
    input,
  } as unknown as StoredUIMessage["parts"][number];
}

test("the projection: a turn with no journal or no repository command tells no slow step, and one slow step is told however many commands follow", () => {
  assert.deepEqual(projectTurnEvents(TURN, undefined), []);
  assert.deepEqual(projectTurnEvents(TURN, journal([toolPart(SEARCH_WEB_TOOL.name, "c1")])), []);
  assert.deepEqual(
    projectTurnEvents(
      TURN,
      journal([
        toolPart(RUN_IN_REPOSITORY_TOOL.name, "c1", { command: "ls" }),
        toolPart(RUN_IN_REPOSITORY_TOOL.name, "c2", { command: "cat package.json" }),
      ]),
    ),
    [
      {
        turnId: TURN.id,
        seq: 1,
        kind: TURN_EVENT_KIND.SLOW_STEP,
        step: TURN_SLOW_STEP.REPOSITORY_READ,
      },
    ],
  );
  assert.deepEqual(projectTurnEvents({ ...TURN, status: TURN_STATUS.QUEUED }, undefined), []);
});

test("the projection: every question a planning call queued is told before the turn ends, in the order queued, around the one slow step", () => {
  const first = {
    question: "Should a withdrawn invite say who withdrew it?",
    recommendation: "No.",
  };
  const second = { question: "Can an admin re-send it?", recommendation: "Yes, once a day." };
  assert.deepEqual(
    projectTurnEvents(
      TURN,
      journal([
        toolPart(QUEUE_QUESTION_TOOL.name, "c1", first),
        toolPart(RUN_IN_REPOSITORY_TOOL.name, "c2"),
        toolPart(QUEUE_QUESTION_TOOL.name, "c3", second),
        toolPart(RUN_IN_REPOSITORY_TOOL.name, "c4"),
      ]),
    ),
    [
      { turnId: TURN.id, seq: 1, kind: TURN_EVENT_KIND.QUESTION_QUEUED, ...first },
      {
        turnId: TURN.id,
        seq: 2,
        kind: TURN_EVENT_KIND.SLOW_STEP,
        step: TURN_SLOW_STEP.REPOSITORY_READ,
      },
      { turnId: TURN.id, seq: 3, kind: TURN_EVENT_KIND.QUESTION_QUEUED, ...second },
    ],
  );
});

test("the projection: code a planning call shows is told by place, in order with its questions, once its call is whole and reads", () => {
  const shown = { path: "src/invite.ts", startLine: 40, endLine: 58 };
  const queued = { question: "Move the check here?", recommendation: "Yes." };
  assert.deepEqual(
    projectTurnEvents(
      TURN,
      journal([
        toolPart(SHOW_CODE_TOOL.name, "c1", shown),
        toolPart(QUEUE_QUESTION_TOOL.name, "c2", queued),
        toolPart(SHOW_CODE_TOOL.name, "c3", { path: "src/a.ts", startLine: 9, endLine: 2 }),
        toolPart(SHOW_CODE_TOOL.name, "c4", { path: "src/b.ts", startLine: 1 }),
        toolPart(SHOW_CODE_TOOL.name, "c5", { path: "src/c.ts" }, "input-streaming"),
      ]),
    ),
    [
      { turnId: TURN.id, seq: 1, kind: TURN_EVENT_KIND.CODE_SHOWN, ...shown },
      { turnId: TURN.id, seq: 2, kind: TURN_EVENT_KIND.QUESTION_QUEUED, ...queued },
    ],
  );
});

test("the projection: a queued question still streaming in, or one that does not read, is not told", () => {
  assert.deepEqual(
    projectTurnEvents(
      TURN,
      journal([
        toolPart(
          QUEUE_QUESTION_TOOL.name,
          "c1",
          { question: "Should a", recommendation: "N" },
          "input-streaming",
        ),
        toolPart(QUEUE_QUESTION_TOOL.name, "c2", { question: "No recommendation" }),
      ]),
    ),
    [],
  );
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

test("the projection: a reply written in Markdown is spoken without its syntax, and the journal it was read from keeps it", () => {
  const settled = { ...TURN, status: TURN_STATUS.SETTLED } as const;
  const text =
    "**The plan is complete.**\n- Invites expire after `7` days.\n- See [the spec](https://example.com).";
  const record = journal([{ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE }]);
  assert.deepEqual(
    projectTurnEvents(settled, record).flatMap((event) =>
      event.kind === TURN_EVENT_KIND.REPLY_SENTENCE ? [event.sentence] : [],
    ),
    ["The plan is complete.", "Invites expire after 7 days.", "See the spec."],
  );
  assert.deepEqual(record.parts, [{ type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE }]);
});

test("the projection: a running turn's words wait behind a call not yet settled, and everything after them waits too", () => {
  const step = { type: UI_PART_TYPE.STEP_START } as const;
  const words = { type: UI_PART_TYPE.TEXT, text: "Found it.", state: UI_PART_STATE.DONE } as const;
  const question = { question: "Keep the old name?", recommendation: "No." };
  assert.deepEqual(
    kinds(
      projectTurnEvents(
        TURN,
        journal([
          step,
          toolPart(RUN_IN_REPOSITORY_TOOL.name, "c1", { command: "ls" }),
          step,
          words,
          toolPart(QUEUE_QUESTION_TOOL.name, "c2", question),
        ]),
      ),
    ),
    [TURN_EVENT_KIND.SLOW_STEP],
  );
  assert.deepEqual(
    kinds(
      projectTurnEvents(
        TURN,
        journal([
          step,
          toolPart(RUN_IN_REPOSITORY_TOOL.name, "c1", { command: "ls" }, "output-available"),
          step,
          words,
          toolPart(QUEUE_QUESTION_TOOL.name, "c2", question),
        ]),
      ),
    ),
    [
      TURN_EVENT_KIND.SLOW_STEP,
      TURN_EVENT_KIND.ACTIONS_SETTLED,
      TURN_EVENT_KIND.REPLY_SENTENCE,
      TURN_EVENT_KIND.QUESTION_QUEUED,
    ],
  );
});

test("the projection: a turn that did not complete tells none of the words its journal still holds", () => {
  const words = { type: UI_PART_TYPE.TEXT, text: "Done.", state: UI_PART_STATE.DONE } as const;
  for (const status of [TURN_STATUS.CANCELLED, TURN_STATUS.FAILED]) {
    assert.deepEqual(kinds(projectTurnEvents({ ...TURN, status }, journal([words]))), [
      TURN_EVENT_KIND.ENDED,
    ]);
  }
});

test("the events' words are the brain's own: the event kinds are members of the run stream's set, and the slow step kinds are its", () => {
  const runEventKinds = new Set<string>(Object.values(BRAIN_RUN_EVENT));
  for (const kind of Object.values(TURN_EVENT_KIND)) assert.equal(runEventKinds.has(kind), true);
  assert.deepEqual(TURN_SLOW_STEP, SLOW_STEP_KIND);
});
