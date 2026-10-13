import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { askRecord } from "@sidecar/database/models/asks";
import { type ConversationTarget, storeWriter } from "@sidecar/database/models/writer";
import { isToolUIPart, type ToolSet } from "ai";
import { Effect } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { MESSAGE_ROLE, TOOL_PART_STATE } from "../server/core";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { readRecentMessages } from "../server/hosted/brain-host/context";
import { memoryRelayState, StreamRelay } from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { CONNECTION_TOOL } from "../server/hosted/connection-tools";
import { INTEGRATION } from "../server/hosted/integrations";
import { stampedEveEvent } from "./support/eve-events";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";

/**
 * A turn that used Linear, as eve streams it and the shared relay records
 * it, over the real migrations on PGlite: `connection_search` as its own
 * call, `connection_execute` as its own call, and the Linear tool it ran,
 * nested under it, as a `linear_remote` call of its own with the remote
 * tool's name, its input, and the call it ran under, each settled with
 * what eve answered. The planning assistant's and the coding agent's tool
 * sets are both held to the same record, and every read here holds no
 * Linear connection at all, which is what reading after a Disconnect is.
 */

const NOW = 1_800_000_000_000;

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

const SEARCH_CALL = "call-search";
const EXECUTE_CALL = "call-execute";
/** eve's id for the one call nested under the execute: the wrapper's, then its ordinal. */
const NESTED_CALL = `${EXECUTE_CALL}:1`;

const ISSUE_INPUT = { title: "Invite flow", teamId: "team-1" };
const ISSUE_OUTPUT = { id: "LIN-42", url: "https://linear.app/acme/issue/LIN-42" };

/** One step's opening, its calls, and the results eve emits for them, nested before its wrapper's. */
function linearStep(
  turnId: string,
  nested: { readonly toolName: string; readonly isError?: true },
): MessageStreamEvent[] {
  const sequence = 0;
  const stepIndex = 0;
  return [
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex,
        actions: [
          {
            kind: "tool-call",
            callId: SEARCH_CALL,
            toolName: CONNECTION_TOOL.SEARCH,
            input: { connection: "linear", query: "create issue" },
          },
          {
            kind: "tool-call",
            callId: EXECUTE_CALL,
            toolName: CONNECTION_TOOL.EXECUTE,
            input: { connection: "linear", tool: "create_issue", input: ISSUE_INPUT },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: SEARCH_CALL,
          toolName: CONNECTION_TOOL.SEARCH,
          output: { tools: [{ connection: "linear", name: "create_issue" }] },
        },
      },
    }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex,
        actions: [
          {
            kind: "tool-call",
            callId: NESTED_CALL,
            parentCallId: EXECUTE_CALL,
            toolName: nested.toolName,
            input: ISSUE_INPUT,
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex,
        status: nested.isError ? "failed" : "completed",
        result: {
          kind: "tool-result",
          callId: NESTED_CALL,
          toolName: nested.toolName,
          output: nested.isError ? "Linear refused: team not found" : ISSUE_OUTPUT,
          ...(nested.isError ? { isError: true } : undefined),
        },
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex,
        status: nested.isError ? "failed" : "completed",
        result: {
          kind: "tool-result",
          callId: EXECUTE_CALL,
          toolName: CONNECTION_TOOL.EXECUTE,
          output: nested.isError ? "Linear refused: team not found" : ISSUE_OUTPUT,
          ...(nested.isError ? { isError: true } : undefined),
        },
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex, finishReason: "tool-calls" },
    }),
  ];
}

