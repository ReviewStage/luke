// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE, type AgentAgentAnswer } from "@repo/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_RUNTIME,
  AGENT_STATUS,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
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
import { menuItem } from "../testing/desktop-inbox.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";

/**
 * agent-tab-send.test.ts -- a message sent from an agent's tab stands in
 * its transcript at once as the developer's line, the box empty and taking
 * words, and the row the service writes for it lands in the line's place,
 * drawn once, whichever of the row and the send's answer comes first; a
 * message refused stays where it went, marked Not delivered, whether its tab
 * stood as it landed or not, its alert offering Retry and Edit; the working line stands from the
 * press, before the service takes the line. Synthetic throughout.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const KEY = "d16fbf9e-8c7d-42d0-9abb-be91cf7d8076";

/** When the tests press Send, by a clock they hold still. */
const PRESSED_AT = Date.parse("2026-10-30T15:42:00Z");

const AGENT_SUMMARY: AgentSummary = {
  id: AGENT,
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Fix the tile",
  createdAt: 1_000,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  brief: AGENT_BRIEF.PLAN,
};

const MESSAGES: readonly AgentTranscriptMessage[] = [
  { id: "plan", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: "# Fix the tile" }] },
  {
    id: "turn-1",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: "Looking at the tile." }],
    startedAt: 2_000,
    finishedAt: 80_000,
  },
];

