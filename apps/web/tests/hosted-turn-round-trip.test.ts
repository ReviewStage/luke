import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  type ContextRow,
  modelInputFrom,
  readContextRows,
} from "@sidecar/brain/ui-message-context";
import { type ModelMessage, type ToolSet, tool } from "ai";
import { afterAll, test } from "vitest";
import { z } from "zod";
import {
  ACTION_OUTPUT_STATUS,
  BRAIN_REQUEST_STATUS,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainRunEvent,
  isStoredToolPart,
  MAIN_SESSION_KEY,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  RUNTIME_EVENT,
  type RuntimeEvent,
  TurnEvents,
  UI_PART_TYPE,
  UNKNOWN_ACTION_STATUS,
  unknownActionOutput,
  type WireRecord,
} from "../server/core";
import { CONVERSATION_KIND, conversations } from "../server/db/storage-schema";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * One multi-step turn across the whole path the plan draws: the brain's turn
 * teller gathers the runtime's events into the answer's `UIMessage` and tells
 * the stream, the store writer journals that stream row by row, the reader
 * holds the rows to the vocabulary, and the context engine derives the model's
 * input from them. Each layer has its own suite; this one asserts the join,
 * where the plan's guarantees live: a step's parts stay with their step, a
 * reasoning item sits beside the call it preceded, no call is parted from its
 * result, and the journal a writer dies inside still converts to input the
 * model can be handed. Synthetic throughout: no real title, branch, or
 * transcript.
 */
const NOW = 1_800_000_000_000;
const MODEL = "gpt-5";
const REPLAY = { provider: "openai", model: MODEL };

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const UNKNOWN_OUTCOME = z.object({ status: z.literal(UNKNOWN_ACTION_STATUS), reason: z.string() });
const ENVELOPE = z.object({
  status: z.enum([
    ACTION_OUTPUT_STATUS.ACCEPTED,
    UNKNOWN_ACTION_STATUS,
    ACTION_OUTPUT_STATUS.REFUSED,
  ]),
  reason: z.string().optional(),
});
const SESSION = { provider_id: "conductor", provider_session_id: "s-1" };
const SESSION_FIELDS = { provider_id: z.string(), provider_session_id: z.string() };

const TOOLS: ToolSet = {
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ provider_id: z.string(), provider_session_id: z.string() }),
    outputSchema: z.union([z.object({ lines: z.array(z.string()) }), UNKNOWN_OUTCOME]),
  }),
  send_session_message: tool({
    description: "Sends a message to an observed session.",
    inputSchema: z.object({ ...SESSION_FIELDS, text: z.string() }),
    outputSchema: ENVELOPE,
  }),
  run_session_control: tool({
    description: "Runs a control the session advertised.",
    inputSchema: z.object({ ...SESSION_FIELDS, control_id: z.string() }),
    outputSchema: ENVELOPE,
  }),
};

const writer = await storeWriter({ run: database.run, tools: TOOLS, now: () => new Date(NOW) });

const TRANSCRIPT = { lines: ["user: fixture ask", "assistant: fixture reply"] };
const UNKNOWN_SEND = unknownActionOutput("the node closed before it answered");
const REFUSED_CONTROL = {
  status: ACTION_OUTPUT_STATUS.REFUSED,
  reason: "the control is no longer advertised",
};

/** The turn's three inferences, as the runtime reports them: two that call tools and one that answers. */
function inference(
  step: number,
  calls: readonly [string, string, WireRecord][],
  text: string,
): RuntimeEvent[] {
  return [
    { kind: RUNTIME_EVENT.ANSWERED, toolCalls: calls.length },
    { kind: RUNTIME_EVENT.RESPONSE, responseId: `resp_${step}` },
    {
      kind: RUNTIME_EVENT.REASONING,
      reasoning: {
        itemId: `rs_${step}`,
        summary: `Step ${step} thought.`,
        encryptedContent: `opaque-${step}`,
        item: { type: "reasoning", id: `rs_${step}`, encrypted_content: `opaque-${step}` },
      },
    },
    { kind: RUNTIME_EVENT.TEXT, text },
    ...calls.map(
      ([callId, name, input]): RuntimeEvent => ({
        kind: RUNTIME_EVENT.TOOL_CALL,
        invocation: { callId, name, argumentsJson: JSON.stringify(input) },
      }),
    ),
  ];
}

function result(
  callId: string,
  name: string,
  input: WireRecord,
  output: WireRecord,
  status?: string,
): RuntimeEvent {
  return {
    kind: RUNTIME_EVENT.TOOL_RESULT,
    invocation: { callId, name, argumentsJson: JSON.stringify(input) },
    result: {
      outputJson: JSON.stringify(output),
      ...(status !== undefined ? { status } : undefined),
    },
  };
}

/** The teller wired straight into the writer: every event it tells is journaled before the next is heard. */
class Journey {
  readonly told: BrainRunEvent[] = [];
  readonly turn: TurnEvents;
  #ids = 0;

