// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentAgentAnswer } from "@luke/features/agent-view";
import {
  AGENT_BRIEF,
  AGENT_STATUS,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@luke/features/agent-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import { ACT_KIND } from "@luke/host/acts";
import { SERVER_MENTION_NOTE } from "@luke/ui/agent-servers-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl, pushedTranscripts } from "../testing/tasks-control.js";
import { AgentTab } from "./agent-tab.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TranscriptWords } from "./transcript-blocks.js";

/**
 * server-card.test.ts -- a mention of an MCP server or of one of its tools
 * hangs the server as the MCP popover reads it: its mark, its name, how
 * many tools it offers, and, in an agent's tab, whether the agent has it
 * on, a word with nothing to press; then what the mention does for the
 * agent, then the server's tools, each its title and its badge, or the one
 * tool a tool's mention names. A server switched off for the agent is handed to
 * the turn a line opens alone, or to the next turn where the line reached
 * one under way, as its row says or, not yet read back, as the agent stood
 * when it went; the box says the same of a send now. Off an agent the card
 * says nothing of on or off and has no note. Synthetic agent, plan, and tools.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/relay" };

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

/** Linear's server's tools, out of order, more than a card has height for. */
const TOOLS = [
  { name: "update_issue", description: "Change an issue." },
  {
    name: "list_issues",
    description: "List the team's issues. Filtered by state.",
    annotations: { readOnlyHint: true },
  },
  { name: "get_issue", description: "Read one issue." },
  { name: "create_comment", description: "Comment on an issue." },
  { name: "list_teams", description: "List the teams." },
  { name: "get_user", description: "Read one member." },
  { name: "search_documentation", description: "Search Linear's documentation." },
];

const SERVER = mentionMarkdown({ kind: MENTION_KIND.SERVER, provider: LINEAR }, "Linear", PLACE);

const TOOL = mentionMarkdown(
  { kind: MENTION_KIND.TOOL, provider: LINEAR, tool: "list_issues" },
  "Linear · list_issues",
  PLACE,
);

/** Where Linear stands now, every other integration unavailable. */
let linear: IntegrationStatus = INTEGRATION_STATUS.CONNECTED;

const ignore = () => undefined;

const roots: Root[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

beforeEach(() => {
  linear = INTEGRATION_STATUS.CONNECTED;
  installScrollIntoView();
  installEditorLayout();
  // The main process answers the panel where the integrations stand and Linear's tools; nothing else here.
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.INTEGRATIONS_STATUS]: () => Promise.resolve({ integrations: integrationStatuses() }),
    [ACT_KIND.INTEGRATIONS_TOOLS]: () => Promise.resolve({ tools: TOOLS }),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  fakeAppBridge({});
});

/** Where the integrations stand, as the act port answers the panel: Linear as the test stands it, the rest unavailable. */
function integrationStatuses(): Record<IntegrationProvider, IntegrationStatus> {
  // SAFETY: the entries are made from INTEGRATION_PROVIDER_LIST, one for every provider, which is the record's every key.
  return Object.fromEntries(
    INTEGRATION_PROVIDER_LIST.map((provider) => [
      provider,
      provider === LINEAR ? linear : INTEGRATION_STATUS.UNAVAILABLE,
    ]),
  ) as Record<IntegrationProvider, IntegrationStatus>;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function agentOf(status: AgentStatus, disabledServers: readonly string[]): AgentSummary {
  return {
    id: AGENT_ID,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Triage the backlog",
    createdAt: 1_000,
    status,
    turnId: null,
    brief: AGENT_BRIEF.PROMPT,
    disabledServers,
  };
}

function line(id: string, text: string, arrivedIn?: AgentTranscriptMessage["arrivedIn"]) {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    ...(arrivedIn === undefined ? undefined : { arrivedIn }),
  } satisfies AgentTranscriptMessage;
}

function journal(id: string, text: string): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text }],
    startedAt: 2_000,
    finishedAt: 9_000,
  };
}

/**
 * The transcript: the task, the agent's reply naming Linear, a line that
 * opened the next turn naming Linear, and a line that reached that turn
 * while it ran naming one of its tools.
 */
const TRANSCRIPT: readonly AgentTranscriptMessage[] = [
  line("task", "Triage the backlog."),
  journal("first", `I would look it up in ${SERVER}.`),
  line("opened", `Read it through ${SERVER}.`),
  line("steered", `Try ${TOOL} too.`, { journalId: "second", afterStep: 1 }),
  journal("second", "Read it."),
];