const TAKEN: AgentAgentAnswer = {
  agent: {
    id: AGENT,
    planId: TASK,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_000,
    status: AGENT_STATUS.RUNNING,
    turnId: null,
  },
};

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  laid?.remove();
  laid = undefined;
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
async function drawnTab(
  later: readonly AgentTranscriptMessage[],
  agent = AGENT_SUMMARY,
  /** What each page says of the agent: the first, and the one that lands `later`. */
  statuses: readonly [AgentStatus, AgentStatus] = [AGENT_STATUS.COMPLETED, AGENT_STATUS.COMPLETED],
) {
  fakeAppBridge({});
  const answers: ((answer: AgentAgentAnswer) => void)[] = [];
  const sent: { text: string; clientKey: string }[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const page = (messages: readonly AgentTranscriptMessage[], status: AgentStatus) => ({
    messages: [...messages],
    cursor: "2:0",
    status,
    title: null,
  });
  pushedTranscripts(
    () => [page(MESSAGES, statuses[0]), page([...MESSAGES, ...later], statuses[1])],
    {
      page: 1,
      release: released,
    },
  );
  const control = agentsControl({
    agents: [agent],
    onMessage: (_agentId, text, clientKey) => {
      sent.push({ text, clientKey });
      return new Promise((resolve) => answers.push(resolve));
    },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (open: boolean) =>
    act(async () =>
      root.render(
        onRegistry(
          registry,
          open
            ? createElement(AgentTab, {
                agent,
                control,
                shown: true,
                onOpenSubagent: () => undefined,
                onOpenTarget: () => undefined,
                onHeld: () => undefined,
              })
            : createElement("div"),
        ),
      ),
    );
  await draw(true);
  await settle();
  return {
    container,
    sent,
    send: async (words: string) => {
      typeInComposer(container, words);
      pressInComposer(container, "Enter");
      await settle();
    },
    answer: async (index: number, answer: AgentAgentAnswer) => {
      act(() => answers[index]?.(answer));
      await settle();
    },
    landRow: async () => {
      release();
      await settle();
    },
    /** Closes the tab, the window's registry standing, as another tab or task opening does. */
    close: async () => {
      await draw(false);
      await settle();
    },
    /** Opens the tab again on the same registry. */
    open: async () => {
      await draw(true);
      await settle();
    },
    /** Picks `label` from the menu of the red alert beside the line reading `words`. */
    pick: async (words: string, label: string) => {
      const [line] = [...container.querySelectorAll<HTMLElement>(".is-user")].filter((each) =>
        each.textContent?.includes(words),
      );
      const mark =
        line?.querySelector<HTMLButtonElement>('button[aria-label="Not delivered"]') ??
        assert.fail("the line wears the red alert");
      await act(async () => mark.click());
      await act(async () => menuItem(label).click());
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

test("a message sent stands in the transcript at once with its time, the box empty and taking words, and its row lands in its place, drawn once, before the send answers", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
  vi.spyOn(Date, "now").mockReturnValue(PRESSED_AT);
  const row: AgentTranscriptMessage = {
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
  assert.equal(
    drawnAt.querySelector("time")?.getAttribute("datetime"),
    new Date(PRESSED_AT).toISOString(),
    "the press's time stands under it before its row lands",
  );

  await tab.landRow();
  const landed = tab.lines("Now the dark variant.");
  assert.equal(landed.length, 1, "the row takes the line's place rather than standing beside it");
  assert.ok(rowOf(landed[0]) === drawnAt, "in the same row of the list");

  await tab.answer(0, TAKEN);
  assert.equal(tab.lines("Now the dark variant.").length, 1);
});

test("a line whose row landed before its send answered offers Edit only once the service took it, since it may yet withdraw the row", async () => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(KEY);
  const row: AgentTranscriptMessage = {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Now the dark variant." }],
    clientId: sentLineId(KEY),
    sentAt: 90_000,
  };
  const tab = await drawnTab([row]);
  const edit = () =>
    tab.container.querySelector('[data-message-id="row-1"] button[aria-label="Edit"]');
  await tab.send("Now the dark variant.");
  await tab.landRow();

  assert.ok(edit() === null, "no Edit while the send is out");
  await tab.answer(0, TAKEN);
  assert.ok(edit(), "Edit once the service took it");
});

test("a message sent to an agent at rest draws the working line at once, before the service takes it, counting from the press rather than the turn before it", async () => {
  // The summary still holds the ended turn's start, as the task list does until the line wakes it.
  const tab = await drawnTab([], { ...AGENT_SUMMARY, runStartedAt: 2_000 });
  vi.spyOn(Date, "now").mockReturnValue(PRESSED_AT);
  assert.equal(tab.container.querySelector("[data-working]"), null, "an agent at rest");

  await tab.send("Now the dark variant.");

  const working = tab.container.querySelector("[data-working]");
  assert.ok(working, "working from the press");
  assert.equal(working.querySelector("time")?.textContent, "0s", "counted from the press");
  assert.equal(tab.sent.length, 1, "with the send still unanswered");
});

test("a Codex or Claude Code agent's box says nothing under it of the plan that pays", async () => {
  for (const runtime of [AGENT_RUNTIME.CODEX, AGENT_RUNTIME.CLAUDE_CODE]) {
    const tab = await drawnTab([], { ...AGENT_SUMMARY, runtime });
    const box = composerEditor(tab.container).closest(".agent-composer") ?? tab.container;
    for (const words of ["Using ChatGPT plan", "Using Claude plan", "Manage usage"]) {
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
  const row: AgentTranscriptMessage = {
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

/** What the time under a line is led by where it did not go, said as an alert. */
function statusOf(line: HTMLElement | undefined): string | null | undefined {
  return line?.querySelector('.ui-message-line [role="alert"]')?.textContent;
}

test("a message refused stays where it went, marked Not delivered, the box empty, and its alert's Retry sends it again under its key as the newest line", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.send("Then fix CI");

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  assert.equal(
    composerEditor(tab.container).textContent,
    "",
    "the words never come back into the box",
  );
  assert.equal(statusOf(tab.lines("Rebase on main")[0]), "Not delivered");
  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Then fix CI"],
    "the line behind it still goes",
  );
  await tab.answer(1, TAKEN);

  await tab.pick("Rebase on main", "Retry");
  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Then fix CI", "Rebase on main"],
  );
  assert.equal(tab.sent[2]?.clientKey, tab.sent[0]?.clientKey);
  const order = [...tab.container.querySelectorAll(".is-user")].map((each) => each.textContent);
  assert.ok(
    order.findIndex((words) => words?.includes("Rebase on main")) >
      order.findIndex((words) => words?.includes("Then fix CI")),
    "the line tried again stands last",
  );
  assert.equal(statusOf(tab.lines("Rebase on main")[0]), undefined, "and is on its way again");
});

test("Edit takes a message that did not go back into the box, ahead of the words written since, and lets its line go", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  typeInComposer(tab.container, "Then fix CI");

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  await tab.pick("Rebase on main", "Edit");
  assert.equal(tab.lines("Rebase on main").length, 0, "the line is gone");
  pressInComposer(tab.container, "Enter");
  await settle();

  assert.deepEqual(
    tab.sent.map((each) => each.text),
    ["Rebase on main", "Rebase on main\n\nThen fix CI"],
  );
  assert.notEqual(tab.sent[1]?.clientKey, tab.sent[0]?.clientKey, "as a message of its own");
});

test("a refusal that lands while the tab is closed is drawn where the line went once the tab opens again, never in the box", async () => {
  const tab = await drawnTab([]);
  await tab.send("Rebase on main");
  await tab.close();

  await tab.answer(0, { failure: AGENT_CALL_FAILURE.UNANSWERED });
  await tab.open();

  assert.equal(statusOf(tab.lines("Rebase on main")[0]), "Not delivered");
  assert.equal(composerEditor(tab.container).textContent, "");
});

test("a line another hand sent after a stopped turn, its page saying the agent runs, puts the tab to work: no Stopped under it, and ⌘ turns Send into Queue", async () => {
  const handedOn: AgentTranscriptMessage = {
    id: "row-queued",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Open the pull request." }],
    sentAt: 90_000,
  };
  // The tab's summary still says the turn was stopped; the page the line lands on says the agent runs.
  const tab = await drawnTab(
    [handedOn],
    { ...AGENT_SUMMARY, status: AGENT_STATUS.CANCELED, runtime: AGENT_RUNTIME.CLAUDE_CODE },
    [AGENT_STATUS.CANCELED, AGENT_STATUS.RUNNING],
  );
  assert.match(tab.container.textContent ?? "", /Stopped/u, "the stopped turn ends on Stopped");

  await tab.landRow();
  typeInComposer(tab.container, "Then run the tests.");
  await settle();

  assert.doesNotMatch(tab.container.textContent ?? "", /Stopped/u);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true })));
  assert.ok(
    tab.container.querySelector('button[aria-label="Queue"]'),
    "holding ⌘ turns Send into Queue",
  );
});