  constructor(private readonly target: ConversationTarget) {
    this.turn = new TurnEvents({
      conversationId: MAIN_SESSION_KEY,
      turnId: randomUUID(),
      fire: (event) => this.told.push(event),
      createMessageId: () => {
        this.#ids += 1;
        return `message-${this.#ids}`;
      },
      now: () => NOW,
    });
  }

  async hear(events: readonly RuntimeEvent[]): Promise<void> {
    for (const event of events) {
      this.turn.heard(event);
      await this.drain();
    }
  }

  async drain(): Promise<void> {
    for (const event of this.told.splice(0)) {
      const written = await writer.consume(this.target, event);
      assert.ok(
        written.ok,
        `${event.kind} at ${event.sequence}: ${written.ok ? "" : written.refusal}`,
      );
    }
  }

  /** The turn's rows as the reader holds them, each with the turn's model, the way the engine is handed them. */
  async rows(): Promise<ContextRow[]> {
    const read = await database.store.messages.list(
      this.target.userId,
      this.target.conversationId,
      TOOLS,
    );
    assert.ok(read.ok);
    // SAFETY: the reader's rows serialize to the JSON the engine reads them back from.
    const items = JSON.parse(
      JSON.stringify(read.value.map((row) => ({ message: row.message, model: MODEL }))),
    ) as WireRecord[];
    const rows = await readContextRows(items, TOOLS);
    assert.ok(rows.ok);
    return rows.value;
  }

  async input(): Promise<ModelMessage[]> {
    return modelInputFrom(await this.rows(), {
      tools: TOOLS,
      replay: REPLAY,
      lostResult: unknownActionOutput("the writer never saw this call answered"),
    });
  }
}

async function conversation(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const [row] = await database.db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.MAIN })
    .returning({ id: conversations.id });
  assert.ok(row);
  return { userId, conversationId: row.id };
}

/** One model message's content as the ids and kinds a step is made of. */
function shape(message: ModelMessage) {
  const content = Array.isArray(message.content) ? message.content : [];
  return {
    role: message.role,
    content: content.map((part): [string, string] => {
      switch (part.type) {
        case "reasoning":
          return [part.type, part.text];
        case "tool-call":
        case "tool-result":
          return [part.type, part.toolCallId];
        case "text":
          return [part.type, part.text];
        default:
          return [part.type, ""];
      }
    }),
  };
}

/** A message's parts as their step structure: each boundary, each reasoning item by id, each call by id and state; the words left out. */
function skeleton(parts: ContextRow["message"]["parts"]): readonly string[][] {
  return parts.flatMap((part): string[][] => {
    if (part.type === UI_PART_TYPE.STEP_START) return [[part.type]];
    if (part.type === UI_PART_TYPE.REASONING) return [[part.type, part.id ?? ""]];
    if (isStoredToolPart(part)) return [[part.type, part.toolCallId, part.state]];
    return [];
  });
}

const READ_INPUT = SESSION;
const SEND_INPUT = { ...SESSION, text: "run the tests" };
const CONTROL_INPUT = { ...SESSION, control_id: "approve" };

