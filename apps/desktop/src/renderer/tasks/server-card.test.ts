// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { MENTION_KIND, type MentionPlace, mentionMarkdown } from "@luke/features/mention-link";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { SERVER_MENTION_NOTE } from "@luke/ui/agent-servers-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "#testing/composer";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { codingAgentsControl } from "#testing/tasks-control";
import { AgentTab } from "./agent-tab";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions";
import { TranscriptWords } from "./transcript-blocks";

/**
 * server-card.test.ts -- a mention of an MCP server or of one of its tools
 * hangs the server's row as the MCP popover draws it: its mark, its name,
 * how many tools it offers, and, in an agent's tab, the agent's switch for
 * it, drawn and never pressed; then what the mention does for the agent,
 * then the server's tools, a few and a count of the rest, or the one tool a
 * tool's mention names. A server switched off for the agent is handed to
 * the turn a line opens alone, or to the next turn where the line reached
 * one under way, as its row says or, not yet read back, as the agent stood
 * when it went; the box says the same of a send now. Off an agent the row
 * has no switch and no note. Synthetic agent, plan, and tools.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PLACE: MentionPlace = { workspace: "acme", repository: "acme/relay" };

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

/** Linear's server's tools, out of order, more than a card lists. */
const TOOLS = [
  { name: "update_issue", description: "Change an issue." },
  { name: "list_issues", description: "List the team's issues. Filtered by state." },
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
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => Promise.resolve(answer(request)),
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  window.localStorage.clear();
  fakeAppBridge({});
});

