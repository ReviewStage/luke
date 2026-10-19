// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSubagentStanding,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { ProviderMark } from "@luke/ui";
import { CHAT_PLACE, type ChatPlace, chatNames } from "@luke/ui/chat-model";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test } from "vitest";
import { taskCards } from "../desktop/side-panel.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { codingAgentsControl } from "../testing/tasks-control.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { fixtureChat } from "./chat-fixture.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";

/**
 * agent-tab.test.ts -- a call about something the window draws in a tab of
 * its own is a row that opens that tab, and every other call a row that
 * folds open in place; a run of calls and a finished turn's lead fold under
 * a line saying whether it is open. A row that opens an agent's or a
 * worker's tab hangs that tab's card. A call of an integration's own tool is one row
 * wearing the integration's mark, with the `connection_execute` that ran it
 * left out.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** One stored tool part, answered where `output` is given and still running where not. */
function toolPart(tool: string, input: WireRecord, output?: WireRecord): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: `call-${tool}`,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

function assistant(parts: readonly WireRecord[]): CodingAgentMessage {
  return { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts };
}

/** The message drawn as an agent's turn is, every target its rows open recorded, its workers standing as their own sessions say. */
function drawn(
  message: CodingAgentMessage,
  moving = false,
  standings?: ReadonlyMap<string, CodingAgentSubagentStanding>,
) {
  const opened: ToolTarget[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message,
        plan: false,
        lead: AGENT_LEAD,
        moving,
        delegation: { models: [], standings, onOpenTarget: (target) => opened.push(target) },
      }),
    ),
  );
  return { container, opened };
}

const ACCEPTED = { status: "accepted" };

const OPENING_CALLS: readonly {
  readonly name: string;
  readonly tool: string;
  readonly input: WireRecord;
  readonly output?: WireRecord;
  readonly target: ToolTarget;
}[] = [
  {
    name: "a page shown opens its tab",
    tool: "show_page",
    input: { title: "Pricing explorer", path: "pricing.html" },
    output: { status: "accepted", page: { id: "page-1", version: 2 } },
    target: { kind: TOOL_TARGET.PAGE, page: "page-1" },
  },
  {
    name: "a drawing opens the Board",
    tool: "draw_on_board",
    input: { elements: [] },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.BOARD },
  },
  {
    name: "a look at the board opens the Board",
    tool: "look_at_board",
    input: {},
    output: { status: "looked", image: "data:image/png;base64,AA" },
    target: { kind: TOOL_TARGET.BOARD },
  },
  {
    name: "a read of an agent opens its tab",
    tool: "read_coding_agent",
    input: { agentId: "agent-7" },
    output: { status: "running" },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-7" },
  },
  {
    name: "a message to an agent opens its tab",
    tool: "message_coding_agent",
    input: { agentId: "agent-7", text: "Rebase on main" },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-7" },
  },
  {
    name: "a start opens the agent it began",
    tool: "start_coding_agent",
    input: { task: "Ship the invoice export" },
    output: { status: "accepted", agent: { id: "agent-9" } },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-9" },
  },
  {
    name: "a plan edit opens the plan",
    tool: "edit_plan",
    input: { notes: [{ kind: "add", section: "Goal", text: "Export invoices" }] },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.PLAN },
  },
  {
    name: "code shown opens its file at its lines",
    tool: "show_code",
    input: { path: "src/invoice.ts", startLine: 12, endLine: 40 },
    output: ACCEPTED,
    target: {
      kind: TOOL_TARGET.SHOWN_CODE,
      call: "call-show_code",
      ref: { path: "src/invoice.ts", startLine: 12, endLine: 40 },
    },
  },
  {
    name: "a post to the inbox opens the Inbox",
    tool: "post_to_inbox",
    input: { title: "Which currency?", response: { type: "text" } },
    output: { items: [] },
    target: { kind: TOOL_TARGET.INBOX },
  },
  {
    name: "a close in the inbox opens the Inbox",
    tool: "close_inbox_item",
    input: { key: "currency", reason: "Settled in the plan" },
    output: { items: [] },
    target: { kind: TOOL_TARGET.INBOX },
  },
  {
    name: "a read of the inbox opens the Inbox",
    tool: "read_inbox",
    input: {},
    output: { items: [] },
    target: { kind: TOOL_TARGET.INBOX },
  },
];

