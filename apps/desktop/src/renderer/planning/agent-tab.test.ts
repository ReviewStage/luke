// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";

/**
 * agent-tab.test.ts -- a call about something the window draws in a tab of
 * its own is a row that opens that tab, and every other call a row that
 * folds open in place; a run of calls and a list of the agents each wear
 * their own icon.
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

/** The message drawn as an agent's turn is, every target its rows open recorded. */
function drawn(message: CodingAgentMessage, moving = false) {
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
        delegation: { models: [], onOpenTarget: (target) => opened.push(target) },
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

test("a run of calls wears a stack, and a list of the agents a list's icon", () => {
  const { container } = drawn(
    assistant([
      toolPart("list_coding_agents", {}, { agents: [] }),
      toolPart("run_on_mac", { command: "git status" }),
    ]),
    true,
  );
  const group = container.querySelector("[data-turn-fold] > summary svg");
  assert.ok(group?.classList.contains("lucide-layers"), "the group's line wears Layers");
  const rows = [...container.querySelectorAll("[data-turn-fold] summary")];
  const listed = rows.find((row) => row.textContent?.includes("Listed the coding agents"));
  assert.ok(
    listed?.querySelector("svg")?.classList.contains("lucide-layout-list"),
    "the list's row wears LayoutList",
  );
});