test("a multi-step turn told by the brain, journaled by the writer, read back, and converted keeps every step whole with its reasoning and its results", async () => {
  const target = await conversation();
  const journey = new Journey(target);
  const { turn } = journey;
  turn.started(BRAIN_TURN_ORIGIN.TYPED, BRAIN_TURN_TRIGGER.ASK);
  turn.words("Tell the fixture session to run the tests.", {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.TYPED,
  });
  await journey.drain();

  // Step one: read, then send; the send is dispatched and its answer lost.
  await journey.hear(
    inference(
      1,
      [
        ["read_1", "read_transcript", READ_INPUT],
        ["send_1", "send_session_message", SEND_INPUT],
      ],
      "",
    ),
  );
  await journey.hear([result("read_1", "read_transcript", READ_INPUT, TRANSCRIPT)]);
  await journey.hear([
    result("send_1", "send_session_message", SEND_INPUT, UNKNOWN_SEND, UNKNOWN_SEND.status),
  ]);

  // Step two: a control the session no longer advertises, refused.
  await journey.hear(inference(2, [["control_1", "run_session_control", CONTROL_INPUT]], ""));

  // Between the call and its result the journal is what a crash would leave; the model can already be handed it.
  const midway = await journey.input();
  assert.deepEqual(midway.map(shape), [
    { role: "user", content: [["text", "Tell the fixture session to run the tests."]] },
    {
      role: "assistant",
      content: [
        ["reasoning", "Step 1 thought."],
        ["tool-call", "read_1"],
        ["tool-call", "send_1"],
      ],
    },
    {
      role: "tool",
      content: [
        ["tool-result", "read_1"],
        ["tool-result", "send_1"],
      ],
    },
    {
      role: "assistant",
      content: [
        ["reasoning", "Step 2 thought."],
        ["tool-call", "control_1"],
      ],
    },
    { role: "tool", content: [["tool-result", "control_1"]] },
  ]);
  const lost = midway[4]?.content;
  assert.ok(Array.isArray(lost) && lost[0]?.type === "tool-result");
  assert.deepEqual(lost[0].output, {
    type: "json",
    value: { status: UNKNOWN_ACTION_STATUS, reason: "the writer never saw this call answered" },
  });

  await journey.hear([
    result(
      "control_1",
      "run_session_control",
      CONTROL_INPUT,
      REFUSED_CONTROL,
      REFUSED_CONTROL.status,
    ),
  ]);

  // Step three: the answer.
  await journey.hear(inference(3, [], "Told it to run the tests; the control was refused."));

  // The journal the writer kept row by row has the skeleton of the projection
  // the builder finished: the same steps, each holding the same reasoning
  // items and the same calls in the same states. The words and the replay
  // slot arrive only with the projection, which is what the journal is for.
  const [, journal] = await journey.rows();
  turn.answered();
  await journey.drain();
  const [, projection] = await journey.rows();
  assert.ok(journal && projection);
  assert.deepEqual(skeleton(journal.message.parts), skeleton(projection.message.parts));
  assert.deepEqual(skeleton(projection.message.parts), [
    [UI_PART_TYPE.STEP_START],
    [UI_PART_TYPE.REASONING, "rs_1"],
    ["tool-read_transcript", "read_1", "output-available"],
    ["tool-send_session_message", "send_1", "output-available"],
    [UI_PART_TYPE.STEP_START],
    [UI_PART_TYPE.REASONING, "rs_2"],
    ["tool-run_session_control", "control_1", "output-error"],
    [UI_PART_TYPE.STEP_START],
    [UI_PART_TYPE.REASONING, "rs_3"],
  ]);
  assert.equal(
    projection.message.parts.filter((part) => part.type === UI_PART_TYPE.TEXT).length,
    1,
  );

  turn.ended(
    { responseIds: ["resp_1", "resp_2", "resp_3"] },
    BRAIN_REQUEST_STATUS.SUCCEEDED,
    undefined,
  );
  await journey.drain();
  const read = await database.store.messages.list(target.userId, target.conversationId, TOOLS);
  assert.ok(read.ok);
  assert.deepEqual(
    read.value.map((row) => [row.message.role, row.finishedAt !== undefined]),
    [
      [MESSAGE_ROLE.USER, true],
      [MESSAGE_ROLE.ASSISTANT, true],
    ],
  );

  // The model's input: one assistant message per step with its own reasoning and calls,
  // followed by the tool message answering exactly those calls, then the words.
  const input = await journey.input();
  assert.deepEqual(input.map(shape), [
    { role: "user", content: [["text", "Tell the fixture session to run the tests."]] },
    {
      role: "assistant",
      content: [
        ["reasoning", "Step 1 thought."],
        ["tool-call", "read_1"],
        ["tool-call", "send_1"],
      ],
    },
    {
      role: "tool",
      content: [
        ["tool-result", "read_1"],
        ["tool-result", "send_1"],
      ],
    },
    {
      role: "assistant",
      content: [
        ["reasoning", "Step 2 thought."],
        ["tool-call", "control_1"],
      ],
    },
    { role: "tool", content: [["tool-result", "control_1"]] },
    {
      role: "assistant",
      content: [
        ["reasoning", "Step 3 thought."],
        ["text", "Told it to run the tests; the control was refused."],
      ],
    },
  ]);

  // An unknown action is an answer carrying its envelope; a refused one is an error carrying its reason.
  const results = input.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter((part) => part.type === "tool-result")
      : [],
  );
  assert.deepEqual(
    results.map((part) => [part.toolCallId, part.output]),
    [
      ["read_1", { type: "json", value: TRANSCRIPT }],
      ["send_1", { type: "json", value: UNKNOWN_SEND }],
      ["control_1", { type: "error-text", value: REFUSED_CONTROL.reason }],
    ],
  );

  // The opaque reasoning items replay under the model the turn ran on, and under no other.
  const replayed = input.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter((part) => part.type === "reasoning")
      : [],
  );
  assert.deepEqual(
    replayed.map((part) => part.providerOptions?.openai?.reasoningEncryptedContent),
    ["opaque-1", "opaque-2", "opaque-3"],
  );
  const elsewhere = await modelInputFrom(await journey.rows(), {
    tools: TOOLS,
    replay: { provider: "openai", model: "another-model" },
    lostResult: unknownActionOutput("unused"),
  });
  assert.deepEqual(
    elsewhere.flatMap((message) =>
      Array.isArray(message.content)
        ? message.content
            .filter((part) => part.type === "reasoning")
            .map((part) => part.providerOptions)
        : [],
    ),
    [undefined, undefined, undefined],
  );
});