for (const call of OPENING_CALLS) {
  test(`${call.name}: its row is one button that opens it`, () => {
    const { container, opened } = drawn(assistant([toolPart(call.tool, call.input, call.output)]));
    const row = container.querySelector<HTMLButtonElement>(
      `button[data-call-id="call-${call.tool}"]`,
    );
    assert.ok(row, "the row is a button");
    assert.equal(container.querySelector("details"), null, "the row folds nothing open in place");
    act(() => row.click());
    assert.deepEqual(opened, [call.target]);
  });
}

const FOLDING_CALLS: readonly {
  readonly name: string;
  readonly part: WireRecord;
}[] = [
  {
    name: "a command on the Mac",
    part: toolPart(
      "run_on_mac",
      { command: "git status" },
      { stdout: "", stderr: "", exitCode: 0 },
    ),
  },
  {
    name: "a message its tool refused",
    part: toolPart(
      "message_coding_agent",
      { agentId: "agent-7", text: "Rebase on main" },
      { status: "rejected", reason: "The agent has ended." },
    ),
  },
  {
    name: "a call that failed",
    part: {
      type: "tool-read_coding_agent",
      toolCallId: "call-read_coding_agent",
      state: "output-error",
      input: { agentId: "agent-7" },
      errorText: "The service did not answer.",
    },
  },
  {
    name: "a page not yet written",
    part: toolPart("show_page", { title: "Pricing explorer" }),
  },
  {
    name: "a drawing the board refused",
    part: toolPart(
      "draw_on_board",
      { elements: [] },
      { status: "not-drawn", reason: "Not drawn: an arrow names an id the diagram does not hold." },
    ),
  },
  {
    name: "a plan edit still running",
    part: toolPart("edit_plan", { notes: [{ kind: "add", section: "Goal", text: "Export" }] }),
  },
  {
    name: "a file the agent read, which its checkout holds and GitHub may not",
    part: toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
  },
  {
    name: "a file the agent wrote, which its pull request may not hold yet",
    part: toolPart(
      "write_file",
      { filePath: "src/new.ts", content: "export {}" },
      { path: "src/new.ts" },
    ),
  },
];

for (const call of FOLDING_CALLS) {
  test(`${call.name} opens nothing: its row folds its input and answer open in place`, () => {
    const { container, opened } = drawn(assistant([call.part]));
    assert.equal(container.querySelector("button[data-opens]"), null);
    const row = container.querySelector("summary");
    assert.ok(row, "the row is a fold's line");
    act(() => row.click());
    assert.deepEqual(opened, []);
  });
}

test("a run of calls folds under a line that says it is open", () => {
  const { container } = drawn(
    assistant([
      toolPart("list_coding_agents", {}, { agents: [] }),
      toolPart("run_on_mac", { command: "git status" }),
    ]),
    true,
  );
  const group = container.querySelector("[data-turn-fold] > summary");
  assert.equal(group?.textContent, "2 tools called");
  assert.equal(group?.getAttribute("aria-expanded"), "true", "the group says it is open");
});

test("a finished turn's lead folds under a line that opens as it is pressed", () => {
  const { container } = drawn(
    assistant([
      toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
      { type: "text", text: "Read it." },
      toolPart("run_on_mac", { command: "git status" }, { output: "clean" }),
      { type: "text", text: "All clean." },
    ]),
  );
  const fold = container.querySelector<HTMLElement>("[data-turn-fold] > summary");
  assert.equal(fold?.textContent, "2 tool calls, 1 message");
  assert.equal(fold?.getAttribute("aria-expanded"), "false", "the fold stands closed");
  act(() => fold?.click());
  assert.equal(fold?.getAttribute("aria-expanded"), "true", "the pressed fold says it is open");
  const rows = [...container.querySelectorAll("[data-turn-fold] summary")];
  assert.ok(
    rows.some((row) => row.textContent?.includes("src/new.ts")),
    "the opened fold lists the read",
  );
});

