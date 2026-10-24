// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentAgentAnswer } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
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
 * agent-tab-rewind.test.ts -- an edited message sent from an agent's tab asks
 * before it drops the messages after it, as Revert to here does: Cancel keeps
 * every later message and sends nothing, Send takes the agent back and sends,
 * and the last message is sent at once. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

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

function line(id: string, role: CodingAgentMessage["role"], text: string): CodingAgentMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
    ...(role === MESSAGE_ROLE.ASSISTANT ? { startedAt: 2_000, finishedAt: 80_000 } : undefined),
  };
}

const MESSAGES: readonly CodingAgentMessage[] = [
  line("plan", MESSAGE_ROLE.USER, "# Fix the tile"),
  line("reply-1", MESSAGE_ROLE.ASSISTANT, "Looking at the tile."),
  line("middle", MESSAGE_ROLE.USER, "Use the dark variant."),
  line("reply-2", MESSAGE_ROLE.ASSISTANT, "Dark variant done."),
  line("last", MESSAGE_ROLE.USER, "Now ship it."),
];

const REWOUND: CodingAgentAgentAnswer = {
  agent: {
    id: AGENT,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_000,
    status: CODING_AGENT_STATUS.COMPLETED,
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
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The agent's tab over the transcript, every rewind and send it makes written down in order. */
async function drawnTab(holdSends = false) {
  fakeAppBridge({});
  const calls: string[] = [];
  const control = codingAgentsControl({
    agents: [AGENT_SUMMARY],
    onRewind: (_agentId, messageId) => {
      calls.push(`rewind:${messageId}`);
      return Promise.resolve(REWOUND);
    },
    onMessage: (_agentId, text) => {
      calls.push(`send:${text}`);
      // A send held never answers, so its line stays sent and not yet read back.
      return holdSends ? new Promise(() => undefined) : Promise.resolve(REWOUND);
    },
    transcripts: pushedTranscripts(() => [
      {
        messages: [...MESSAGES],
        cursor: "5:0",
        status: CODING_AGENT_STATUS.COMPLETED,
        title: null,
      },
    ]),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentTab, {
          agent: AGENT_SUMMARY,
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
  const message = (id: string) =>
    container.querySelector<HTMLElement>(`[data-message-id="${id}"]`) ??
    assert.fail(`${id} is drawn in the transcript`);
  /** Opens the message for writing again, replaces its words, and presses Send in its box. */
  const editAndSend = async (id: string, words: string) => {
    const edit = message(id).querySelector<HTMLButtonElement>('button[aria-label="Edit"]');
    assert.ok(edit, `${id} offers Edit`);
    await act(async () => edit.click());
    await settle();
    const box = message(id);
    const field = composerEditor(box);
    act(() => field.focus());
    typeInComposer(box, "");
    typeInComposer(box, words);
    pressInComposer(box, "Enter");
    await settle();
  };
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const press = async (name: string) => {
    const button = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (each) => each.textContent === name,
    );
    assert.ok(button, `the question offers ${name}`);
    await act(async () => button.click());
    await settle();
  };
  /** Sends words from the box at the tab's foot. */
  const sendFromFoot = async (words: string) => {
    typeInComposer(container, words);
    pressInComposer(container, "Enter");
    await settle();
  };
  return { container, calls, message, editAndSend, sendFromFoot, dialog, press };
}

test("sending an edited middle message asks first, and Cancel keeps every later message and sends nothing", async () => {
  const tab = await drawnTab();

  await tab.editAndSend("middle", " and the light one");

  assert.ok(tab.dialog(), "the question stands");
  assert.deepEqual(tab.calls, [], "nothing was cut yet");
  await tab.press("Cancel");

  assert.equal(tab.dialog(), null);
  assert.deepEqual(tab.calls, []);
  for (const id of ["reply-2", "last"]) assert.ok(tab.message(id), `${id} is kept`);
  assert.ok(tab.message("middle").hasAttribute("data-editing"), "the edit stays open");
});

test("Send in the question takes the agent back before the edited message and sends the new words", async () => {
  const tab = await drawnTab();

  await tab.editAndSend("middle", " and the light one");
  await tab.press("Send");

  assert.deepEqual(tab.calls, ["rewind:middle", "send:Use the dark variant. and the light one"]);
});

test("sending an edited last message sends at once, with no question", async () => {
  const tab = await drawnTab();

  await tab.editAndSend("last", " today");

  assert.equal(tab.dialog(), null);
  assert.deepEqual(tab.calls, ["rewind:last", "send:Now ship it. today"]);
});

test("a line sent and not yet read back follows the last message, so editing it asks first", async () => {
  const tab = await drawnTab(true);

  await tab.sendFromFoot("And the docs.");
  await tab.editAndSend("last", " today");

  assert.ok(tab.dialog(), "the question stands");
  assert.deepEqual(tab.calls, ["send:And the docs."], "nothing was cut yet");
});
