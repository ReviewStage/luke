// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { ACT_OUTCOME_STATUS, type ActOutcome } from "@luke/host/acts";
import { ReplyToSelection } from "@luke/panel/tasks/reply-to-selection";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "@luke/panel/testing/composer";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { codingAgentsControl } from "#testing/tasks-control";
import { AgentComposer } from "./agent-composer";
import { AGENT_LEAD, AgentMessage, AgentTab } from "./agent-tab";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";

/**
 * Words selected in an agent's message, answered from its box: Reply stands
 * over a selection inside the agent's words and nowhere else, not over its
 * thoughts or the developer's words; each press lays a quote block in where
 * the caret stands and hands the box the caret on a line under it, the
 * message sent holds each quote as a Markdown blockquote set apart, a
 * message that did not go comes back with its quotes as blocks, a quote's
 * way off takes it out, and a typed `>` line alone sends; and on the agent's own
 * tab, Reply stands down while a message is out.
 */

const AGENT_WORDS = "Option A ships today. Option B waits for review.";
const AGENT_THOUGHT = "Weighing the release calendar.";
const DEVELOPER_WORDS = "Which one is safer?";

/** The agent's turn: a thought, then its words. */
const TURN: CodingAgentMessage = {
  id: "turn",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    { type: "reasoning", text: AGENT_THOUGHT },
    { type: "text", text: AGENT_WORDS },
  ],
};

const ignore = () => undefined;

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  fakeAppBridge({
    act: (): Promise<ActOutcome> =>
      Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** An agent's tab cut to what a reply crosses: one of the agent's messages, one of the developer's, and the box. */
function Tab({ sender }: { sender: MessageSender }): ReactNode {
  const tab = useRef<HTMLElement>(null);
  const replyDoor = useRef<((words: string) => void) | undefined>(undefined);
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(
    "section",
    { ref: tab },
    createElement(AgentMessage, {
      message: TURN,
      plan: false,
      lead: AGENT_LEAD,
      moving: false,
      delegation: { models: [] },
    }),
    createElement("p", null, DEVELOPER_WORDS),
    createElement(AgentComposer, { ...QUIET_COMPOSER, composer, replyDoor }),
    createElement(ReplyToSelection, {
      scope: tab,
      onReply: (words: string) => replyDoor.current?.(words),
    }),
  );
}

/** The tab mounted, every message its box sends written down and answered by `answer`. */
async function mounted(answer: () => Promise<CodingAgentAgentAnswer> = () => new Promise(ignore)) {
  const sent: string[] = [];
  const sender: MessageSender = (_agentId, text) => {
    sent.push(text);
    return answer();
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(Tab, { sender }))),
  );
  await settle();
  return {
    container,
    sent,
    /** The words of the text drawn as `words`, from `from` through `to`, selected as a drag lets them go. */
    select: (words: string, from: string, to: string) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let text: Node | null = walker.nextNode();
      while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
      assert.ok(text instanceof Text, `${words} is drawn`);
      const range = document.createRange();
      range.setStart(text, text.data.indexOf(from));
      range.setEnd(text, text.data.indexOf(to) + to.length);
      const selection = window.getSelection();
      assert.ok(selection);
      selection.removeAllRanges();
      selection.addRange(range);
      act(() => {
        text.parentElement?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      });
    },
    /** Reply, where it stands over the window. */
    reply: () =>
      [...document.body.querySelectorAll<HTMLButtonElement>(".reply-to-selection button")].find(
        (each) => each.textContent === "Reply",
      ),
    /** The box's blocks, in order: each quote as `> ` and its words, each line as typed. */
    blocks: () =>
      [...composerEditor(container).children].map((each) =>
        each.matches("[data-quote]")
          ? `> ${each.querySelector(".composer-quote-words")?.textContent ?? ""}`
          : each.textContent,
      ),
    /** Presses Reply where it stands. */
    pressReply: async () => {
      const reply = [
        ...document.body.querySelectorAll<HTMLButtonElement>(".reply-to-selection button"),
      ].find((each) => each.textContent === "Reply");
      assert.ok(reply, "Reply stands over the selection");
      act(() => reply.click());
      await settle();
    },
  };
}