/** A stored tool part whose call failed. */
function failedPart(tool: string, input: WireRecord): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: `call-${tool}`,
    state: "output-error",
    input,
    errorText: "The command did not run.",
  };
}

/** What a closed fold's line says of a failure: its failed mark, and its label. */
function failureOn(line: Element | null | undefined) {
  assert.equal(line?.getAttribute("aria-expanded"), "false", "the fold is closed");
  return {
    marked: line?.querySelector('[role="img"][aria-label="Failed"]') !== null,
    label: line?.getAttribute("aria-label") ?? undefined,
  };
}

const FAILURE_LINES: readonly {
  readonly name: string;
  readonly parts: readonly WireRecord[];
  readonly standings?: ReadonlyMap<string, CodingAgentSubagentStanding>;
  readonly label: string | undefined;
}[] = [
  {
    name: "a stopped turn's run of calls, one of which failed",
    parts: [
      failedPart("run_on_mac", { command: "pnpm test" }),
      toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
    ],
    label: "2 tools called, a call failed",
  },
  {
    name: "a stopped turn's run of calls that all answered",
    parts: [
      toolPart("run_on_mac", { command: "pnpm test" }, { output: "ok" }),
      toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
    ],
    label: undefined,
  },
  {
    name: "a finished turn's lead holding a call that failed",
    parts: [
      failedPart("run_on_mac", { command: "pnpm test" }),
      { type: "text", text: "The tests did not run." },
      toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
      { type: "text", text: "Read it." },
    ],
    label: "2 tool calls, 1 message, a call failed",
  },
  {
    name: "a finished turn's lead whose calls all answered",
    parts: [
      toolPart("run_on_mac", { command: "pnpm test" }, { output: "ok" }),
      toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
      { type: "text", text: "All green." },
    ],
    label: undefined,
  },
  {
    name: "a run whose worker's own session failed after its call answered",
    parts: [
      toolPart("delegate", { task: "Audit the retry paths" }, { status: "accepted" }),
      toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
    ],
    standings: new Map([
      [
        "call-delegate",
        {
          callId: "call-delegate",
          status: CODING_AGENT_STATUS.FAILED,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          startedAt: 1,
        },
      ],
    ]),
    label: "1 tool called, 1 subagent, a call failed",
  },
];

for (const { name, parts, standings, label } of FAILURE_LINES) {
  test(`a closed fold's line wears the failed mark where a call it holds failed: ${name}`, () => {
    const { container } = drawn(assistant(parts), false, standings);
    const line = container.querySelector("[data-turn-fold] > summary");
    assert.deepEqual(failureOn(line), { marked: label !== undefined, label });
  });
}

/** An agent of the task's, as its list holds it. */
function listedAgent(id: string, title: string, overrides: Partial<CodingAgentSummary> = {}) {
  return {
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
    ...overrides,
  } satisfies CodingAgentSummary;
}

/** The card standing in the window once `row` is reached from the keyboard: its name, then its corner. */
function cardOn(row: HTMLElement | null): readonly (string | null | undefined)[] {
  assert.ok(row, "the row is drawn");
  document.documentElement.dataset.keyboard = "true";
  act(() => row.focus());
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.ok(card, "the row hangs a tab's card");
  return [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-corner")?.textContent,
  ];
}