/** A plan's page, which an agent's box takes mentions on. */
const PAGE: TaskMentionsValue = {
  taskId: TASK_ID,
  taskName: "Backlog",
  workspace: PLACE.workspace,
  repository: PLACE.repository,
  text: () => "## Goal\n\nTriage.\n",
  doors: {
    taskId: TASK_ID,
    place: PLACE,
    anchors: new Set(["goal"]),
    onOpenTask: ignore,
    onOpenFile: undefined,
  },
};

/** The node drawn on the plan's page. */
async function drawn(node: ReactNode): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(TaskMentions, { value: PAGE, children: node })),
    ),
  );
  await settle();
  return container;
}

/** The agent's tab over one page of `messages`, its sends never answered. */
function agentTab(
  messages: readonly AgentTranscriptMessage[],
  agent: AgentSummary,
): Promise<HTMLElement> {
  const control = agentsControl({
    agents: [agent],
    transcripts: pushedTranscripts(() => [
      {
        messages: [...messages],
        cursor: "9:0",
        status: agent.status,
        title: null,
      },
    ]),
    onMessage: () => new Promise<AgentAgentAnswer>(ignore),
  });
  return drawn(
    createElement(AgentTab, {
      agent,
      control,
      shown: true,
      onOpenSubagent: ignore,
      onHeld: ignore,
    }),
  );
}

/** What a server's card says, once its reads have landed under the resting pointer. */
async function cardOf(chip: Element | null | undefined) {
  assert.ok(chip, "the mention is drawn as its chip");
  restOn(chip);
  await settle();
  const card = [...document.querySelectorAll(".luke-tooltip-card > [data-server-card]")].at(-1);
  assert.ok(card, "the chip hangs the server's card");
  const look = {
    name: card.querySelector(".luke-hover-card-name")?.textContent,
    count: card.querySelector(".luke-hover-card-sub")?.textContent,
    on: card.querySelector(".luke-hover-card-corner")?.textContent,
    note: card.querySelector(".luke-hover-card-head + .luke-hover-card-note")?.textContent,
    tools: [...card.querySelectorAll('ul[aria-label$=" tools"] > li')].map((tool) => [
      tool.querySelector(".luke-hover-card-row-label")?.textContent,
      tool.querySelector(".luke-hover-card-row-end")?.textContent,
    ]),
    presses: card.querySelectorAll("button, [role=switch]").length,
  };
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return look;
}

/** The chip of the mention in the message given. */
function chipIn(container: HTMLElement, messageId: string): Element | null {
  return container.querySelector(`[data-message-id="${messageId}"] [data-mention-ref]`);
}

test("in an agent's tab with Linear off, a line that opened a turn hands it that turn alone, one that reached a turn under way the next, and the agent's own words say it is off", async () => {
  const container = await agentTab(TRANSCRIPT, agentOf(AGENT_STATUS.COMPLETED, ["linear"]));

  assert.deepEqual(await cardOf(chipIn(container, "opened")), {
    name: "Linear",
    count: "7 tools",
    on: "Off",
    note: SERVER_MENTION_NOTE.OFF_OPENS,
    tools: [
      ["create_comment, Comment on an issue.", undefined],
      ["get_issue, Read one issue.", undefined],
      ["get_user, Read one member.", undefined],
      ["list_issues, List the team's issues.", "Read-only"],
      ["list_teams, List the teams.", undefined],
      ["search_documentation, Search Linear's documentation.", undefined],
      ["update_issue, Change an issue.", undefined],
    ],
    presses: 0,
  });
  assert.deepEqual(await cardOf(chipIn(container, "steered")), {
    name: "Linear",
    count: "7 tools",
    on: "Off",
    note: SERVER_MENTION_NOTE.OFF_STEERS,
    tools: [["list_issues, List the team's issues.", "Read-only"]],
    presses: 0,
  });
  const reply = await cardOf(chipIn(container, "first"));
  assert.equal(reply.on, "Off");
  assert.equal(reply.note, SERVER_MENTION_NOTE.OFF);
});

test("in an agent's tab with Linear on, the line's card says it is on and the message names it", async () => {
  const container = await agentTab(TRANSCRIPT, agentOf(AGENT_STATUS.COMPLETED, []));

  const opened = await cardOf(chipIn(container, "opened"));

  assert.equal(opened.on, "On");
  assert.equal(opened.note, SERVER_MENTION_NOTE.ON_NAMED);
});

