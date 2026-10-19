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
import { APP_COMMAND, APP_SHORTCUTS, shortcutAria } from "@luke/settings/shortcuts";
import { MESSAGE_ROLE } from "@luke/wire";
import { Duration, Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { useAppKeymap } from "../app-commands.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  QUIET_COMPOSER,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentComposer } from "./agent-composer.js";
import { AGENT_LEAD, AgentMessage, AgentTab } from "./agent-tab.js";
import { ReplyToSelection } from "./reply-to-selection.js";
import { type MessageSender, useAgentComposer } from "./use-agent-composer.js";

/**
 * Words selected in an agent's message, answered from its box: Reply stands
 * over a selection inside the agent's words and nowhere else, not over its
 * thoughts or the developer's words; each press lays a quote block in where
 * the caret stands and hands the box the caret on a line under it, the
 * message sent holds each quote as a Markdown blockquote set apart, a
 * message that did not go comes back with its quotes as blocks, a quote's
 * way off takes it out, and a typed `>` line alone sends; on a touch
 * screen, whose handles may let go with no pointerup, Reply stands under a
 * selection once it rests, and with a mouse only once the pointer lets it
 * go; and on the agent's own tab, Reply stands down while a message is out;
 * and R does what Reply does while it stands, and nothing while it does not.
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

/** How long past its last change a finger's selection is sure to have rested: well past the panel's own settle, a third of a second. */
const RESTED = Duration.seconds(1);

/** The device's main pointer answered as a finger's or a mouse's, which jsdom answers no media query for. */
function answerPointer(coarse: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  answerPointer(false);
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
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** An agent's tab cut to what a reply crosses: one of the agent's messages, one of the developer's, and the box, under the window's keymap. */
function Tab({ sender }: { sender: MessageSender }): ReactNode {
  useAppKeymap(true);
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
    /** The words of the text drawn as `words`, from `from` through `to`, selected as a drag lets them go, or as a finger's handles do where `released` is false: with no pointerup. */
    select: (words: string, from: string, to: string, released = true) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let text: Node | null = walker.nextNode();
      while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
      assert.ok(text instanceof Text, `${words} is drawn`);
      const range = document.createRange();
      range.setStart(text, text.data.indexOf(from));
      range.setEnd(text, text.data.indexOf(to) + to.length);
      const selection = window.getSelection();
      assert.ok(selection);
      act(() => {
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      if (!released) return;
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

test("R replies to the words selected as Reply does, and does nothing while no Reply stands", async () => {
  const tab = await mounted();
  composerEditor(tab.container).blur();
  const pressR = () =>
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true, cancelable: true }),
      );
    });

  pressR();
  await settle();
  assert.deepEqual(tab.blocks(), [""], "R with nothing selected lays nothing in");

  tab.select(AGENT_WORDS, "Option B", "review.");
  assert.equal(
    tab.reply()?.getAttribute("aria-keyshortcuts"),
    shortcutAria(APP_SHORTCUTS[APP_COMMAND.REPLY_TO_SELECTION].chord),
    "Reply names its key",
  );
  pressR();
  await settle();
  assert.deepEqual(tab.blocks(), ["> Option B waits for review.", ""]);
  assert.equal(tab.reply() === undefined, true, "Reply goes once R answers it");
  assert.equal(document.activeElement, composerEditor(tab.container), "the box takes the caret");
});

test("words selected in a pane then hidden, as the narrow Inbox hides its item behind the list, take Reply and R with them", async () => {
  const tab = await mounted();
  composerEditor(tab.container).blur();
  tab.select(AGENT_WORDS, "Option B", "review.");
  assert.ok(tab.reply(), "Reply stands over the selection");

  tab.container.hidden = true;
  await settle();
  assert.equal(tab.reply() === undefined, true, "Reply goes with the pane");
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true, cancelable: true }),
    );
  });
  await settle();
  assert.deepEqual(tab.blocks(), [""], "R lays nothing into the hidden box");
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

test("on a touch screen Reply stands under a selection once it rests, though no pointerup lets it go", async () => {
  answerPointer(true);
  const tab = await mounted();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  tab.select(AGENT_WORDS, "Option B", "review.", false);
  assert.equal(tab.reply() === undefined, true, "a selection still being drawn is offered nothing");
  act(() => {
    vi.advanceTimersByTime(Duration.toMillis(RESTED));
  });
  assert.ok(tab.reply(), "Reply stands once the selection rests");
  vi.useRealTimers();

  await tab.pressReply();
  assert.deepEqual(tab.blocks(), ["> Option B waits for review.", ""]);
});

test("on a touch screen Reply stands under the selection, clear of the system's menu over it, or over it where the window ends first", async () => {
  answerPointer(true);
  const tab = await mounted();
  /** Where Reply stands once the words are selected at `top` to `bottom`. */
  const pressAt = (top: number, bottom: number) => {
    Range.prototype.getBoundingClientRect = () => new DOMRect(40, top, 120, bottom - top);
    tab.select(AGENT_WORDS, "Option B", "review.");
    const press = document.body.querySelector<HTMLElement>(".reply-to-selection");
    assert.ok(press, "Reply stands");
    return Number.parseFloat(press.style.top);
  };

  assert.ok(pressAt(300, 320) > 320, "under the words");
  const end = window.innerHeight;
  assert.ok(pressAt(end - 30, end - 10) < end - 30, "no room under the words, it stands over them");
});

test("with a mouse, a selection resting is offered nothing until the pointer lets it go", async () => {
  const tab = await mounted();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  tab.select(AGENT_WORDS, "Option A", "today.", false);
  act(() => {
    vi.advanceTimersByTime(Duration.toMillis(RESTED));
  });
  assert.equal(tab.reply() === undefined, true, "a mouse's drag is not let go by resting");

  tab.select(AGENT_WORDS, "Option A", "today.");
  assert.ok(tab.reply(), "the pointer letting go offers Reply");
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
  const control = codingAgentsControl({
    agents: [AGENT],
    // The transcript ends on a page with nothing on it, as an ended agent's does.
    transcripts: pushedTranscripts(() => [
      {
        messages: [
          { id: "task", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "Plan it." }] },
          TURN,
        ],
        cursor: "1:0",
        status: AGENT.status,
        title: null,
      },
      { messages: [], cursor: "2:0", status: AGENT.status, title: null },
    ]),
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