test("in an agent's transcript, a call about an agent hangs that agent's tab's card, archived or not found as well, and a delegation's row its worker's", () => {
  const agents = codingAgentsControl({
    agents: [listedAgent("agent-7", "Invoice export")],
    archived: [
      listedAgent("agent-8", "Retry audit", {
        status: CODING_AGENT_STATUS.CANCELLED,
        archivedAt: 2,
      }),
    ],
  });
  const cards = taskCards({
    agents,
    workRows: [],
    held: NOTHING_HELD,
    chosen: () => false,
    shownCode: [],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const message = assistant([
    toolPart("message_coding_agent", { agentId: "agent-7", text: "Rebase on main" }, ACCEPTED),
    toolPart("read_coding_agent", { agentId: "agent-8" }, { status: "cancelled" }),
    toolPart(
      "start_coding_agent",
      { task: "Gone" },
      { status: "accepted", agent: { id: "agent-9" } },
    ),
    toolPart("delegate", { task: "Audit the retry paths" }),
  ]);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message,
        plan: false,
        lead: AGENT_LEAD,
        moving: false,
        delegation: {
          models: [],
          onOpen: () => undefined,
          onOpenTarget: () => undefined,
          cards: cards.agent("agent-1"),
        },
      }),
    ),
  );
  const row = (callId: string) =>
    container.querySelector<HTMLElement>(`button[data-call-id="call-${callId}"]`);
  // The calls run together fold under one line, which a press opens.
  const fold = container.querySelector<HTMLElement>("[data-turn-fold] > summary");
  act(() => fold?.click());
  assert.deepEqual(cardOn(row("message_coding_agent")), ["Invoice export", "Working…"]);
  const [archived, corner] = cardOn(row("read_coding_agent"));
  assert.equal(archived, "Retry audit");
  assert.match(corner ?? "", /^Archived · /u);
  assert.deepEqual(cardOn(row("start_coding_agent")), ["Coding agent", "Not found"]);
  assert.deepEqual(cardOn(row("delegate")), ["Audit the retry paths", "Working…"]);
});

test("a call about an agent names it by its chip in the place of the words, as its tab names it or its answer does, wearing the harness its answer's model runs in, a chip that is no target of its own inside the row", () => {
  const agents = codingAgentsControl({ agents: [listedAgent("agent-7", "Invoice export")] });
  const cards = taskCards({
    agents,
    workRows: [],
    held: NOTHING_HELD,
    chosen: () => false,
    shownCode: [],
  });
  const opened: ToolTarget[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const message = assistant([
    toolPart("message_agent", { agentId: "agent-7", text: "Rebase on main" }, ACCEPTED),
    toolPart(
      "archive_agent",
      { agentId: "agent-8" },
      {
        status: "accepted",
        agent: {
          id: "agent-8",
          title: "Retry audit",
          model: "openai/gpt-6.1-sol",
          onYourTask: false,
        },
      },
    ),
    toolPart("start_agent", { prompt: "Ship the invoice export" }),
  ]);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message,
        plan: false,
        lead: AGENT_LEAD,
        moving: true,
        delegation: {
          models: [],
          onOpenTarget: (target) => opened.push(target),
          cards: cards.call,
        },
      }),
    ),
  );
  const line = (callId: string) =>
    container.querySelector<HTMLElement>(
      `button[data-call-id="call-${callId}"], [data-call-id="call-${callId}"] summary`,
    );
  const chip = (callId: string) =>
    line(callId)?.querySelector("[data-tool-agent-ref]")?.textContent;
  const said = (callId: string) => line(callId)?.textContent?.replace(/\s+/gu, " ").trim();
  assert.equal(chip("message_agent"), "Invoice export", "a listed agent is named as its tab is");
  assert.equal(said("message_agent"), "Messaged Invoice export Rebase on main");
  assert.equal(chip("archive_agent"), "Retry audit", "an agent the plan lists not by its answer");
  assert.equal(said("archive_agent"), "Archived Retry audit");
  assert.ok(
    line("archive_agent")?.querySelector("[data-tool-agent-ref] img.harness-mark"),
    "an agent the plan lists not wears the harness its answer's model runs in, Codex's here",
  );
  assert.equal(chip("start_agent"), undefined, "a start that names no agent yet keeps its words");
  assert.equal(said("start_agent"), "Started a coding agent Ship the invoice export");
  const row = line("message_agent");
  assert.ok(row, "the message's row is drawn");
  assert.equal(row.querySelector("button, a"), null, "the chip is no target inside the row");
  act(() => row.querySelector<HTMLElement>("[data-tool-agent-ref]")?.click());
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.AGENT, agent: "agent-7" }], "it opens the row's");
});