test("a line sent while a turn runs, not yet read back, hands Linear to the next turn, as the box says a send now would", async () => {
  const container = await agentTab(
    TRANSCRIPT.slice(0, 2),
    agentOf(AGENT_STATUS.RUNNING, ["linear"]),
  );

  typeInComposer(container, "Use @Lin");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  const drafted = await cardOf(container.querySelector(".agent-composer-input [data-mention-ref]"));
  pressInComposer(container, "Enter");
  await settle();
  const sent = [...container.querySelectorAll(".is-user [data-mention-ref]")].at(-1);

  assert.equal(drafted.note, SERVER_MENTION_NOTE.OFF_STEERS);
  assert.equal((await cardOf(sent)).note, SERVER_MENTION_NOTE.OFF_STEERS);
});

test("in the box of an agent at rest, Linear off, a send hands it the turn the send opens alone", async () => {
  const container = await agentTab(
    TRANSCRIPT.slice(0, 2),
    agentOf(AGENT_STATUS.COMPLETED, ["linear"]),
  );

  typeInComposer(container, "Use @Lin");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  const drafted = await cardOf(container.querySelector(".agent-composer-input [data-mention-ref]"));
  assert.equal(drafted.note, SERVER_MENTION_NOTE.OFF_OPENS);
});

test("a server not connected says so, with no switch and no tools, a tool's mention listing none it was written with", async () => {
  linear = INTEGRATION_STATUS.DISCONNECTED;
  const container = await agentTab(TRANSCRIPT, agentOf(AGENT_STATUS.COMPLETED, []));

  assert.deepEqual(await cardOf(chipIn(container, "opened")), {
    name: "Linear",
    count: undefined,
    on: undefined,
    note: SERVER_MENTION_NOTE.NOT_CONNECTED,
    tools: [],
    presses: 0,
  });
  assert.deepEqual((await cardOf(chipIn(container, "steered"))).tools, []);
});

test("a server whose sign-in expired is handed all the same, its card saying a call to it asks for it to be reconnected", async () => {
  linear = INTEGRATION_STATUS.EXPIRED;
  const container = await agentTab(TRANSCRIPT, agentOf(AGENT_STATUS.COMPLETED, []));

  const opened = await cardOf(chipIn(container, "opened"));

  assert.equal(opened.on, undefined);
  assert.equal(opened.note, SERVER_MENTION_NOTE.EXPIRED);
});

test("off an agent, as in a plan's or Luke's words, the server's row has no switch and nothing is said of a turn", async () => {
  const container = await drawn(
    createElement(TranscriptWords, { text: `Check ${SERVER} and ${TOOL}.` }),
  );
  const [server, tool] = container.querySelectorAll("[data-mention-ref]");

  const serverCard = await cardOf(server);
  const toolCard = await cardOf(tool);

  assert.equal(serverCard.on, undefined);
  assert.equal(serverCard.note, undefined);
  assert.equal(serverCard.count, "7 tools");
  assert.equal(serverCard.tools.length, 7, "the card lists every tool, scrolling past a few");
  assert.deepEqual(toolCard.tools, [["list_issues, List the team's issues.", "Read-only"]]);

  restOn(tool ?? assert.fail("the tool's chip stands"));
  await settle();
  restOn(
    [...document.querySelectorAll('[data-server-card] ul[aria-label$=" tools"] > li > *')].at(-1) ??
      assert.fail("the tool's row stands"),
  );
  await settle();
  assert.equal(
    document.querySelector("[data-tool-card] .luke-hover-card-note")?.textContent,
    "List the team's issues.",
    "the tool's one-line row hangs what it does",
  );
});

test("a keyboard in the server's card reaches what a tool does: Tab to its row opens its card", async () => {
  document.documentElement.dataset.keyboard = "true";
  try {
    const container = await drawn(createElement(TranscriptWords, { text: `Check ${SERVER}.` }));
    const chip =
      container.querySelector<HTMLElement>("[data-mention-ref]") ??
      assert.fail("the server's chip stands");
    focusRestOn(chip);
    await settle();
    act(() => {
      chip.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const card =
      document.querySelector<HTMLElement>(".luke-tooltip-card:has(> [data-server-card])") ??
      assert.fail("⌥↓ enters the server's card");
    assert.ok(card.contains(document.activeElement), "focus is in the server's card");

    // Tab, then the browser moving focus on to the first tool's row.
    const row =
      card.querySelector<HTMLElement>('ul[aria-label$=" tools"] > li > *') ??
      assert.fail("the tool's row stands");
    focusRestOn(row);
    await settle();
    assert.ok(document.activeElement === row, "the tool's row takes the keyboard's focus");
    assert.equal(
      document.querySelector("[data-tool-card] .luke-hover-card-note")?.textContent,
      "Comment on an issue.",
      "the row's focus opens what the tool does",
    );
  } finally {
    delete document.documentElement.dataset.keyboard;
  }
});