/** What the main process answers the panel: where the integrations stand and Linear's tools; nothing else here. */
function answer(request: Act): ActOutcome {
  if (request.kind === ACT_KIND.INTEGRATIONS_STATUS) {
    // SAFETY: the entries are made from INTEGRATION_PROVIDER_LIST, one for every provider, which is the record's every key.
    const integrations = Object.fromEntries(
      INTEGRATION_PROVIDER_LIST.map((provider) => [
        provider,
        provider === LINEAR ? linear : INTEGRATION_STATUS.UNAVAILABLE,
      ]),
    ) as Record<IntegrationProvider, IntegrationStatus>;
    return { status: ACT_OUTCOME_STATUS.DONE, value: { integrations } };
  }
  if (request.kind === ACT_KIND.INTEGRATIONS_TOOLS) {
    return { status: ACT_OUTCOME_STATUS.DONE, value: { tools: TOOLS } };
  }
  return { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function agentOf(
  status: CodingAgentStatus,
  disabledServers: readonly string[],
): CodingAgentSummary {
  return {
    id: AGENT_ID,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: "Triage the backlog",
    createdAt: 1_000,
    status,
    turnId: null,
    brief: CODING_AGENT_BRIEF.PROMPT,
    disabledServers,
  };
}

function line(id: string, text: string, arrivedIn?: CodingAgentMessage["arrivedIn"]) {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    ...(arrivedIn === undefined ? undefined : { arrivedIn }),
  } satisfies CodingAgentMessage;
}

function journal(id: string, text: string): CodingAgentMessage {
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
const TRANSCRIPT: readonly CodingAgentMessage[] = [
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
  messages: readonly CodingAgentMessage[],
  agent: CodingAgentSummary,
): Promise<HTMLElement> {
  // Note that only the first read answers, because a read past the cursor waits on the service.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [agent],
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({
        messages: [...messages],
        cursor: "9:0",
        status: agent.status,
        title: null,
      });
    },
    onMessage: () => new Promise<CodingAgentAgentAnswer>(ignore),
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
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  await settle();
  const card = [...document.querySelectorAll(".luke-tooltip-card > [data-server-card]")].at(-1);
  assert.ok(card, "the chip hangs the server's card");
  const drawnSwitch = card.querySelector<HTMLElement>(".luke-switch");
  const look = {
    name: card.querySelector(".task-compose-menu-name")?.textContent,
    count: card.querySelector(".agent-servers-count")?.textContent,
    on: drawnSwitch === null ? undefined : drawnSwitch.dataset.checked,
    note: card.querySelector(".agent-servers-row + .luke-hover-card-note")?.textContent,
    tools: [...card.querySelectorAll('ul[aria-label$=" tools"] > li')].map((tool) => [
      tool.querySelector(".integration-tool-title")?.textContent,
      tool.querySelector(".luke-list-row-description")?.textContent,
    ]),
    more: card.querySelector("ul ~ .luke-hover-card-note")?.textContent,
    presses: card.querySelectorAll("button, [role=switch]").length,
  };
  act(() => {
    chip.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return look;
}

/** The chip of the mention in the message given. */
function chipIn(container: HTMLElement, messageId: string): Element | null {
  return container.querySelector(`[data-message-id="${messageId}"] .mention-chip`);
}

test("in an agent's tab with Linear off, a line that opened a turn hands it that turn alone, one that reached a turn under way the next, and the agent's own words say it is off", async () => {
  const container = await agentTab(TRANSCRIPT, agentOf(CODING_AGENT_STATUS.COMPLETED, ["linear"]));

  assert.deepEqual(await cardOf(chipIn(container, "opened")), {
    name: "Linear",
    count: "7 tools",
    on: "false",
    note: SERVER_MENTION_NOTE.OFF_OPENS,
    tools: [
      ["create_comment", "Comment on an issue."],
      ["get_issue", "Read one issue."],
      ["get_user", "Read one member."],
      ["list_issues", "List the team's issues."],
      ["list_teams", "List the teams."],
    ],
    more: "2 more",
    presses: 0,
  });
  assert.deepEqual(await cardOf(chipIn(container, "steered")), {
    name: "Linear",
    count: "7 tools",
    on: "false",
    note: SERVER_MENTION_NOTE.OFF_STEERS,
    tools: [["list_issues", "List the team's issues."]],
    more: undefined,
    presses: 0,
  });
  const reply = await cardOf(chipIn(container, "first"));
  assert.equal(reply.on, "false");
  assert.equal(reply.note, SERVER_MENTION_NOTE.OFF);
});

test("in an agent's tab with Linear on, the line's card says it is on and the message names it", async () => {
  const container = await agentTab(TRANSCRIPT, agentOf(CODING_AGENT_STATUS.COMPLETED, []));

  const opened = await cardOf(chipIn(container, "opened"));

  assert.equal(opened.on, "true");
  assert.equal(opened.note, SERVER_MENTION_NOTE.ON_NAMED);
});

test("a line sent while a turn runs, not yet read back, hands Linear to the next turn, as the box says a send now would", async () => {
  const container = await agentTab(
    TRANSCRIPT.slice(0, 2),
    agentOf(CODING_AGENT_STATUS.RUNNING, ["linear"]),
  );

  typeInComposer(container, "Use @Lin");
  await settle();
  pressInComposer(container, "Enter");
  await settle();
  const drafted = await cardOf(container.querySelector(".agent-composer-input .mention-chip"));
  pressInComposer(container, "Enter");
  await settle();
  const sent = [...container.querySelectorAll(".is-user .mention-chip")].at(-1);

  assert.equal(drafted.note, SERVER_MENTION_NOTE.OFF_STEERS);
  assert.equal((await cardOf(sent)).note, SERVER_MENTION_NOTE.OFF_STEERS);
});

test("in the box of an agent at rest, Linear off, a send hands it the turn the send opens alone", async () => {
  const container = await agentTab(
    TRANSCRIPT.slice(0, 2),
    agentOf(CODING_AGENT_STATUS.COMPLETED, ["linear"]),
  );

  typeInComposer(container, "Use @Lin");
  await settle();
  pressInComposer(container, "Enter");
  await settle();

  const drafted = await cardOf(container.querySelector(".agent-composer-input .mention-chip"));
  assert.equal(drafted.note, SERVER_MENTION_NOTE.OFF_OPENS);
});

test("a server not connected says so, with no switch and no tools, a tool's mention listing none it was written with", async () => {
  linear = INTEGRATION_STATUS.DISCONNECTED;
  const container = await agentTab(TRANSCRIPT, agentOf(CODING_AGENT_STATUS.COMPLETED, []));

  assert.deepEqual(await cardOf(chipIn(container, "opened")), {
    name: "Linear",
    count: undefined,
    on: undefined,
    note: SERVER_MENTION_NOTE.NOT_CONNECTED,
    tools: [],
    more: undefined,
    presses: 0,
  });
  assert.deepEqual((await cardOf(chipIn(container, "steered"))).tools, []);
});

test("a server whose sign-in expired is handed all the same, its card saying a call to it asks for it to be reconnected", async () => {
  linear = INTEGRATION_STATUS.EXPIRED;
  const container = await agentTab(TRANSCRIPT, agentOf(CODING_AGENT_STATUS.COMPLETED, []));

  const opened = await cardOf(chipIn(container, "opened"));

  assert.equal(opened.on, undefined);
  assert.equal(opened.note, SERVER_MENTION_NOTE.EXPIRED);
});

test("off an agent, as in a plan's or Luke's words, the server's row has no switch and nothing is said of a turn", async () => {
  const container = await drawn(
    createElement(TranscriptWords, { text: `Check ${SERVER} and ${TOOL}.` }),
  );
  const [server, tool] = container.querySelectorAll(".mention-chip");

  const serverCard = await cardOf(server);
  const toolCard = await cardOf(tool);

  assert.equal(serverCard.on, undefined);
  assert.equal(serverCard.note, undefined);
  assert.equal(serverCard.count, "7 tools");
  assert.equal(serverCard.tools.length, 5);
  assert.deepEqual(toolCard.tools, [["list_issues", "List the team's issues."]]);
});
