// @vitest-environment jsdom

import assert from "node:assert/strict";
import type {
  CodingAgentMessagesAnswerView,
  CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { codingAgentsControl, pushedPage } from "../testing/tasks-control.js";
import { AgentSubagentTab, AgentTab } from "./agent-tab.js";
import type { TranscriptFollower } from "./use-agent-transcript.js";

/**
 * agent-tab-reply-said.test.ts -- an agent's reply is read once it is
 * whole: the transcript is no live region, so the chunks it streams in are
 * not heard, and the page that says the turn completed says the reply
 * once, politely, by who sent it and its first sentence. Synthetic
 * transcript throughout.
 */

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
  document.body.innerHTML = "";
});

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "plan-1",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Retry audit",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
};

const PLAN: CodingAgentMessage = {
  id: "plan",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Audit the retry paths." }],
};

/** The reply as a page reads it: its words so far, or its parts where it called a tool. */
function reply(words: string | readonly WireRecord[]): CodingAgentMessage {
  return {
    id: "reply",
    role: MESSAGE_ROLE.ASSISTANT,
    parts:
      typeof words === "string"
        ? [{ type: "step-start" }, { type: "text", text: words }]
        : [{ type: "step-start" }, ...words],
    startedAt: 1_000,
  };
}

function page(
  words: string | readonly WireRecord[],
  status: CodingAgentStatus,
  cursor: string,
): CodingAgentMessagesAnswerView {
  return { messages: [PLAN, reply(words)], cursor, status, title: null, subagents: [] };
}

/** A call the reply made, answered. */
const READ_TESTS: WireRecord = {
  type: "tool-read",
  toolCallId: "call-read",
  state: "output-available",
  input: { path: "retry.test.ts" },
  output: { ok: true },
};

/** What the worker tab's worker was handed, which names its tab. */
const WORKER_TASK = "Check the CSV writers";

/** A running agent's tab, or its worker's, its first page answered at once and each later one when the test hands it. */
async function runningTab(first: CodingAgentMessagesAnswerView, worker = false) {
  fakeAppBridge({});
  mountAnnouncer();
  let hear: ((page: CodingAgentTranscriptPage) => void) | undefined;
  const transcripts: TranscriptFollower = (_transcript, heard) => {
    hear = heard;
    heard(pushedPage(first));
    return () => {
      hear = undefined;
    };
  };
  const control = codingAgentsControl({ agents: [AGENT], transcripts });
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const registry = AtomRegistry.make();
  const settle = async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  };
  await act(async () => {
    root?.render(
      onRegistry(
        registry,
        worker
          ? createElement(AgentSubagentTab, {
              agentId: AGENT.id,
              callId: "delegation-call",
              task: WORKER_TASK,
              status: CODING_AGENT_STATUS.RUNNING,
              control,
              shown: true,
              onStatus: () => undefined,
              onHeld: () => undefined,
            })
          : createElement(AgentTab, {
              agent: AGENT,
              control,
              shown: true,
              onOpenSubagent: () => undefined,
              onOpenTarget: () => undefined,
              onHeld: () => undefined,
            }),
      ),
    );
    await settle();
  });
  return {
    container,
    async answer(next: CodingAgentMessagesAnswerView) {
      await act(async () => {
        hear?.(pushedPage(next));
        await settle();
      });
    },
  };
}

test("a reply that streams in three chunks is said once, after the last, by who sent it and its first sentence", async () => {
  const tab = await runningTab(page("The retry", CODING_AGENT_STATUS.RUNNING, "1:1"));
  const log = tab.container.querySelector('[role="log"]');
  assert.equal(log?.getAttribute("aria-live"), "off", "the log is no live region");

  await tab.answer(page("The retry paths are", CODING_AGENT_STATUS.RUNNING, "1:2"));
  await tab.answer(
    page("The retry paths are safe. Two callers retry twice.", CODING_AGENT_STATUS.RUNNING, "1:3"),
  );
  assert.equal(announcedPolitely(), "", "nothing is said while the reply streams");

  await tab.answer(
    page(
      "The retry paths are safe. Two callers retry twice.",
      CODING_AGENT_STATUS.COMPLETED,
      "1:4",
    ),
  );
  assert.equal(announcedPolitely(), "Reply from Retry audit: The retry paths are safe.");
  const said = document.querySelector('[role="status"][aria-live="polite"] span');

  // A later page of the same finished turn says nothing again.
  await tab.answer(
    page(
      "The retry paths are safe. Two callers retry twice.",
      CODING_AGENT_STATUS.COMPLETED,
      "1:5",
    ),
  );
  assert.equal(
    document.querySelector('[role="status"][aria-live="polite"] span'),
    said,
    "the reply is said once",
  );
});

test("a tab opened on a turn already finished says nothing", async () => {
  await runningTab(page("The retry paths are safe.", CODING_AGENT_STATUS.COMPLETED, "1:1"));
  assert.equal(announcedPolitely(), "");
});

test("a reader whose focus stands in the transcript hears only who the reply is from", async () => {
  const tab = await runningTab(page("The retry", CODING_AGENT_STATUS.RUNNING, "1:1"));
  const log = tab.container.querySelector<HTMLElement>('[role="log"]');
  assert.ok(log);
  log.tabIndex = -1;
  act(() => log.focus());
  await tab.answer(page("The retry paths are safe.", CODING_AGENT_STATUS.COMPLETED, "1:2"));
  assert.equal(announcedPolitely(), "Reply from Retry audit");
});

test("a turn that ended on a call says no words written before the call as its reply", async () => {
  const tab = await runningTab(page("I'll check the tests.", CODING_AGENT_STATUS.RUNNING, "1:1"));
  await tab.answer(
    page(
      [{ type: "text", text: "I'll check the tests." }, READ_TESTS],
      CODING_AGENT_STATUS.COMPLETED,
      "1:2",
    ),
  );
  assert.equal(announcedPolitely(), "");
});

test("the reply is the words after the turn's last call", async () => {
  const tab = await runningTab(page("I'll check the tests.", CODING_AGENT_STATUS.RUNNING, "1:1"));
  await tab.answer(
    page(
      [
        { type: "text", text: "I'll check the tests." },
        READ_TESTS,
        { type: "text", text: "They pass. Nothing to change." },
      ],
      CODING_AGENT_STATUS.COMPLETED,
      "1:2",
    ),
  );
  assert.equal(announcedPolitely(), "Reply from Retry audit: They pass.");
});

test("a worker's reply is said once whole, under the worker's name", async () => {
  const tab = await runningTab(page("The writers", CODING_AGENT_STATUS.RUNNING, "1:1"), true);
  await tab.answer(page("The writers quote every field.", CODING_AGENT_STATUS.COMPLETED, "1:2"));
  assert.equal(announcedPolitely(), `Reply from ${WORKER_TASK}: The writers quote every field.`);
});
