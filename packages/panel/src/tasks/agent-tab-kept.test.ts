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
import { taskCards } from "../desktop/side-panel.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { focusRestOn } from "../testing/hint-rest.js";
import { codingAgentsControl, pushedPage } from "../testing/tasks-control.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { AgentTab, type BriefTask, type TranscriptCards } from "./agent-tab.js";
import { TOOL_TARGET } from "./tool-call-model.js";
import type { TranscriptFollower } from "./use-agent-transcript.js";

/**
 * agent-tab-kept.test.ts -- a running agent's tab draws again only the
 * messages a page touched: a page that rewrites the reply still being
 * written leaves every other message's rows as they were drawn, and so
 * does the window drawing the tab again with new presses; inside the reply,
 * a page that adds a call draws that call alone. The messages it
 * keeps still hang the cards the window hands now, and say where their
 * workers stand as the newest page reads it.
 *
 * Which rows were drawn is read off the cards the tab is handed: each row
 * that opens a tab asks for that tab's card as it is drawn, so a card
 * door that records what it was asked for records exactly the rows drawn.
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
  delete document.documentElement.dataset.keyboard;
});

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const DELEGATE_CALL = "call-delegate";

function listed(id: string, title: string): CodingAgentSummary {
  return {
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
  };
}

const AGENT = listed(AGENT_ID, "Planning stack");

function tool(tool: string, callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** The plan the agent was handed, which its transcript opens on as the task's card. */
const PLAN: CodingAgentMessage = {
  id: "plan",
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text: "Wire the retry audit." }],
};

/** The agent's first turn, finished: a message to another agent, one refused, and a worker it started. */
const EARLIER: CodingAgentMessage = {
  id: "earlier",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    { type: "step-start" },
    tool(
      "message_coding_agent",
      "call-message",
      { agentId: "agent-7", text: "Rebase" },
      { status: "accepted" },
    ),
    {
      type: "tool-message_coding_agent",
      toolCallId: "call-refused",
      state: "output-error",
      input: { agentId: "agent-7", text: "Rebase again" },
      errorText: "The agent is busy.",
    },
    tool("delegate", DELEGATE_CALL, { task: "Audit the retry paths" }, { status: "accepted" }),
    { type: "text", text: "Handed off." },
  ],
  startedAt: 1_000,
  finishedAt: 2_000,
};

/** The turn the agent is still writing, as a page reads it: a message to a third agent, then its words so far. */
function newest(words: string): CodingAgentMessage {
  return {
    id: "newest",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "step-start" },
      tool(
        "message_coding_agent",
        "call-newest",
        { agentId: "agent-9", text: "Hold the deploy" },
        { status: "accepted" },
      ),
      { type: "step-start" },
      { type: "text", text: words },
    ],
    startedAt: 3_000,
  };
}

function page(
  messages: readonly CodingAgentMessage[],
  worker: CodingAgentStatus,
  cursor: string,
): CodingAgentMessagesAnswerView {
  return {
    messages,
    cursor,
    status: CODING_AGENT_STATUS.RUNNING,
    title: null,
    subagents: [
      {
        callId: DELEGATE_CALL,
        status: worker,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        startedAt: 1_500,
      },
    ],
  };
}

/** The card standing in the window once `row` is reached from the keyboard: its name, then its corner. */
/** What a row's card says: its name, its corner, and whether its tile wears the working mark. */
function cardOn(row: HTMLElement | null): readonly (string | boolean | null | undefined)[] {
  assert.ok(row, "the row is drawn");
  document.documentElement.dataset.keyboard = "true";
  act(() => row.blur());
  focusRestOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.ok(card, "the row hangs a tab's card");
  return [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-corner")?.textContent,
    card.querySelector('.luke-hover-card-lead .state-glyph[data-state="working"]') !== null,
  ];
}

