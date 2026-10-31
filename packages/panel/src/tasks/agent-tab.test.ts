// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
  agentMessageReplyLine,
} from "@luke/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { PlanMention } from "@luke/features/mention-link";
import { pageFrameUrl } from "@luke/features/page-frame";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { ProviderMark } from "@luke/ui";
import { ACTOR_KIND, type Actor, SOMEONE_REASON } from "@luke/ui/actor-model";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { taskCards } from "../desktop/side-panel.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { signedInAs } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { focusRestOn, restOn } from "../testing/hint-rest.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { agentsControl } from "../testing/tasks-control.js";
import { NOTHING_HELD } from "./agent-ref.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { ChipCards } from "./chip-cards.js";
import { TranscriptAgent } from "./line-cards.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";

/**
 * agent-tab.test.ts -- a call about an agent is a row that opens the
 * agent's tab, a call that made a page, a thread, a task, or a pull request
 * a row that folds open in place naming it by its chip, and every other
 * call a row that folds open in place; a run of calls and a finished turn's lead fold under
 * a line saying whether it is open. A row that opens an agent's or a
 * worker's tab hangs that tab's card. A call of an integration's own tool is one row
 * wearing the integration's mark, with the `connection_execute` that ran it
 * left out.
 */

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

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

function assistant(parts: readonly WireRecord[]): AgentTranscriptMessage {
  return { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts };
}