test("a message or a start another agent was sent shows its words whole under its row at the toggle beside it, a start's note under them, the row still opening the agent; a start on the plan has no toggle", () => {
  const long = "Rebase on main.\n\nThe invoice table moved to billing.ts, so take the new path.";
  const message = assistant([
    toolPart("message_agent", { agentId: "agent-7", text: long }, ACCEPTED),
    toolPart(
      "start_agent",
      { prompt: "Ship the invoice export", note: "Keep the CSV columns." },
      { status: "accepted", agent: { id: "agent-9", onYourTask: true } },
    ),
  ]);
  // Note that a turn still moving draws its calls in the open, rather than folded under how many there were.
  const { container, opened } = drawn(message, true);
  const toggle = (callId: string) =>
    container
      .querySelector(`button[data-call-id="call-${callId}"]`)
      ?.closest(".tool-opening-row")
      ?.querySelector<HTMLButtonElement>("button[aria-pressed]");
  const words = () => container.querySelector(".tool-sent-words")?.textContent ?? null;

  assert.equal(words(), null, "the words wait behind the toggle");
  act(() => toggle("message_agent")?.click());
  assert.ok(
    words()?.includes("take the new path"),
    "the message is read whole, past its first line",
  );
  assert.deepEqual(opened, [], "the toggle opens no agent");
  act(() => toggle("start_agent")?.click());
  const start = container
    .querySelector('button[data-call-id="call-start_agent"]')
    ?.closest(".tool-opening-sent")
    ?.querySelector(".tool-sent-words")?.textContent;
  assert.ok(start?.includes("Ship the invoice export") && start.includes("Keep the CSV columns."));
  act(() =>
    container.querySelector<HTMLElement>('button[data-call-id="call-message_agent"]')?.click(),
  );
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.AGENT, agent: "agent-7" }]);

  const sentNothing = drawn(
    assistant([
      toolPart(
        "start_agent",
        {},
        { status: "accepted", agent: { id: "agent-9", onYourTask: true } },
      ),
    ]),
  );
  assert.equal(
    sentNothing.container.querySelector(".tool-opening-row"),
    null,
    "nothing was sent to show",
  );
});

/** Main's document holding one agent on no task, running on Codex, as the plan list carries it. */
function stateHoldingCodexAgent(agentId: string): AppStateSnapshot {
  const snapshot = signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" });
  return {
    ...snapshot,
    tasks: {
      ...IDLE_TASKS_VIEW,
      tasklessAgents: [
        {
          id: agentId,
          planId: null,
          turnId: null,
          title: "Retry audit",
          model: "openai/gpt-6.1-sol",
          effort: "high",
          status: CODING_AGENT_STATUS.COMPLETED,
          createdAt: 1_000,
          automationId: null,
          workspaceId: "workspace-acme",
          repository: "acme/relay",
          activityAt: 1_000,
        },
      ],
    },
  };
}