/** A running agent's tab over a transcript whose first page is answered at once and each later one when the test hands it. */
function runningTab() {
  fakeAppBridge({});
  let hear: ((page: CodingAgentTranscriptPage) => void) | undefined;
  const transcripts: TranscriptFollower = (_transcript, heard) => {
    hear = heard;
    heard(
      pushedPage(page([PLAN, EARLIER, newest("Reading.")], CODING_AGENT_STATUS.RUNNING, "1:1")),
    );
    return () => {
      hear = undefined;
    };
  };
  const registry = AtomRegistry.make();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const controlOf = (otherTitle: string) =>
    codingAgentsControl({
      agents: [AGENT, listed("agent-7", otherTitle)],
      transcripts,
    });
  const cardsOf = (control: ReturnType<typeof controlOf>, task?: BriefTask) =>
    taskCards({
      agents: control,
      held: NOTHING_HELD,
      chosen: () => false,
      shownCode: [],
      pages: undefined,
      task,
    }).agent(AGENT_ID);
  const draw = (control: ReturnType<typeof controlOf>, cards: TranscriptCards) => {
    root?.render(
      onRegistry(
        registry,
        createElement(AgentTab, {
          agent: AGENT,
          control,
          shown: true,
          cards,
          // As the window does, each draw hands the tab presses of its own.
          onOpenSubagent: () => undefined,
          onOpenTarget: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    );
  };
  return {
    container,
    controlOf,
    cardsOf,
    draw,
    async settle() {
      await act(async () => {
        for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
      });
    },
    async answer(next: CodingAgentMessagesAnswerView) {
      await act(async () => {
        hear?.(pushedPage(next));
        for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
      });
    },
    openEarlierFold() {
      const fold = container.querySelector<HTMLElement>(
        '[data-message-id="earlier"] [data-turn-fold] > summary',
      );
      assert.ok(fold, "the finished turn folds its calls");
      act(() => fold.click());
    },
  };
}

test("a message a page did not touch hangs the card the window hands now, and its worker's row says where the worker stands as the newest page reads it", async () => {
  const tab = runningTab();
  const drawOver = (otherTitle: string) => {
    const control = tab.controlOf(otherTitle);
    tab.draw(control, tab.cardsOf(control));
  };
  act(() => drawOver("Invoice export"));
  await tab.settle();
  tab.openEarlierFold();
  const row = (callId: string) =>
    tab.container.querySelector<HTMLElement>(`button[data-call-id="${callId}"]`);
  // A message folds its words open, so its card hangs from its chip, the row's way to the agent.
  const messageChip = () =>
    tab.container.querySelector<HTMLElement>('[data-call-id="call-message"] [data-tool-agent-ref]');
  assert.equal(cardOn(messageChip())[0], "Invoice export");
  const refused = () =>
    tab.container.querySelector<HTMLElement>('[data-call-id="call-refused"]')?.textContent ?? "";
  assert.match(refused(), /Invoice export/u);
  assert.equal(cardOn(row(DELEGATE_CALL))[2], true, "the worker's tile wears the working mark");

  // The window draws again with the other agent renamed, and no page has touched the earlier turn.
  act(() => drawOver("Invoice export, retried"));
  assert.equal(cardOn(messageChip())[0], "Invoice export, retried");
  assert.match(refused(), /Invoice export, retried/u);

  // A page touches the newest turn alone, and says the worker has finished.
  await tab.answer(
    page([newest("Reading the retry audit.")], CODING_AGENT_STATUS.COMPLETED, "1:2"),
  );
  assert.match(
    tab.container.querySelector('[data-message-id="newest"]')?.textContent ?? "",
    /Reading the retry audit\./u,
  );
  assert.equal(
    cardOn(row(DELEGATE_CALL))[2],
    false,
    "the finished worker's tile wears its harness",
  );
});

test("a task renamed while its agent's tab stands names the plan's sender anew, hanging the task's new card", async () => {
  const tab = runningTab();
  const control = tab.controlOf("Invoice export");
  const task = (name: string): BriefTask => ({
    name,
    status: undefined,
    card: createElement("span", { "data-task-card-probe": "" }, `${name}, its card`),
  });
  act(() => tab.draw(control, tab.cardsOf(control, task("First draft"))));
  await tab.settle();
  const sender = () => {
    const ref = tab.container.querySelector<HTMLElement>(".agent-origin [data-task-ref]");
    assert.ok(ref, "the plan's card names its task");
    return ref;
  };
  const cardOf = (ref: HTMLElement) => {
    document.documentElement.dataset.keyboard = "true";
    act(() => ref.blur());
    focusRestOn(ref);
    return document.querySelector(".luke-tooltip-card [data-task-card-probe]")?.textContent;
  };
  assert.match(sender().textContent ?? "", /First draft/u);
  assert.equal(cardOf(sender()), "First draft, its card");

  act(() => tab.draw(control, tab.cardsOf(control, task("Final draft"))));
  assert.match(sender().textContent ?? "", /Final draft/u);
  assert.equal(cardOf(sender()), "Final draft, its card");
});

test("a page that adds a call to a running turn draws that call alone, the calls before it standing as drawn", async () => {
  fakeAppBridge({});
  const messaged = (count: number): CodingAgentMessage => ({
    id: "newest",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: Array.from({ length: count }, (_, at) => [
      { type: "step-start" },
      tool(
        "message_coding_agent",
        `call-${at}`,
        { agentId: `agent-${at}`, text: "Rebase" },
        { status: "accepted" },
      ),
    ]).flat(),
    startedAt: 3_000,
  });
  let hear: ((page: CodingAgentTranscriptPage) => void) | undefined;
  const transcripts: TranscriptFollower = (_transcript, heard) => {
    hear = heard;
    heard(pushedPage(page([PLAN, messaged(5)], CODING_AGENT_STATUS.RUNNING, "1:1")));
    return () => {
      hear = undefined;
    };
  };
  // Each call about an agent asks for that agent's card as its row is drawn, so the cards asked for are the rows drawn.
  const asked: string[] = [];
  const cards: TranscriptCards = {
    target: (target) => {
      if (target.kind === TOOL_TARGET.AGENT) asked.push(target.agent);
      return null;
    },
    worker: () => null,
  };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentTab, {
          agent: AGENT,
          control: codingAgentsControl({ agents: [AGENT], transcripts }),
          shown: true,
          cards,
          onOpenSubagent: () => undefined,
          onOpenTarget: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.ok(asked.includes("agent-0"), "the turn's open run of calls is drawn");

  asked.length = 0;
  await act(async () => {
    hear?.(pushedPage(page([messaged(6)], CODING_AGENT_STATUS.RUNNING, "1:2")));
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  assert.deepEqual(asked, ["agent-5"]);
});
