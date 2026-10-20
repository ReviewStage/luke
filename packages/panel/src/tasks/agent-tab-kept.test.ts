// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessagesAnswerView } from "@luke/features/coding-agent-view";
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
import { codingAgentsControl } from "../testing/tasks-control.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { AgentTab, type TranscriptCards } from "./agent-tab.js";
import { TOOL_TARGET } from "./tool-call-model.js";

/**
 * agent-tab-kept.test.ts -- a running agent's tab draws again only the
 * messages a page touched: a page that rewrites the reply still being
 * written leaves every other message's rows as they were drawn, and so
 * does the window drawing the tab again with new presses. The messages it
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
function cardOn(row: HTMLElement | null): readonly (string | null | undefined)[] {
  assert.ok(row, "the row is drawn");
  document.documentElement.dataset.keyboard = "true";
  act(() => row.blur());
  act(() => row.focus());
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.ok(card, "the row hangs a tab's card");
  return [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-corner")?.textContent,
  ];
}

/** Cards that hang what `cards` hangs and note each row that asked for one as it was drawn, by the agent or the worker it opens. */
function recording(cards: TranscriptCards, drawn: string[]): TranscriptCards {
  return {
    ...cards,
    target: (target) => {
      drawn.push(target.kind === TOOL_TARGET.AGENT ? `opens ${target.agent}` : target.kind);
      return cards.target(target);
    },
    worker: (worker) => {
      drawn.push(`worker ${worker.callId}`);
      return cards.worker(worker);
    },
    agent: (agentId) => {
      drawn.push(`names ${agentId}`);
      return cards.agent?.(agentId);
    },
  };
}

/** A running agent's tab over a transcript whose first page is answered at once and each later one when the test hands it. */
function runningTab() {
  fakeAppBridge({});
  const pages: ((answer: CodingAgentMessagesAnswerView) => void)[] = [];
  let first = true;
  const readTranscript = (): Promise<CodingAgentMessagesAnswerView> => {
    if (first) {
      first = false;
      return Promise.resolve(
        page([EARLIER, newest("Reading.")], CODING_AGENT_STATUS.RUNNING, "1:1"),
      );
    }
    return new Promise((resolve) => {
      pages.push(resolve);
    });
  };
  const registry = AtomRegistry.make();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const controlOf = (otherTitle: string) =>
    codingAgentsControl({
      agents: [AGENT, listed("agent-7", otherTitle)],
      readTranscript,
    });
  const cardsOf = (control: ReturnType<typeof controlOf>) =>
    taskCards({
      agents: control,
      workRows: [],
      held: NOTHING_HELD,
      chosen: () => false,
      shownCode: [],
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
        while (pages.length === 0) await Promise.resolve();
        pages.shift()?.(next);
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

test("a page that rewrites the reply still being written draws that reply's rows again and leaves every other message's as they were drawn", async () => {
  const tab = runningTab();
  const drawn: string[] = [];
  const control = tab.controlOf("Invoice export");
  const cards = recording(tab.cardsOf(control), drawn);
  act(() => tab.draw(control, cards));
  await tab.settle();
  tab.openEarlierFold();
  assert.ok(drawn.includes(`worker ${DELEGATE_CALL}`), "the earlier turn's worker row is drawn");
  assert.ok(drawn.includes("names agent-7"), "the earlier turn's message row is drawn");
  assert.ok(drawn.includes("names agent-9"), "the newest turn's message row is drawn");

  // A page touches the newest turn alone, and says the worker stands as it stood.
  drawn.length = 0;
  await tab.answer(page([newest("Reading the retry audit.")], CODING_AGENT_STATUS.RUNNING, "1:2"));
  assert.match(
    tab.container.querySelector('[data-message-id="newest"]')?.textContent ?? "",
    /Reading the retry audit\./u,
  );
  assert.deepEqual([...new Set(drawn)].sort(), ["names agent-9", "opens agent-9"]);
});

test("the window drawing the tab again with presses of its own draws no message again", async () => {
  const tab = runningTab();
  const drawn: string[] = [];
  const control = tab.controlOf("Invoice export");
  const cards = recording(tab.cardsOf(control), drawn);
  act(() => tab.draw(control, cards));
  await tab.settle();
  tab.openEarlierFold();
  assert.ok(drawn.length > 0, "the rows are drawn");

  drawn.length = 0;
  act(() => tab.draw(control, cards));
  assert.deepEqual(drawn, []);
});

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
  assert.equal(cardOn(row("call-message"))[0], "Invoice export");
  const refused = () =>
    tab.container.querySelector<HTMLElement>('[data-call-id="call-refused"]')?.textContent ?? "";
  assert.match(refused(), /Invoice export/u);
  const working = cardOn(row(DELEGATE_CALL))[1];

  // The window draws again with the other agent renamed, and no page has touched the earlier turn.
  act(() => drawOver("Invoice export, retried"));
  assert.equal(cardOn(row("call-message"))[0], "Invoice export, retried");
  assert.match(refused(), /Invoice export, retried/u);

  // A page touches the newest turn alone, and says the worker has finished.
  await tab.answer(
    page([newest("Reading the retry audit.")], CODING_AGENT_STATUS.COMPLETED, "1:2"),
  );
  assert.match(
    tab.container.querySelector('[data-message-id="newest"]')?.textContent ?? "",
    /Reading the retry audit\./u,
  );
  assert.notEqual(cardOn(row(DELEGATE_CALL))[1], working);
});