test("a call about an agent the place lists not, whose answer names no model, wears the harness the window last read the agent running on", async () => {
  const state = stateHoldingCodexAgent("agent-8");
  fakeAppBridge({
    recordSurfaceEvent: () => undefined,
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // An answer from a service before it named the agent's model.
  const message = assistant([
    toolPart(
      "archive_agent",
      { agentId: "agent-8" },
      { status: "accepted", agent: { id: "agent-8", title: "Retry audit", onYourTask: false } },
    ),
  ]);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentMessage, {
          message,
          plan: false,
          lead: AGENT_LEAD,
          moving: true,
          delegation: { models: [], onOpenTarget: () => undefined },
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const chip = container.querySelector('[data-call-id="call-archive_agent"] [data-tool-agent-ref]');

  assert.equal(chip?.textContent, "Retry audit");
  // Codex's mark is its picture.
  assert.ok(chip?.querySelector("img.harness-mark"), "the chip wears Codex's mark");
  fakeAppBridge({});
});

/** eve's `connection_execute` running Linear's `list_issues`, and the call it ran as the record keeps it, under Linear's remote name. */
const LINEAR_RUN = [
  toolPart(
    "connection_execute",
    { connection: "linear", tool: "list_issues", input: { team: "LUKE" } },
    { issues: [] },
  ),
  toolPart(
    "linear_remote",
    { remoteTool: "list_issues", parentCallId: "call-connection_execute", input: { team: "LUKE" } },
    { issues: [] },
  ),
];

test("a call of an integration's tool is one row wearing the integration's mark, saying the tool it used, and opening on the input that tool was sent", () => {
  const { container } = drawn(assistant(LINEAR_RUN), true);
  // Note that an element is never handed to assert, because a failure would print all of jsdom.
  assert.ok(
    container.querySelector('[data-call-id="call-connection_execute"]') === null,
    "the connection_execute that ran it draws no row of its own",
  );
  assert.equal(container.querySelector("[data-turn-fold] > summary")?.textContent, "1 tool called");
  const row = container.querySelector<HTMLElement>('[data-call-id="call-linear_remote"] summary');
  assert.ok(row, "the call's row is a fold's line");
  assert.match(row.textContent ?? "", /^Used\s*list_issues/u);
  assert.equal(
    row.querySelector("svg")?.outerHTML,
    renderToStaticMarkup(createElement(ProviderMark, { provider: INTEGRATION_PROVIDER.LINEAR })),
    "the row wears Linear's mark in the wrench's place",
  );
  act(() => row.click());
  const body = container.querySelector('[data-call-id="call-linear_remote"]')?.textContent ?? "";
  assert.ok(body.includes('"team": "LUKE"'), "the body holds the input list_issues was sent");
  assert.ok(!body.includes("parentCallId"), "the body holds no envelope around it");
});

test("a connection_execute with no integration's call under it keeps its own row", () => {
  const [execute] = LINEAR_RUN;
  assert.ok(execute);
  const { container } = drawn(assistant([execute]), true);
  const row = container.querySelector('[data-call-id="call-connection_execute"] summary');
  assert.match(row?.textContent ?? "", /^Used\s*connection_execute/u);
});

test("a connection_execute that failed keeps its own row beside the call it ran, so its error is read", () => {
  const [execute, remote] = LINEAR_RUN;
  assert.ok(execute && remote);
  const failed = { ...execute, state: "output-error", errorText: "Linear stopped answering." };
  const { container } = drawn(assistant([failed, remote]), true);
  const row = container.querySelector<HTMLElement>(
    '[data-call-id="call-connection_execute"] summary',
  );
  assert.ok(row, "the failed wrapper's row stands");
  act(() => row.click());
  const body = container.querySelector('[data-call-id="call-connection_execute"]')?.textContent;
  assert.ok(body?.includes("Linear stopped answering."), "its error is read under it");
  assert.ok(
    container.querySelector('[data-call-id="call-linear_remote"]') !== null,
    "the call it ran keeps its row too",
  );
});

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** A line a chat notice steered into the agent's turn, telling of message 43 from @agent-2. */
const NOTICE: CodingAgentMessage = {
  id: "notice",
  role: MESSAGE_ROLE.USER,
  parts: [
    { type: "text", text: "Chat: @agent-2 in #teammate-invitations asked about memberships." },
  ],
  metadata: { author: "agent", channel: "chat", chat_seq: 43, from: "agent-2" },
};

/** The notice drawn in an agent's transcript, beside the fixture's chat or none, with Chat offered or not, every place it opens recorded. */
function noticeDrawn(withChat: boolean, chatOn = true) {
  const opened: ChatPlace[] = [];
  const read = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(read);
  const chat = withChat
    ? {
        chat: read.answer,
        names: chatNames([], read.agents, undefined),
        onOpen: (place: ChatPlace) => opened.push(place),
      }
    : undefined;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentMessage, {
          message: NOTICE,
          plan: false,
          lead: AGENT_LEAD,
          moving: false,
          delegation: { models: [], chat, chatOn },
        }),
      ),
    ),
  );
  return { container, opened };
}

/** The fixture's chat, and the channel a message of it was posted in. */
function channelOf(seq: number): string | undefined {
  const chat = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(chat);
  return chat.answer.messages.find((message) => message.seq === seq)?.channelId;
}