test("Reply lays the selected words in where the caret stands, a line under each for its answer, and the message sends each as a quote set apart", async () => {
  const tab = await mounted();
  composerEditor(tab.container).blur();

  tab.select(AGENT_WORDS, "Option B", "review.");
  await tab.pressReply();
  assert.deepEqual(tab.blocks(), ["> Option B waits for review.", ""]);
  assert.equal(tab.reply() === undefined, true, "Reply goes once pressed");
  assert.equal(document.activeElement, composerEditor(tab.container), "the box takes the caret");

  typeInComposer(tab.container, "Why wait?");
  tab.select(AGENT_WORDS, "Option A", "today.");
  await tab.pressReply();
  typeInComposer(tab.container, "Ship it.");
  assert.deepEqual(tab.blocks(), [
    "> Option B waits for review.",
    "Why wait?",
    "> Option A ships today.",
    "Ship it.",
  ]);

  pressInComposer(tab.container, "Enter");
  await settle();
  assert.deepEqual(tab.sent, [
    "> Option B waits for review.\n\nWhy wait?\n\n> Option A ships today.\n\nShip it.",
  ]);
  assert.deepEqual(tab.blocks(), [""], "the quotes go with the message");
});

test("a selection outside the agent's words, in its thought or the developer's words, is offered no Reply", async () => {
  const tab = await mounted();
  tab.select(AGENT_THOUGHT, "Weighing", "calendar.");
  assert.equal(tab.reply() === undefined, true, "a thought is not the agent's message");
  tab.select(DEVELOPER_WORDS, "Which", "safer?");
  assert.equal(tab.reply() === undefined, true);
});

test("a message that did not go comes back with its quotes as blocks, a quote's way off takes it out, and a quote alone sends as any words do", async () => {
  const tab = await mounted(() =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
  );
  tab.select(AGENT_WORDS, "Option A", "today.");
  await tab.pressReply();
  tab.select(AGENT_WORDS, "Option B", "review.");
  await tab.pressReply();
  typeInComposer(tab.container, "Ship it");
  pressInComposer(tab.container, "Enter");
  await settle();
  assert.deepEqual(tab.blocks(), [
    "> Option A ships today.",
    "> Option B waits for review.",
    "Ship it",
  ]);

  const remove = tab.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove quote"]',
  );
  assert.ok(remove);
  act(() => remove.click());
  await settle();
  assert.deepEqual(tab.blocks(), ["> Option B waits for review.", "Ship it"]);
  pressInComposer(tab.container, "Enter");
  await settle();

  // A `>` line the developer typed is words, as the quote it reads back as is.
  composerEditor(tab.container).editor?.commands.clearContent(true);
  typeInComposer(tab.container, "> Ship today?");
  pressInComposer(tab.container, "Enter");
  await settle();
  assert.deepEqual(tab.sent, [
    "> Option A ships today.\n\n> Option B waits for review.\n\nShip it",
    "> Option B waits for review.\n\nShip it",
    "> Ship today?",
  ]);
});

/** An agent of the developer's, handed a prompt and answered with one turn. */
const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Release plan",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PROMPT,
};

test("on the agent's tab, Reply quotes its words into the tab's own box, and stands down while a message is out", async () => {
  const sent: string[] = [];
  let reads = 0;
  const control = codingAgentsControl({
    agents: [AGENT],
    // The transcript ends on a page with nothing on it, as an ended agent's does.
    readTranscript: () => {
      reads += 1;
      return Promise.resolve({
        messages:
          reads === 1
            ? [
                {
                  id: "task",
                  role: MESSAGE_ROLE.USER,
                  parts: [{ type: "text", text: "Plan it." }],
                },
                TURN,
              ]
            : [],
        cursor: `${String(reads)}:0`,
        status: AGENT.status,
        title: null,
      });
    },
    // The message never answers, so it stays out.
    onMessage: (_agentId, text) => {
      sent.push(text);
      return new Promise(ignore);
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentTab, {
          agent: AGENT,
          control,
          shown: true,
          onOpenSubagent: ignore,
          onHeld: ignore,
        }),
      ),
    ),
  );
  await settle();
  const select = (from: string, to: string) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let text: Node | null = walker.nextNode();
    while (text !== null && !(text.textContent ?? "").includes(AGENT_WORDS)) {
      text = walker.nextNode();
    }
    assert.ok(text instanceof Text, "the agent's words are drawn");
    const range = document.createRange();
    range.setStart(text, text.data.indexOf(from));
    range.setEnd(text, text.data.indexOf(to) + to.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    act(() => {
      text.parentElement?.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
  };
  const reply = () =>
    [...document.body.querySelectorAll<HTMLButtonElement>(".reply-to-selection button")].find(
      (each) => each.textContent === "Reply",
    );

  select("Option A", "today.");
  const offered = reply();
  assert.ok(offered, "Reply stands over the agent's words");
  act(() => offered.click());
  await settle();
  typeInComposer(container, "Ship it");
  pressInComposer(container, "Enter");
  await settle();
  assert.deepEqual(sent, ["> Option A ships today.\n\nShip it"]);

  select("Option B", "review.");
  assert.equal(reply() === undefined, true, "no reply is taken while the box is held");
});