/** The message drawn as an agent's turn is, every target its rows open recorded, in the transcript of `page`'s agent on its task's page where one is given. */
function drawn(message: AgentTranscriptMessage, moving = false, page?: TaskMentionsValue) {
  const opened: ToolTarget[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const turn = createElement(AgentMessage, {
    message,
    plan: false,
    lead: AGENT_LEAD,
    moving,
    delegation: { models: [], onOpenTarget: (target) => opened.push(target) },
  });
  act(() =>
    root.render(
      page === undefined
        ? turn
        : onRegistry(
            AtomRegistry.make(),
            createElement(TaskMentions, {
              value: page,
              children: createElement(TranscriptAgent, { value: TASK_AGENT, children: turn }),
            }),
          ),
    ),
  );
  return { container, opened };
}

const ACCEPTED = { status: "accepted" };

/** A call that opens something: an agent's, whose row is one button that opens its tab, or what the call made, whose row folds as any call's and names it, after `verb`, by the chip `made` labels, whose press `opens` the link it leaves by, or the task it opens in place. */
const OPENING_CALLS: readonly {
  readonly name: string;
  readonly tool: string;
  readonly input: WireRecord;
  readonly output?: WireRecord;
  readonly target: ToolTarget;
  readonly verb?: string;
  readonly made?: string;
  readonly opens?: string;
}[] = [
  {
    name: "a page shown, named by its title until the window holds its name",
    tool: "show_page",
    input: { title: "Pricing explorer", path: "pricing.html" },
    output: { status: "accepted", page: { id: "page-1", version: 2 } },
    target: { kind: TOOL_TARGET.PAGE, page: "page-1" },
    verb: "Showed",
    made: "Pricing explorer",
    opens: "https://tryluke.dev/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b/page/page-1",
  },
  {
    name: "a read of an agent opens its tab",
    tool: "read_coding_agent",
    input: { agentId: "agent-7" },
    output: { status: "running" },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-7" },
  },
  {
    name: "a start on the plan, which sent no words of its own, opens the agent it began",
    tool: "start_coding_agent",
    input: {},
    output: { status: "accepted", agent: { id: "agent-9" } },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-9" },
  },
  {
    name: "a plan edit, named by the plan's chip, called Plan until the window holds its name, and no count",
    tool: "edit_plan",
    input: { notes: [{ kind: "add", section: "Goal", text: "Export invoices" }] },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.PLAN },
    verb: "Updated",
    made: "Plan",
    opens: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b",
  },
  {
    name: "a thread resolved on another task, named by that task's chip, called Plan until the window holds its name",
    tool: "resolve_thread",
    input: { taskId: "5d1e2f3a-4b5c-4d6e-8f70-000000000002", thread: "thread-1" },
    output: { status: "accepted", thread: "thread-1" },
    target: { kind: TOOL_TARGET.TASK, task: "5d1e2f3a-4b5c-4d6e-8f70-000000000002" },
    verb: "Resolved a thread on",
    made: "Plan",
    opens: "5d1e2f3a-4b5c-4d6e-8f70-000000000002",
  },
  {
    name: "a post on a thread, named by the thread's title",
    tool: "post_thread",
    input: { key: "currency", title: "Which currency?", body: "Euros or dollars?" },
    output: { inbox: [{ id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", key: "currency" }] },
    target: { kind: TOOL_TARGET.INBOX, key: "currency" },
    verb: "Posted",
    made: "Which currency?",
    opens:
      "https://tryluke.dev/acme/agent/8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21/inbox/9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  },
  {
    name: "a pull request opened, named by its number",
    tool: "open_pull_request",
    input: { head: "feat/invoices", title: "Export invoices", body: "" },
    output: { url: "https://github.com/acme/relay/pull/214", number: 214 },
    target: { kind: TOOL_TARGET.PULL_REQUEST, url: "https://github.com/acme/relay/pull/214" },
    verb: "Opened",
    made: "#214",
    opens: "https://github.com/acme/relay/pull/214",
  },
];

for (const call of OPENING_CALLS) {
  if (call.made === undefined) {
    test(`${call.name}: its row is one button that opens it`, () => {
      const { container, opened } = drawn(
        assistant([toolPart(call.tool, call.input, call.output)]),
      );
      const row = container.querySelector<HTMLButtonElement>(
        `button[data-call-id="call-${call.tool}"]`,
      );
      assert.ok(row, "the row is a button");
      assert.equal(container.querySelector("details"), null, "the row folds nothing open in place");
      act(() => row.click());
      assert.deepEqual(opened, [call.target]);
    });
    continue;
  }
  test(`${call.name}: its row folds as any call's, its verb alone before the chip, whose press folds nothing`, () => {
    fakeAppBridge({});
    const left: string[] = [];
    fakeAppPlatform({
      ...QUIET_PANEL,
      openWeb: (url) => left.push(url),
      openGitHub: (url) => left.push(url),
    });
    const page = {
      ...TASK_PAGE,
      doors: { ...TASK_PAGE.doors, onOpenTask: (plan: PlanMention) => left.push(plan.taskId) },
    };
    const { container } = drawn(
      assistant([toolPart(call.tool, call.input, call.output)]),
      false,
      page,
    );
    const row = container.querySelector<HTMLElement>(`[data-call-id="call-${call.tool}"] summary`);
    assert.ok(row, "the row is a fold's line");
    const chip = row.querySelector<HTMLElement>("[data-mention-ref]");
    assert.equal(chip?.querySelector(".luke-inline-ref-label")?.textContent, call.made);
    assert.equal(row.querySelector(".tool-label")?.textContent?.trim(), call.verb);
    act(() => chip?.click());
    assert.deepEqual(left, [call.opens], "the chip's press opens what it names");
    assert.equal(row.getAttribute("aria-expanded"), "false", "the chip's press folds nothing");
    act(() => row.click());
    assert.equal(row.getAttribute("aria-expanded"), "true", "the row's press folds it open");
  });
}

test("a call's row opened while it runs stays open as its answer lands and names what it made", () => {
  fakeAppBridge({});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const input = { title: "Pricing explorer", path: "pricing.html" };
  const draw = (part: WireRecord) =>
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          createElement(TaskMentions, {
            value: TASK_PAGE,
            children: createElement(AgentMessage, {
              message: assistant([part]),
              plan: false,
              lead: AGENT_LEAD,
              moving: true,
              delegation: { models: [], onOpenTarget: () => undefined },
            }),
          }),
        ),
      ),
    );
  draw(toolPart("show_page", input));
  const row = () =>
    container.querySelector<HTMLElement>('[data-call-id="call-show_page"] summary') ??
    assert.fail("the row is a fold's line");
  act(() => row().click());
  draw(toolPart("show_page", input, { status: "accepted", page: { id: "page-1", version: 1 } }));
  assert.ok(row().querySelector("[data-mention-ref]"), "the row names the page by its chip");
  assert.equal(row().getAttribute("aria-expanded"), "true", "the row stands open");
});

const SENT_CALLS: readonly {
  readonly name: string;
  readonly tool: string;
  readonly input: WireRecord;
  readonly output: WireRecord;
  readonly target: ToolTarget;
}[] = [
  {
    name: "a message to an agent",
    tool: "message_coding_agent",
    input: { agentId: "agent-7", text: "Rebase on main" },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-7" },
  },
  {
    name: "a start of an agent",
    tool: "start_coding_agent",
    input: { task: "Ship the invoice export" },
    output: { status: "accepted", agent: { id: "agent-9" } },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-9" },
  },
];

for (const call of SENT_CALLS) {
  test(`${call.name}: its row folds what was sent open, and its chip, named as an agent where the place knows no name, opens the agent`, () => {
    const { container, opened } = drawn(assistant([toolPart(call.tool, call.input, call.output)]));
    const row = container.querySelector<HTMLElement>(`[data-call-id="call-${call.tool}"] summary`);
    assert.ok(row, "the row is a fold's line");
    const chip = row.querySelector<HTMLButtonElement>("button[data-tool-agent-ref]");
    assert.equal(chip?.textContent, "Agent");
    assert.equal(container.querySelector("[data-opens]"), null, "no row is a button that opens");
    act(() => chip?.click());
    assert.deepEqual(opened, [call.target], "the chip opens the agent");
    assert.equal(container.querySelector(".tool-sent-words"), null, "and folds nothing open");
    act(() => row.click());
    assert.ok(container.querySelector(".tool-sent-words"), "the row folds the words open");
    assert.deepEqual(opened, [call.target], "and opens no agent");
  });
}

const FOLDING_CALLS: readonly {
  readonly name: string;
  readonly part: WireRecord;
}[] = [
  {
    name: "a read of the inbox, which made nothing to name",
    part: toolPart("read_inbox", {}, { items: [] }),
  },
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
    name: "a page its tool refused",
    part: toolPart(
      "show_page",
      { title: "Pricing explorer", path: "pricing.html" },
      { status: "rejected", reason: "Not shown: no such file in your sandbox." },
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
  assert.equal(group?.textContent, "2 tool calls");
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

/** An agent of the task's, as its list holds it. */
function listedAgent(id: string, title: string, overrides: Partial<AgentSummary> = {}) {
  return {
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: AGENT_STATUS.RUNNING,
    turnId: null,
    ...overrides,
  } satisfies AgentSummary;
}

/** The card standing in the window once `row` is reached from the keyboard: its name, then its corner. */
function cardOn(row: HTMLElement | null): readonly (string | boolean | null | undefined)[] {
  assert.ok(row, "the row is drawn");
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(row);
  const card = document.querySelector(".luke-tooltip-card [data-agent-card]");
  assert.ok(card, "the row hangs its agent's card");
  return [
    card.querySelector(".luke-hover-card-name")?.textContent,
    card.querySelector(".luke-hover-card-corner")?.textContent,
    card.querySelector('.luke-hover-card-lead .state-glyph[data-state="working"]') !== null,
  ];
}

test("in an agent's transcript, a call about an agent hangs that agent's tab's card, archived or not found as well, and a delegation's row its worker's", () => {
  const agents = agentsControl({
    agents: [listedAgent("agent-7", "Invoice export")],
    archived: [
      listedAgent("agent-8", "Retry audit", {
        status: AGENT_STATUS.CANCELLED,
        archivedAt: 2,
      }),
    ],
  });
  const cards = taskCards({
    agents,
    held: NOTHING_HELD,
    chosen: () => false,
    pages: undefined,
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
  // A call that sent words hangs the card from its chip, the row's way to the agent.
  const chip = (callId: string) =>
    container.querySelector<HTMLElement>(`[data-call-id="call-${callId}"] [data-tool-agent-ref]`);
  // The calls run together fold under one line, which a press opens.
  const fold = container.querySelector<HTMLElement>("[data-turn-fold] > summary");
  act(() => fold?.click());
  // Note that a working agent's corner says no word: its tile's working mark says it.
  assert.deepEqual(cardOn(chip("message_coding_agent")), ["Invoice export", undefined, true]);
  const [archived, corner] = cardOn(row("read_coding_agent"));
  assert.equal(archived, "Retry audit");
  assert.match(String(corner), /^Archived · /u);
  assert.deepEqual(cardOn(chip("start_coding_agent")), ["Agent", "Not found", false]);
  assert.deepEqual(cardOn(row("delegate")), ["Audit the retry paths", undefined, true]);
});

test("in an agent's transcript, a call that folds open in place still hangs its agent's tab's card from the agent's chip", () => {
  const cards = taskCards({
    agents: agentsControl({ agents: [listedAgent("agent-7", "Invoice export")] }),
    held: NOTHING_HELD,
    chosen: () => false,
    pages: undefined,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const message = assistant([
    toolPart(
      "message_coding_agent",
      { agentId: "agent-7", text: "Rebase on main" },
      { status: "rejected", reason: "The agent has ended." },
    ),
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
  // A call run alone is folded under its own line, which a press opens.
  act(() => container.querySelector<HTMLElement>("[data-turn-fold] > summary")?.click());
  const chip = container.querySelector<HTMLElement>(
    '[data-call-id="call-message_coding_agent"] summary [data-tool-agent-ref]',
  );

  // Note that the chip is words, not a control, so the pointer is how it is reached.
  restOn(chip ?? assert.fail("the call's agent chip"));
  const card = document.querySelector(".luke-tooltip-card [data-agent-card]");

  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Invoice export");
});

test("a call about an agent names it by its chip in the place of the words, as its tab names it or its answer does, wearing the harness its answer's model runs in, a chip that opens the agent on a row that folds what was sent and is no target of its own on a row that opens it", () => {
  const agents = agentsControl({ agents: [listedAgent("agent-7", "Invoice export")] });
  const cards = taskCards({
    agents,
    held: NOTHING_HELD,
    chosen: () => false,
    pages: undefined,
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
    line("archive_agent")?.querySelector(
      "[data-tool-agent-ref] .luke-harness-mark[data-provider='openai']",
    ),
    "an agent the plan lists not wears the harness its answer's model runs in, Codex's here",
  );
  assert.equal(chip("start_agent"), undefined, "a start that names no agent yet keeps its words");
  assert.equal(said("start_agent"), "Started an agent Ship the invoice export");
  const row = line("message_agent");
  assert.ok(row, "the message's row is drawn");
  act(() => row.querySelector<HTMLElement>("button[data-tool-agent-ref]")?.click());
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.AGENT, agent: "agent-7" }], "its chip opens it");
  assert.equal(container.querySelector(".tool-sent-words"), null, "and folds nothing open");
  const archive = line("archive_agent");
  assert.ok(archive, "the archive's row is drawn");
  assert.equal(archive.querySelector("button, a"), null, "the chip is no target inside the row");
  act(() => archive.querySelector<HTMLElement>("[data-tool-agent-ref]")?.click());
  assert.deepEqual(
    opened,
    [{ kind: TOOL_TARGET.AGENT, agent: "agent-7" }],
    "a press on it is the row's, which folds an agent off the task open rather than opening it",
  );
});

test("a message or a start another agent was sent shows its words whole under its row once the row is pressed, a start's note under them, with no toggle at the row's end; a start on the plan folds nothing", () => {
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
  const row = (callId: string) =>
    container.querySelector<HTMLElement>(`[data-call-id="call-${callId}"] summary`);
  const words = (callId: string) =>
    container.querySelector(`[data-call-id="call-${callId}"] .tool-sent-words`)?.textContent ??
    null;

  assert.equal(words("message_agent"), null, "the words wait behind the row");
  assert.equal(
    row("message_agent")?.parentElement?.querySelector("button[aria-pressed]"),
    null,
    "the row wears no toggle",
  );
  act(() => row("message_agent")?.click());
  assert.ok(
    words("message_agent")?.includes("take the new path"),
    "the message is read whole, past its first line",
  );
  assert.equal(
    row("message_agent")?.textContent?.includes("Rebase on main"),
    false,
    "the line's preview gives way to the words",
  );
  act(() => row("start_agent")?.click());
  const start = words("start_agent");
  assert.ok(start?.includes("Ship the invoice export") && start.includes("Keep the CSV columns."));
  assert.deepEqual(opened, [], "the row opens no agent");

  const sentNothing = drawn(
    assistant([
      toolPart(
        "start_agent",
        {},
        { status: "accepted", agent: { id: "agent-9", onYourTask: true } },
      ),
    ]),
  );
  assert.equal(sentNothing.container.querySelector("details"), null, "nothing was sent to show");
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
          status: AGENT_STATUS.COMPLETED,
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
  assert.ok(
    chip?.querySelector(".luke-harness-mark[data-provider='openai']"),
    "the chip wears Codex's mark",
  );
  fakeAppBridge({});
});

/** The page of the task `taskId` in the workspace `acme`, whose transcript links what its calls made. */
function onTask(taskId: string): TaskMentionsValue {
  return {
    ...TASK_PAGE,
    holder: { taskId },
    doors: { ...TASK_PAGE.doors, holder: { taskId } },
  };
}

/** The chip a call's row names what the call made by. */
function madeChip(container: HTMLElement, callId: string): HTMLElement {
  return (
    container.querySelector<HTMLElement>(
      `[data-call-id="call-${callId}"] summary [data-mention-ref]`,
    ) ?? assert.fail("the call's row names what it made by its chip")
  );
}

test("a call that showed or read a page hangs the page's card as its tab does, previewing it, and one the window holds not yet its name as the row says it", async () => {
  const taskId = "task-pricing";
  const snapshot = signedInAs({ id: "user-sam", email: "sam@example.com", name: "Sam Okafor" });
  const state: AppStateSnapshot = {
    ...snapshot,
    tasks: {
      ...IDLE_TASKS_VIEW,
      activeTaskId: taskId,
      pages: [{ id: "page-1", title: "Pricing explorer", version: 2, at: 1_000 }],
    },
  };
  fakeAppBridge({
    recordSurfaceEvent: () => undefined,
    onAppState: () => () => undefined,
    requestAppState: () => Promise.resolve(state),
  });
  fakeAppPlatform({ ...QUIET_PANEL, pageFrameUrl });
  const cards = taskCards({
    agents: agentsControl({}),
    held: NOTHING_HELD,
    chosen: () => false,
    pages: { taskId },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const message = assistant([
    toolPart(
      "show_page",
      { title: "Pricing explorer", path: "pricing.html" },
      { status: "accepted", page: { id: "page-1", version: 2 } },
    ),
    toolPart(
      "read_page",
      { pageId: "page-2" },
      { status: "accepted", page: { id: "page-2", title: "Old pricing", isYourTask: true } },
    ),
  ]);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskMentions, {
          value: onTask(taskId),
          children: createElement(AgentMessage, {
            message,
            plan: false,
            lead: AGENT_LEAD,
            moving: true,
            delegation: { models: [], onOpenTarget: () => undefined, cards: cards.call },
          }),
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  const cardOf = (callId: string) => {
    const chip = madeChip(container, callId);
    document.documentElement.dataset.keyboard = "true";
    focusRestOn(chip);
    const card = [...document.querySelectorAll(".luke-tooltip-card [data-page-card]")].at(-1);
    return {
      name: card?.querySelector(".luke-hover-card-name")?.textContent,
      sub: card?.querySelector(".luke-hover-card-sub")?.textContent,
      preview: card?.querySelector(".luke-page-thumb-frame")?.getAttribute("src"),
    };
  };

  assert.deepEqual(cardOf("show_page"), {
    name: "Pricing explorer",
    sub: "Version 2",
    preview: pageFrameUrl({ taskId, pageId: "page-1", version: 2 }),
  });
  assert.deepEqual(cardOf("read_page"), {
    name: "Old pricing",
    sub: undefined,
    preview: undefined,
  });
  fakeAppBridge({});
});

test("a call about the plan or another task hangs that task's card as its Plan tab and sidebar row do, and a task the window lists not its name as the row says it", () => {
  const cards = taskCards({
    agents: agentsControl({}),
    held: NOTHING_HELD,
    chosen: () => false,
    pages: { taskId: "task-invoices" },
    task: { name: "Invoice export", status: undefined, card: undefined },
  });
  // The window lists the plan and one other task, whose cards its sidebar rows hang.
  const listed = new Map([
    ["task-invoices", "Invoice export"],
    ["task-retries", "Retry audit"],
  ]);
  const taskCard = (taskId: string) => {
    const name = listed.get(taskId);
    return name === undefined
      ? undefined
      : createElement("div", { "data-task-card": taskId }, createElement("b", null, name));
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const message = assistant([
    toolPart("edit_plan", { notes: [] }, ACCEPTED),
    toolPart(
      "read_task",
      { taskId: "task-retries" },
      { status: "accepted", task: { id: "task-retries", name: "Retry audit" } },
    ),
    toolPart(
      "create_task",
      { name: "Billing cleanup" },
      { status: "accepted", task: { id: "task-billing", name: "Billing cleanup" } },
    ),
  ]);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TaskMentions, {
          value: onTask("task-invoices"),
          children: createElement(ChipCards, {
            value: { taskCard },
            children: createElement(AgentMessage, {
              message,
              plan: false,
              lead: AGENT_LEAD,
              moving: false,
              delegation: { models: [], onOpenTarget: () => undefined, cards: cards.call },
            }),
          }),
        }),
      ),
    ),
  );
  const fold = container.querySelector<HTMLElement>("[data-turn-fold] > summary");
  act(() => fold?.click());
  const cardOf = (callId: string) => {
    const chip = madeChip(container, callId);
    document.documentElement.dataset.keyboard = "true";
    focusRestOn(chip);
    const card = [...document.querySelectorAll(".luke-tooltip-card > *")].at(-1);
    return {
      task: card?.getAttribute("data-task-card") ?? undefined,
      name: card?.querySelector("b, .luke-hover-card-name")?.textContent,
    };
  };

  assert.deepEqual(cardOf("edit_plan"), { task: "task-invoices", name: "Invoice export" });
  assert.deepEqual(cardOf("read_task"), { task: "task-retries", name: "Retry audit" });
  assert.deepEqual(cardOf("create_task"), { task: "", name: "Billing cleanup" });
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
  assert.equal(container.querySelector("[data-turn-fold] > summary")?.textContent, "1 tool call");
  const row = container.querySelector<HTMLElement>('[data-call-id="call-linear_remote"] summary');
  assert.ok(row, "the call's row is a fold's line");
  assert.match(row.textContent ?? "", /^Ran\s*list_issues\s*Linear$/u);
  assert.equal(
    row.querySelector("svg")?.outerHTML,
    renderToStaticMarkup(createElement(ProviderMark, { provider: INTEGRATION_PROVIDER.LINEAR })),
    "the row wears Linear's mark in the wrench's place",
  );
  act(() => row.click());
  const body = container.querySelector('[data-call-id="call-linear_remote"]')?.textContent ?? "";
  assert.ok(body.includes("LUKE"), "the body holds the input list_issues was sent");
  assert.ok(!body.includes("parentCallId"), "the body holds no envelope around it");
});

test("a connection_execute with no integration's call under it keeps its own row", () => {
  const [execute] = LINEAR_RUN;
  assert.ok(execute);
  const { container } = drawn(assistant([execute]), true);
  const row = container.querySelector('[data-call-id="call-connection_execute"] summary');
  // Note that it names the tool and the connection its own input names.
  assert.match(row?.textContent ?? "", /^Ran\s*list_issues\s*Linear$/u);
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
  const output = container.querySelector(
    '[data-call-id="call-connection_execute"] [data-tool-output]',
  );
  assert.equal(output?.textContent, "Linear stopped answering.", "as the call's output");
  assert.equal(
    output?.querySelector('[role="alert"]'),
    null,
    "and is no alert, since a transcript's history is not announced again as it scrolls into view",
  );
  assert.ok(
    container.querySelector('[data-call-id="call-linear_remote"]') !== null,
    "the call it ran keeps its row too",
  );
});

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

/** A message another agent sent with `message_agent`, steered into the agent's turn as `agent-message.ts` writes it. */
const AGENT_MESSAGE: AgentTranscriptMessage = {
  id: "message",
  role: MESSAGE_ROLE.USER,
  parts: [
    {
      type: "text",
      text: [
        "Message · [@Invite emails](https://tryluke.dev/acme/agent/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f) to you:",
        "Rebase before you push.",
        agentMessageReplyLine("7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"),
      ].join("\n\n"),
    },
  ],
  metadata: { channel: "agent_message" },
  sentBy: { name: "Invite emails", agent: true },
};

/** The message drawn in an agent's transcript, on the task's page where one is given. */
function agentMessageDrawn(
  message: AgentTranscriptMessage,
  page?: TaskMentionsValue,
  agentId?: string,
  sender?: Actor,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const drawn = createElement(TranscriptAgent, {
    value: agentId,
    children: createElement(AgentMessage, {
      message,
      plan: false,
      lead: AGENT_LEAD,
      moving: false,
      delegation: { models: [] },
      sender,
    }),
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        page === undefined ? drawn : createElement(TaskMentions, { value: page, children: drawn }),
      ),
    ),
  );
  return container;
}

test("a message another agent sent draws as its sender's bubble at the left, named by that agent's own chip, its words alone without who sent it or how to answer", () => {
  const container = agentMessageDrawn({
    ...AGENT_MESSAGE,
    sentBy: {
      name: "Invite expiry",
      agent: true,
      agentId: "agent-2",
      model: "anthropic/claude-opus-5.5",
    },
  });
  const bubble = container.querySelector<HTMLElement>("[data-agent-message]");
  assert.ok(bubble, "the message draws as its sender's bubble");
  assert.equal(bubble.dataset.messageId, "message", "a link to the line finds its bubble");
  assert.match(
    bubble.querySelector(".luke-message-head-sender")?.textContent ?? "",
    /Invite expiry/u,
  );
  assert.equal(
    bubble.querySelector(".message-content")?.textContent?.trim(),
    "Rebase before you push.",
  );
});

test("a message from an agent the line keeps no chip of is named by the name its row keeps", () => {
  const bubble = agentMessageDrawn(AGENT_MESSAGE).querySelector("[data-agent-message]");
  assert.match(
    bubble?.querySelector(".luke-message-head-sender")?.textContent ?? "",
    /Invite emails/u,
  );
});

/** The agent whose transcript a task's page draws. */
const TASK_AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

/** A task's page in the workspace `acme`, whose agent's transcript draws a thread's chip. */
const TASK_PAGE: TaskMentionsValue = {
  holder: { taskId: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b" },
  taskName: "Invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => "",
  doors: {
    holder: { taskId: "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b" },
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(),
    onOpenTask: () => undefined,
    onOpenFile: undefined,
  },
};

test("a teammate's message on a thread is headed by who sent it, what they did and the thread's chip named by the thread's title, its words without the header that names the item to the agent, whatever its title spells", () => {
  fakeAppBridge({});
  const container = agentMessageDrawn(
    {
      id: "thread-line",
      role: MESSAGE_ROLE.USER,
      parts: [
        {
          type: "text",
          text: 'Thread message on "Ship " (key fake): the invites?" (key ship-invites):\n\nWhich PRs first?',
        },
      ],
      metadata: {
        channel: "thread",
        event: "message",
        item_id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      },
    },
    TASK_PAGE,
    TASK_AGENT,
    { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED, name: "Ada Lovelace" },
  );
  const head = container.querySelector<HTMLElement>("[data-thread-line]");
  assert.match(head?.textContent ?? "", /^Thread message/u);
  assert.equal(
    head?.querySelector("[data-mention-ref] .luke-inline-ref-label")?.textContent,
    'Ship " (key fake): the invites?',
    "the head wears the thread's chip, named by its title before the item is read",
  );
  assert.match(
    container.querySelector("[data-message-id]")?.textContent ?? "",
    /^Ada Lovelace\s*Thread message.*Which PRs first\?/u,
    "who sent it heads the line, over its words",
  );
  assert.equal(
    container.querySelector(".message-content")?.textContent?.trim(),
    "Which PRs first?",
  );
});

/** The head that folds a GitHub card, by which a reader names it: who did what to which pull request. */
function cardHead(card: HTMLElement): HTMLElement {
  return card.querySelector<HTMLElement>("summary") ?? assert.fail("The card has no head");
}

/** A GitHub line the agent was told, as the service steers one in. */
function githubLine(
  id: string,
  text: string,
  metadata: Record<string, unknown>,
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    metadata: {
      channel: "github",
      repository: "acme/relay",
      number: 42,
      url: "https://github.com/acme/relay/commit/c0ffee/checks",
      by: "github-actions[bot]",
      ...metadata,
    },
    sentBy: { kind: "github", name: "github-actions[bot]" },
  };
}

test("a review from GitHub draws as a folding card, closed, headed by who did what to the pull request and how many comments it holds, holding their words and each inline comment by its file and line, without the agent's instructions", () => {
  const container = agentMessageDrawn({
    id: "github-line",
    role: MESSAGE_ROLE.USER,
    parts: [
      {
        type: "text",
        text: "@octocat requested changes on your pull request #42.\n\n<github-review>\nClose.\n</github-review>\n\nAct on it as you judge best.",
      },
    ],
    metadata: {
      channel: "github",
      event: "review",
      repository: "acme/relay",
      number: 42,
      url: "https://github.com/acme/relay/pull/42#pullrequestreview-1",
      by: "octocat",
      verdict: "changes_requested",
      words: "Close, but the store reads the list **twice**.",
      comments: [
        {
          path: "apps/web/store.ts",
          line: 12,
          url: "https://github.com/acme/relay/pull/42#discussion_r1",
          body: "Guard the empty list here.",
        },
      ],
    },
    sentBy: { kind: "github", name: "octocat" },
  });
  const card = container.querySelector<HTMLElement>("[data-github-line]");
  assert.ok(card, "the line draws as GitHub's card");
  const head = cardHead(card);
  assert.equal(head.getAttribute("aria-label"), "octocat requested changes on #42, 1 comment");
  assert.equal(head.getAttribute("aria-expanded"), "false");
  act(() => head.click());
  const body = card.textContent ?? "";
  assert.match(body, /Close, but the store reads the list twice\./u);
  assert.match(body, /apps\/web\/store\.ts L12\s*Guard the empty list here\./u);
  assert.doesNotMatch(container.textContent ?? "", /Act on it|github-review/u);
});

test("a check line is headed by how many of its checks failed on the pull request, and holds the Pull request tab's rows of them, those that failed first, each saying how it ended", () => {
  const container = agentMessageDrawn(
    githubLine("checks-failed", "Every check finished on `c0ffee`.\n\nAt least one failed.", {
      event: "checks_completed",
      sha: "c0ffee",
      failing: true,
      checks: [
        { name: "lint", conclusion: "success" },
        { name: "test (webkit)", conclusion: "failure" },
        {
          name: "e2e",
          conclusion: "timed_out",
          url: "https://github.com/acme/relay/actions/runs/3",
        },
      ],
    }),
  );
  const card = container.querySelector<HTMLElement>("[data-github-line]");
  assert.ok(card, "the line draws as GitHub's card");
  assert.equal(
    cardHead(card).getAttribute("aria-label"),
    "github-actions[bot] 2 of 3 checks failed on #42",
  );
  act(() => cardHead(card).click());
  const rows = [...card.querySelectorAll("li")].map((row) => row.textContent ?? "");
  assert.deepEqual(
    rows.map((row) => /^(.*?),/u.exec(row)?.[1]),
    ["test (webkit)", "e2e", "lint"],
  );
  assert.match(rows[1] ?? "", /Timed out/u);
});

test("a check line whose checks were skipped rather than passed says so, and holds their rows", () => {
  const container = agentMessageDrawn(
    githubLine("checks-skipped", "Every check finished on `c0ffee`.\n\nNone failed.", {
      event: "checks_completed",
      failing: false,
      checks: [{ name: "deploy", conclusion: "skipped" }],
    }),
  );
  const card = container.querySelector<HTMLElement>("[data-github-line]");
  assert.ok(card, "the line draws as GitHub's card");
  const head = cardHead(card);
  assert.equal(head.getAttribute("aria-label"), "github-actions[bot] 1 check skipped on #42");
  act(() => head.click());
  assert.match(card.textContent ?? "", /deploy.*Skipped/u);
});

test.each([
  {
    held: "an approval with no words",
    line: githubLine("approved", "@octocat approved your pull request #42.", {
      event: "review",
      url: "https://github.com/acme/relay/pull/42#pullrequestreview-2",
      by: "octocat",
      verdict: "approved",
    }),
    head: "octocat approved #42",
  },
  {
    held: "every check passing",
    line: githubLine("checks-passed", "Every check finished on `c0ffee`.", {
      event: "checks_completed",
      failing: false,
      checks: [{ name: "lint", conclusion: "success" }],
    }),
    head: "github-actions[bot] 1 check passed on #42",
  },
])("$held draws its card's head alone, with nothing to open", ({ line, head }) => {
  const card = agentMessageDrawn(line).querySelector<HTMLElement>("[data-github-line]");
  assert.ok(card, "the line draws as GitHub's card");
  const summary = cardHead(card);
  assert.equal(summary.getAttribute("aria-label"), head);
  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "false", "a press opens nothing");
  assert.equal(card.textContent?.trim(), "");
});
