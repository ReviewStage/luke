// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_RUNTIME,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";

/**
 * agent-tab-send.test.ts -- a message sent from an agent's tab stands in
 * its transcript at once as the developer's line, the box empty and taking
 * words, and the row the service writes for it lands in the line's place,
 * drawn once, whichever of the row and the send's answer comes first; a
 * message refused while the developer had written on stays where it went,
 * marked Not sent, with a Retry of its own. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const KEY = "d16fbf9e-8c7d-42d0-9abb-be91cf7d8076";

const AGENT_SUMMARY: CodingAgentSummary = {
  id: AGENT,
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix the tile",
  createdAt: 1_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: CODING_AGENT_BRIEF.PLAN,
};

const MESSAGES: readonly CodingAgentMessage[] = [
  { id: "plan", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "# Fix the tile" }] },
  {
    id: "turn-1",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: "Looking at the tile." }],
    startedAt: 2_000,
    finishedAt: 80_000,
  },
];

const TAKEN: CodingAgentAgentAnswer = {
  agent: {
    id: AGENT,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_000,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
  },
};

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

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
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/**
 * The agent's tab, its sends answered only as the test lets it and its
 * transcript pushed with `later` once the test releases it.
 */
async function drawnTab(later: readonly CodingAgentMessage[], agent = AGENT_SUMMARY) {
  fakeAppBridge({});
  const answers: ((answer: CodingAgentAgentAnswer) => void)[] = [];
  const sent: { text: string; clientKey: string }[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const page = (messages: readonly CodingAgentMessage[]) => ({
    messages: [...messages],
    cursor: "2:0",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
  });
  const control = codingAgentsControl({
    agents: [agent],
    onMessage: (_agentId, text, clientKey) => {
      sent.push({ text, clientKey });
      return new Promise((resolve) => answers.push(resolve));
    },
    transcripts: pushedTranscripts(() => [page(MESSAGES), page([...MESSAGES, ...later])], {
      page: 1,
      release: released,
    }),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentTab, {
          agent,
          control,
          shown: true,
          onOpenSubagent: () => undefined,
          onOpenTarget: () => undefined,
          onHeld: () => undefined,
        }),
      ),
    ),
  );
  await settle();
  return {
    container,
    sent,
    send: async (words: string) => {
      typeInComposer(container, words);
      pressInComposer(container, "Enter");
      await settle();
    },
    answer: async (index: number, answer: CodingAgentAgentAnswer) => {
      act(() => answers[index]?.(answer));
      await settle();
    },
    landRow: async () => {
      release();
      await settle();
    },
    /** The developer's lines in the transcript reading `words`. */
    lines: (words: string) =>
      [...container.querySelectorAll<HTMLElement>(".is-user")].filter((each) =>
        each.textContent?.includes(words),
      ),
  };
}

/** The row of the transcript's list a line is drawn in. */
function rowOf(line: HTMLElement | undefined): Element {
  return line?.closest("[data-row-key]") ?? assert.fail("the line is drawn in a row of the list");
}

test("a message sent stands in the transcript at once, the box empty and taking words, and its row lands in its place, drawn once, before the send answers", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
  const row: CodingAgentMessage = {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Now the dark variant." }],
    clientId: sentLineId(KEY),
    sentAt: 90_000,
  };
  const tab = await drawnTab([row]);
  await tab.send("Now the dark variant.");

  const editor = composerEditor(tab.container);
  assert.equal(editor.textContent, "");
  assert.equal(editor.getAttribute("aria-disabled"), null, "the box takes words");
  assert.equal(document.activeElement, editor, "and keeps the caret");
  const [pending] = tab.lines("Now the dark variant.");
  const drawnAt = rowOf(pending);

  await tab.landRow();
  const landed = tab.lines("Now the dark variant.");
  assert.equal(landed.length, 1, "the row takes the line's place rather than standing beside it");
  assert.ok(rowOf(landed[0]) === drawnAt, "in the same row of the list");

  await tab.answer(0, TAKEN);
  assert.equal(tab.lines("Now the dark variant.").length, 1);
});

test("a Codex or Claude Code agent's box says nothing under it of the plan that pays", async () => {
  for (const runtime of [CODING_AGENT_RUNTIME.CODEX, CODING_AGENT_RUNTIME.CLAUDE_CODE]) {
    const tab = await drawnTab([], { ...AGENT_SUMMARY, runtime });
    const box = composerEditor(tab.container).closest(".agent-composer") ?? tab.container;
    for (const words of ["Using ChatGPT plan", "Using your Claude plan", "Manage usage"]) {
      assert.ok(!box.textContent?.includes(words), `${runtime} draws no "${words}"`);
    }
  }
});

test("two messages of the same words are two lines, each let go by its own row alone", async () => {
  const keys = [
    "e27a0caf-9d8e-43e1-8bcc-cfa2d08e9187",
    "f38b1db0-ae9f-44f2-9cdd-d0b3e19fa298",
  ] as const;
  const mint = vi.spyOn(crypto, "randomUUID");
  for (const key of keys) mint.mockReturnValueOnce(key);
  const row: CodingAgentMessage = {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "ok" }],
    clientId: sentLineId(keys[0]),
  };
  const tab = await drawnTab([row]);
  await tab.send("ok");
  await tab.send("ok");
  assert.equal(tab.lines("ok").length, 2);

  await tab.landRow();
  await tab.answer(0, TAKEN);
  assert.equal(tab.lines("ok").length, 2, "the first row lets go of the first line alone");
  assert.deepEqual(
    tab.sent.map((each) => each.clientKey),
    [...keys],
    "and the second went once the first answered",
  );
});

test("a message refused after the developer wrote on stays where it went, marked Not sent, and its own Retry sends it again under its key", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  typeInComposer(tab.container, "Then fix CI");

  await tab.answer(0, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(composerEditor(tab.container).textContent, "Then fix CI", "the newer words stay");
  const [line] = tab.lines("Rebase on main");
  assert.ok(line, "the refused words stay on their line");
  const mark = line.querySelector("[data-unsent]") ?? assert.fail("marked as not sent");
  const retry = mark.querySelector("button") ?? assert.fail("with a Retry of its own");
  await act(async () => retry.click());
  await settle();

  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Rebase on main"],
  );
  assert.equal(tab.sent[1]?.clientKey, tab.sent[0]?.clientKey);
  assert.equal(line.querySelector("[data-unsent]"), null, "the line is on its way again");
  assert.equal(composerEditor(tab.container).textContent, "Then fix CI");
});
