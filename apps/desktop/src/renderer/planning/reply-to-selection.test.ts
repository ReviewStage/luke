// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  composerEditor,
  installEditorBundle,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { REPLY_SCOPE, ReplyToSelection } from "./reply-to-selection";
import { type MessageSender, useAgentComposer } from "./use-agent-composer";

/**
 * Words selected in an agent's message, answered from its box: Reply stands
 * over a selection inside the agent's words and nowhere else, a press quotes
 * them over the box and hands it the caret, the message sent opens on them
 * as a Markdown quote, a message that did not go brings the reply back
 * apart from its words, and the reply's way off takes it off.
 */

const AGENT_WORDS = "Option A ships today. Option B waits for review.";
const DEVELOPER_WORDS = "Which one is safer?";

const ignore = () => undefined;

const roots: Root[] = [];

// Set before any box renders, since the box reads the editor bundle once per window.
installEditorBundle();

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
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
  const composer = useAgentComposer({
    agentId: "agent-1",
    planId: "plan-1",
    messages: [],
    send: sender,
    onStatus: ignore,
  });
  return createElement(
    "section",
    { ref: tab },
    createElement("p", { className: "agent-words", [REPLY_SCOPE]: "" }, AGENT_WORDS),
    createElement("p", { className: "developer-words" }, DEVELOPER_WORDS),
    createElement(AgentComposer, { ...QUIET_COMPOSER, composer }),
    createElement(ReplyToSelection, { scope: tab, onReply: composer.setReply }),
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
    /** The words of the paragraph named, from `from` through `to`, selected as a drag lets them go. */
    select: (paragraph: string, from: string, to: string) => {
      const text = container.querySelector(paragraph)?.firstChild;
      assert.ok(text instanceof Text);
      const words = text.data;
      const range = document.createRange();
      range.setStart(text, words.indexOf(from));
      range.setEnd(text, words.indexOf(to) + to.length);
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
    /** The words quoted over the box; nothing where it holds no reply. */
    quoted: () => container.querySelector(".agent-composer-reply-words")?.textContent,
  };
}

test("words selected in the agent's message are quoted over the box by Reply, and the message sent opens on them as a quote", async () => {
  const tab = await mounted();
  composerEditor(tab.container).blur();

  tab.select(".agent-words", "Option B", "review.");
  const reply = tab.reply();
  assert.ok(reply, "Reply stands over the selection");
  act(() => reply.click());
  await settle();

  assert.equal(tab.quoted(), "Option B waits for review.");
  assert.equal(tab.reply(), undefined, "Reply goes once pressed");
  assert.equal(document.activeElement, composerEditor(tab.container), "the box takes the caret");

  typeInComposer(tab.container, "Why wait?");
  pressInComposer(tab.container, "Enter");
  await settle();
  assert.deepEqual(tab.sent, ["> Option B waits for review.\n\nWhy wait?"]);
  assert.equal(tab.quoted(), undefined, "the reply goes with the message");
});

test("a selection outside the agent's words is offered no Reply", async () => {
  const tab = await mounted();
  tab.select(".developer-words", "Which", "safer?");
  assert.equal(tab.reply(), undefined);
});

test("a reply alone sends nothing, a message that did not go brings it back apart from its words, and its way off takes it off", async () => {
  const tab = await mounted(() =>
    Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
  );
  tab.select(".agent-words", "Option A", "today.");
  const reply = tab.reply();
  assert.ok(reply);
  act(() => reply.click());
  await settle();
  pressInComposer(tab.container, "Enter");
  await settle();
  assert.deepEqual(tab.sent, [], "a quote alone asks the agent nothing");

  typeInComposer(tab.container, "Ship it");
  pressInComposer(tab.container, "Enter");
  await settle();
  assert.equal(composerEditor(tab.container).textContent, "Ship it");
  assert.equal(tab.quoted(), "Option A ships today.");

  const remove = tab.container.querySelector<HTMLButtonElement>(
    'button[aria-label="Remove reply"]',
  );
  assert.ok(remove);
  act(() => remove.click());
  await settle();
  assert.equal(tab.quoted(), undefined);
  pressInComposer(tab.container, "Enter");
  await settle();
  assert.deepEqual(tab.sent, ["> Option A ships today.\n\nShip it", "Ship it"]);
});
