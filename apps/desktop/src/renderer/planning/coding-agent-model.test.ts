import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import {
  AGENT_PART,
  agentParts,
  applyMessagesPage,
  followsAgent,
  modelLabel,
  opensOnGitHub,
  START_NEEDS_REPOSITORY,
  startFailureNote,
} from "./coding-agent-model";

function message(id: string, text: string): CodingAgentMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

test("a page joins the messages held: one heard again is replaced in place, a new one joins at the end", () => {
  const held = [message("a", "first"), message("b", "second")];

  const joined = applyMessagesPage(held, [message("a", "first, amended"), message("c", "third")]);

  assert.deepEqual(
    joined.map((each) => [each.id, each.parts]),
    [
      ["a", [{ type: "text", text: "first, amended" }]],
      ["b", [{ type: "text", text: "second" }]],
      ["c", [{ type: "text", text: "third" }]],
    ],
  );
  assert.equal(applyMessagesPage(held, []), held);
});

test("the transcript is followed only while the tab shows and the agent may still write", () => {
  assert.equal(followsAgent({ shown: true, status: CODING_AGENT_STATUS.RUNNING }), true);
  assert.equal(followsAgent({ shown: true, status: CODING_AGENT_STATUS.STARTING }), true);
  assert.equal(followsAgent({ shown: false, status: CODING_AGENT_STATUS.RUNNING }), false);
  for (const ended of [
    CODING_AGENT_STATUS.COMPLETED,
    CODING_AGENT_STATUS.FAILED,
    CODING_AGENT_STATUS.CANCELLED,
  ]) {
    assert.equal(followsAgent({ shown: true, status: ended }), false, ended);
  }
});

test("a model is named by the catalog where it has been read, else by its own id made readable", () => {
  const models = [
    {
      id: "anthropic/claude-opus-5.5",
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["high"],
    },
  ];
  assert.equal(modelLabel("anthropic/claude-opus-5.5", models), "Claude Opus 5.5");
  assert.equal(modelLabel("anthropic/claude-opus-5.5"), "Claude Opus 5.5");
  assert.equal(modelLabel("openai/gpt-6.1-sol"), "GPT 6.1 Sol");
  assert.equal(modelLabel("openai/gpt-6.1-sol", models), "GPT 6.1 Sol");
});

test("a stored message's parts are read for drawing: text, reasoning, a tool call with its state, and anything else skipped", () => {
  const parts = agentParts({
    id: "m",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Read the guide first." },
      {
        type: "tool-bash",
        toolCallId: "call_1",
        state: "output-error",
        input: { command: "pnpm check" },
        errorText: "exit 1",
      },
      {
        type: "tool-read_file",
        toolCallId: "call_2",
        state: "output-available",
        input: {},
        output: "ok",
      },
      { type: "text", text: "Done." },
      { type: "data-weather", data: {} },
      { type: "text" },
    ],
  });

  assert.deepEqual(parts, [
    { kind: AGENT_PART.STEP_START },
    { kind: AGENT_PART.REASONING, text: "Read the guide first." },
    {
      kind: AGENT_PART.TOOL,
      tool: "bash",
      callId: "call_1",
      state: TOOL_STATE.OUTPUT_ERROR,
      input: { command: "pnpm check" },
      output: undefined,
      errorText: "exit 1",
    },
    {
      kind: AGENT_PART.TOOL,
      tool: "read_file",
      callId: "call_2",
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      input: {},
      output: "ok",
      errorText: undefined,
    },
    { kind: AGENT_PART.TEXT, text: "Done." },
    { kind: AGENT_PART.OTHER },
    { kind: AGENT_PART.OTHER },
  ]);
});

test("only a page on GitHub opens from the transcript, and each Start refusal has its own words", () => {
  assert.equal(opensOnGitHub("https://github.com/acme/relay/pull/7"), true);
  assert.equal(opensOnGitHub("https://example.com/github.com/x"), false);
  assert.equal(opensOnGitHub("javascript:alert(1)"), false);
  assert.equal(startFailureNote(CODING_AGENT_CALL_FAILURE.NO_REPOSITORY), START_NEEDS_REPOSITORY);
  const notes = new Set(Object.values(CODING_AGENT_CALL_FAILURE).map(startFailureNote));
  assert.equal(notes.size, Object.values(CODING_AGENT_CALL_FAILURE).length);
});