/** A whole turn: the line, the Linear step, and the words that follow it. */
function linearTurn(
  turnId: string,
  nested: { readonly toolName: string; readonly isError?: true },
): MessageStreamEvent[] {
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({
      type: "message.received",
      data: { turnId, sequence, message: "file the invite bug" },
    }),
    ...linearStep(turnId, nested),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop", message: "Filed LIN-42." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

interface Recorder {
  readonly tools: ToolSet;
  readonly relay: StreamRelay;
  readonly refusals: string[];
}

async function recorder(tools: ToolSet): Promise<Recorder> {
  const writer = await database.run(storeWriter({ tools }));
  const refusals: string[] = [];
  const relay = new StreamRelay({
    writer,
    asks: { binding: askRecord(), stopTurn: () => Effect.void },
    now: () => NOW,
    report: (message) => refusals.push(message),
  });
  return { tools, relay, refusals };
}

async function play(recording: Recorder, events: readonly MessageStreamEvent[]) {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  const target: ConversationTarget = { userId, conversationId };
  const standing = {
    sessionId: `wrun_${randomUUID()}`,
    target,
    turn: BRAIN_HOST_TURN.TYPED,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  for (const event of events) await database.run(recording.relay.handle(event, standing));
  return target;
}

/** The answer's calls as a reader takes them back through the tool set: name, id, state, input, and what it answered. */
async function answeredCalls(recording: Recorder, target: ConversationTarget) {
  const messages = await database.run(readRecentMessages(target, recording.tools, 20));
  const answer = messages.find((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  assert.ok(answer);
  return answer.parts.filter(isToolUIPart).map((part) => ({
    type: part.type,
    toolCallId: part.toolCallId,
    state: part.state,
    input: part.input,
    ...("output" in part ? { output: part.output } : undefined),
    ...("errorText" in part ? { errorText: part.errorText } : undefined),
  }));
}

const TOOL_SETS = [
  { agent: "planning assistant", tools: HOSTED_TOOL_SET },
  { agent: "coding agent", tools: CODER_TOOL_SET },
] as const;

for (const { agent, tools } of TOOL_SETS) {
  it.effect(
    `the ${agent}'s record keeps the search, the execute, and the Linear call it ran, each with its answer, read back with no connection standing`,
    () =>
      Effect.promise(async () => {
        const recording = await recorder(tools);
        const target = await play(
          recording,
          linearTurn("turn_0", { toolName: "linear__create_issue" }),
        );

        assert.deepEqual(recording.refusals, []);
        const calls = await answeredCalls(recording, target);
        assert.deepEqual(
          calls.map(({ type, toolCallId, state }) => ({ type, toolCallId, state })),
          [
            {
              type: `tool-${CONNECTION_TOOL.SEARCH}`,
              toolCallId: SEARCH_CALL,
              state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
            },
            {
              type: `tool-${CONNECTION_TOOL.EXECUTE}`,
              toolCallId: EXECUTE_CALL,
              state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
            },
            {
              type: `tool-${INTEGRATION.linear.REMOTE_TOOL}`,
              toolCallId: NESTED_CALL,
              state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
            },
          ],
        );
        const nested = calls[2];
        assert.deepEqual(nested?.input, {
          remoteTool: "create_issue",
          parentCallId: EXECUTE_CALL,
          input: ISSUE_INPUT,
        });
        assert.deepEqual(nested?.output, ISSUE_OUTPUT);
      }),
  );

  it.effect(
    `a Linear call Linear refused stands in the ${agent}'s record as refused, under the execute that ran it`,
    () =>
      Effect.promise(async () => {
        const recording = await recorder(tools);
        const target = await play(
          recording,
          linearTurn("turn_0", { toolName: "linear__create_issue", isError: true }),
        );

        assert.deepEqual(recording.refusals, []);
        const calls = await answeredCalls(recording, target);
        const nested = calls.find((call) => call.toolCallId === NESTED_CALL);
        assert.equal(nested?.type, `tool-${INTEGRATION.linear.REMOTE_TOOL}`);
        assert.equal(nested?.state, TOOL_PART_STATE.OUTPUT_ERROR);
        assert.equal(
          calls.find((call) => call.toolCallId === EXECUTE_CALL)?.state,
          TOOL_PART_STATE.OUTPUT_ERROR,
        );
      }),
  );
}

it.effect(
  "a nested call of a Notion tool stands in the record under Notion's own stored name",
  () =>
    Effect.promise(async () => {
      const recording = await recorder(HOSTED_TOOL_SET);
      const target = await play(
        recording,
        linearTurn("turn_0", { toolName: "notion__notion-search" }),
      );

      assert.deepEqual(recording.refusals, []);
      const nested = (await answeredCalls(recording, target))[2];
      assert.equal(nested?.type, `tool-${INTEGRATION.notion.REMOTE_TOOL}`);
      assert.deepEqual(nested?.input, {
        remoteTool: "notion-search",
        parentCallId: EXECUTE_CALL,
        input: ISSUE_INPUT,
      });
    }),
);

it.effect(
  "a nested call of no Linear tool is left out with its result, and the turn around it is recorded whole",
  () =>
    Effect.promise(async () => {
      const recording = await recorder(HOSTED_TOOL_SET);
      const target = await play(
        recording,
        linearTurn("turn_0", { toolName: "github__create_issue" }),
      );

      const calls = await answeredCalls(recording, target);
      assert.deepEqual(
        calls.map((call) => call.toolCallId),
        [SEARCH_CALL, EXECUTE_CALL],
      );
      assert.equal(recording.refusals.length, 1);
      assert.match(recording.refusals[0] ?? "", /has no stored name/);
    }),
);

it.effect(
  "a turn cancelled while Linear was answering leaves the Linear call's outcome unknown, never a failure to retry",
  () =>
    Effect.promise(async () => {
      const recording = await recorder(CODER_TOOL_SET);
      const turnId = "turn_0";
      const sequence = 0;
      const step = linearStep(turnId, { toolName: "linear__create_issue" });
      // The nested call was requested and nothing after it arrived before the cancel.
      const requested = step.findIndex(
        (event) =>
          event.type === "actions.requested" &&
          event.data.actions.some((action) => action.callId === NESTED_CALL),
      );
      const target = await play(recording, [
        stamped({ type: "turn.started", data: { turnId, sequence } }),
        stamped({ type: "message.received", data: { turnId, sequence, message: "file it" } }),
        ...step.slice(0, requested + 1),
        stamped({ type: "turn.cancelled", data: { turnId, sequence } }),
      ]);

      const messages = await database.run(readRecentMessages(target, recording.tools, 20));
      const journal = messages.find((message) => message.role === MESSAGE_ROLE.ASSISTANT);
      const nested = journal?.parts
        .filter(isToolUIPart)
        .find((part) => part.toolCallId === NESTED_CALL);
      assert.equal(nested?.type, `tool-${INTEGRATION.linear.REMOTE_TOOL}`);
      assert.equal(nested?.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      assert.match(
        JSON.stringify(nested && "output" in nested ? nested.output : null),
        /may have run/,
      );
    }),
);
