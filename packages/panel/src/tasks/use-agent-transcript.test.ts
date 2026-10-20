// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessagesAnswerView } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
} from "@luke/features/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { type AgentTranscriptControl, useAgentTranscript } from "./use-agent-transcript.js";

/**
 * use-agent-transcript.test.ts -- a running agent's tab is answered a page
 * at a time, each saying its workers whole; a page that says them as they
 * stood keeps what the tab holds of them, so the task's page is not drawn
 * again for every page the hold lets go.
 */

const AGENT_ID = "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c";
const CALL_ID = "call-1";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/** A reader whose pages the test hands out one at a time, as the service's hold lets each go. */
function pagedReader() {
  const waiting: ((answer: CodingAgentMessagesAnswerView) => void)[] = [];
  return {
    read: () =>
      new Promise<CodingAgentMessagesAnswerView>((resolve) => {
        waiting.push(resolve);
      }),
    async answer(page: CodingAgentMessagesAnswerView) {
      await act(async () => {
        while (waiting.length === 0) await Promise.resolve();
        waiting.shift()?.(page);
        await Promise.resolve();
      });
    },
  };
}

function page(workerStatus: CodingAgentStatus, cursor: string): CodingAgentMessagesAnswer {
  return {
    messages: [],
    cursor,
    status: CODING_AGENT_STATUS.RUNNING,
    title: "Wire the schema",
    subagentTitles: [{ callId: CALL_ID, title: "Read the schema" }],
    delegations: [{ callId: CALL_ID, startedAt: 10 }],
    subagents: [
      {
        callId: CALL_ID,
        status: workerStatus,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        startedAt: 10,
      },
    ],
  };
}

function mount(read: ReturnType<typeof pagedReader>["read"]): () => AgentTranscriptControl {
  let control: AgentTranscriptControl | undefined;
  function Probe() {
    control = useAgentTranscript({
      agentId: AGENT_ID,
      status: CODING_AGENT_STATUS.RUNNING,
      shown: true,
      read,
      onStatus: () => {},
      onTitle: () => {},
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root?.render(createElement(Probe)));
  return () => {
    assert.ok(control);
    return control;
  };
}

test("a page that says the agent's workers as they stood keeps what the tab holds of them", async () => {
  const reader = pagedReader();
  const control = mount(reader.read);
  await reader.answer(page(CODING_AGENT_STATUS.RUNNING, "1:1"));
  const first = control();
  assert.equal(first.subagentTitles.get(CALL_ID), "Read the schema");

  await reader.answer(page(CODING_AGENT_STATUS.RUNNING, "1:1"));
  const again = control();
  assert.equal(again.pages, first.pages + 1);
  assert.equal(again.subagentTitles, first.subagentTitles);
  assert.equal(again.delegations, first.delegations);
  assert.equal(again.subagents, first.subagents);
});

test("a page that says a worker stands otherwise is held", async () => {
  const reader = pagedReader();
  const control = mount(reader.read);
  await reader.answer(page(CODING_AGENT_STATUS.RUNNING, "1:1"));
  await reader.answer(page(CODING_AGENT_STATUS.COMPLETED, "1:2"));
  assert.equal(control().subagents.get(CALL_ID)?.status, CODING_AGENT_STATUS.COMPLETED);
});