test("a line a chat notice wrote draws as a card from its sender, naming the channel and the message's place, its words the message's own, and Open in Chat opens the channel", () => {
  const { container, opened } = noticeDrawn(true);
  const card = container.querySelector<HTMLElement>("[data-chat-notice]");
  assert.ok(card, "the notice draws as a card");
  assert.equal(card.dataset.messageId, "notice", "a link to the line finds its card");
  assert.equal(container.querySelector(".is-user"), null);
  assert.equal(card.querySelector(".chat-notice-from")?.textContent, "@agent-2");
  assert.match(
    card.querySelector(".chat-notice-place")?.textContent ?? "",
    /^in #teammate-invitations · m 43 · /u,
  );
  assert.match(
    card.querySelector(".chat-notice-words")?.textContent ?? "",
    /^@agent-1 are you changing memberships columns\?/u,
  );
  const open = [...card.querySelectorAll("button")].find(
    (each) => each.textContent === "Open in Chat",
  );
  act(() => open?.click());
  assert.deepEqual(opened, [{ kind: CHAT_PLACE.CHANNEL, channelId: channelOf(43) }]);
});

test("where the window holds no chat, a notice's card says its sender and place from the notice alone, its own words under them, with nothing to open", () => {
  const { container } = noticeDrawn(false);
  const card = container.querySelector<HTMLElement>("[data-chat-notice]");
  assert.equal(card?.querySelector(".chat-notice-from")?.textContent, "@agent-2");
  assert.equal(card?.querySelector(".chat-notice-place")?.textContent, "m 43");
  assert.equal(
    card?.querySelector(".chat-notice-words")?.textContent?.trim(),
    "Chat: @agent-2 in #teammate-invitations asked about memberships.",
  );
  assert.equal(
    [...(card?.querySelectorAll("button") ?? [])].some(
      (each) => each.textContent === "Open in Chat",
    ),
    false,
  );
});

test("with Chat off, a line a chat notice wrote is drawn as the plain line it is, with no card and nothing to open", () => {
  const { container } = noticeDrawn(true, false);
  assert.equal(container.querySelector("[data-chat-notice]"), null);
  assert.match(container.textContent ?? "", /Chat: @agent-2 in #teammate-invitations asked/u);
});

test("a notice of a message holding no Markdown, a link alone, keeps the notice's own words under its head", () => {
  const read = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(read);
  const answer = {
    ...read.answer,
    messages: read.answer.messages.map((message) =>
      message.seq === 43
        ? {
            ...message,
            blocks: [
              {
                type: "link" as const,
                url: "https://github.com/acme/relay/pull/214",
                label: "#214",
              },
            ],
          }
        : message,
    ),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentMessage, {
          message: NOTICE,
          plan: false,
          lead: AGENT_LEAD,
          moving: false,
          delegation: {
            models: [],
            chatOn: true,
            chat: {
              chat: answer,
              names: chatNames([], read.agents, undefined),
              onOpen: () => undefined,
            },
          },
        }),
      ),
    ),
  );
  assert.equal(
    container.querySelector(".chat-notice-words")?.textContent?.trim(),
    "Chat: @agent-2 in #teammate-invitations asked about memberships.",
  );
});

/** A chat call's row drawn with Chat offered or not, every place it opens recorded. */
function chatCallDrawn(chatOn: boolean) {
  const opened: ToolTarget[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message: assistant([toolPart("post_chat", { text: "Rebased." }, ACCEPTED)]),
        plan: false,
        lead: AGENT_LEAD,
        moving: false,
        delegation: { models: [], chatOn, onOpenTarget: (target) => opened.push(target) },
      }),
    ),
  );
  return { container, opened };
}

test("a chat call's row opens the task's Chat while Chat is offered, and folds open as any call's does while it is off", () => {
  const on = chatCallDrawn(true);
  const row = on.container.querySelector<HTMLButtonElement>(
    'button[data-call-id="call-post_chat"]',
  );
  assert.ok(row, "the row is a button");
  act(() => row.click());
  assert.deepEqual(on.opened, [{ kind: TOOL_TARGET.CHAT }]);

  const off = chatCallDrawn(false);
  assert.equal(off.container.querySelector('button[data-call-id="call-post_chat"]'), null);
  assert.ok(off.container.querySelector("details"), "the row folds its call open in place");
});
