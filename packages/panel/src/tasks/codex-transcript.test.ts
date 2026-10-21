// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord, type WireValue } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";

/**
 * codex-transcript.test.ts -- a coding agent on Codex stores its items under
 * Codex's own names, with the shapes `codex-moments.ts` keeps of them, and
 * its tab draws each on the renderer Luke's own tool of that kind draws on:
 * its row's verb and subject, and its input and answer once opened. A call to
 * Luke's own MCP server is stored under Luke's tool's name and its answer as
 * that tool's JSON, and is drawn as Luke's tool always is. The shapes are
 * those P16's recording (`tools/codex-probe/fixtures/hermetic`) carries;
 * synthetic paths and words.
 */

const ESCAPE = String.fromCharCode(27);

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** One part as the events route stores a Codex item: answered where `output` is given, still running where not. */
function storedPart(tool: string, input: WireRecord, output?: WireValue): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: `item_${tool}`,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

/** The parts drawn as a turn of the agent's, every target its rows open recorded. */
function drawn(...parts: WireRecord[]) {
  const message: CodingAgentMessage = { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts };
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
        moving: false,
        delegation: { models: [], onOpenTarget: (target) => opened.push(target) },
      }),
    ),
  );
  return { container, opened };
}

/** What a row says on its line, and everything it shows once its fold is opened. */
function opened(part: WireRecord): { readonly line: string; readonly body: string } {
  const { container } = drawn(part);
  const line = container.querySelector("summary") ?? assert.fail("the call is a fold's line");
  const said = line.textContent ?? "";
  act(() => line.click());
  return { line: said, body: container.textContent ?? "" };
}

const CHECKOUT = "/workspace/repository";

const CODEX_ITEMS: readonly {
  readonly name: string;
  readonly tool: string;
  readonly input: WireRecord;
  readonly output: WireValue;
  /** What the row's line says. */
  readonly line: readonly string[];
  /** What its opened body shows, of its input and its answer. */
  readonly body: readonly string[];
}[] = [
  {
    name: "a command",
    tool: "commandExecution",
    input: { command: "pnpm test --filter web", cwd: CHECKOUT },
    output: { output: `${ESCAPE}[32m12 passed${ESCAPE}[0m\n`, exitCode: 0 },
    line: ["pnpm test --filter web"],
    body: ["pnpm test --filter web", "12 passed"],
  },
  {
    name: "a file added",
    tool: "fileChange",
    input: {
      changes: [{ path: `${CHECKOUT}/src/export.ts`, kind: { type: "add" }, diff: "export {};\n" }],
    },
    output: { status: "completed" },
    line: ["Edited", `${CHECKOUT}/src/export.ts`],
    body: [`*** Add File: ${CHECKOUT}/src/export.ts`, "+export {};", "completed"],
  },
  {
    name: "a web search",
    tool: "webSearch",
    input: { query: "banker's rounding in JavaScript" },
    output: {
      query: "banker's rounding in JavaScript",
      action: { type: "search", query: "banker's rounding in JavaScript" },
      results: null,
    },
    line: ["Searched the web for", "banker's rounding in JavaScript"],
    body: ['"type": "search"'],
  },
  {
    name: "a subagent spawned",
    tool: "collabAgentToolCall",
    input: {
      tool: "spawnAgent",
      prompt: "Find every caller of invoiceTotal and say which round.",
      model: "gpt-5.5",
      receiverThreadIds: ["thread-sub"],
    },
    output: {
      status: "completed",
      agentsStates: {
        "thread-sub": {
          status: "completed",
          message: "Two callers round: src/export.ts and src/print.ts.",
        },
      },
    },
    line: ["Find every caller of invoiceTotal and say which round."],
    body: ["Find every caller of invoiceTotal", "Two callers round"],
  },
  {
    name: "a wait on subagents",
    tool: "collabAgentToolCall",
    input: { tool: "wait", prompt: null, model: null, receiverThreadIds: ["thread-sub"] },
    output: { status: "completed", agentsStates: { "thread-sub": { status: "completed" } } },
    line: ["Wait for subagents"],
    body: ["completed"],
  },
  {
    name: "another server's MCP tool",
    tool: "mcpToolCall",
    input: { server: "sentry", tool: "search_issues", arguments: { query: "invoice" } },
    output: "3 issues match invoice",
    line: ["sentry.search_issues"],
    body: ['"query": "invoice"', "3 issues match invoice"],
  },
];

for (const item of CODEX_ITEMS) {
  test(`Codex's ${item.name} is drawn on the renderer of Luke's tool of its kind`, () => {
    const { line, body } = opened(storedPart(item.tool, item.input, item.output));
    for (const words of item.line) assert.ok(line.includes(words), `${line} says ${words}`);
    for (const words of item.body) assert.ok(body.includes(words), `${body} shows ${words}`);
    assert.ok(!body.includes(ESCAPE), "a terminal's escapes are taken out");
  });
}

test("a file change's update marks the lines Codex's diff changed, a file deleted its lines removed, and a move where the file went", () => {
  const { container } = drawn(
    storedPart(
      "fileChange",
      {
        changes: [
          {
            path: `${CHECKOUT}/src/a.ts`,
            kind: { type: "update", move_path: `${CHECKOUT}/src/b.ts` },
            diff: "@@ -1 +1,2 @@\n a;\n-b;\n+c;\n+d;\n",
          },
          { path: `${CHECKOUT}/src/old.ts`, kind: { type: "delete" }, diff: "gone;\n" },
        ],
      },
      { status: "completed" },
    ),
  );
  const line = container.querySelector("summary") ?? assert.fail("the call is a fold's line");
  assert.ok(line.textContent?.includes(`${CHECKOUT}/src/a.ts +1`), line.textContent ?? "");
  act(() => line.click());
  const marked = (kind: string) =>
    [...container.querySelectorAll(`[data-line="${kind}"]`)].map((each) => each.textContent);
  assert.deepEqual(marked("removed"), ["-b;", "-gone;"]);
  assert.deepEqual(marked("added"), ["+c;", "+d;"]);
  assert.deepEqual(marked("mark"), [
    `*** Update File: ${CHECKOUT}/src/a.ts`,
    `*** Move to: ${CHECKOUT}/src/b.ts`,
    "@@ -1 +1,2 @@",
    `*** Delete File: ${CHECKOUT}/src/old.ts`,
  ]);
});

test("a subagent call that was interrupted keeps its row, its task on its line and why it stopped in its body", () => {
  const { line, body } = opened({
    type: "tool-collabAgentToolCall",
    toolCallId: "item_spawn",
    state: "output-error",
    input: {
      tool: "spawnAgent",
      prompt: "Find the queue.",
      model: "gpt-5.5",
      receiverThreadIds: ["thread-sub"],
    },
    output: { status: "interrupted", agentsStates: { "thread-sub": { status: "interrupted" } } },
    errorText: "interrupted",
  });
  assert.ok(line.includes("Find the queue."), line);
  assert.ok(body.includes("interrupted"), body);
});

test("a command that failed says its exit code, and one still running draws its row from its input alone", () => {
  const failed = opened(
    storedPart(
      "commandExecution",
      { command: "pnpm lint", cwd: CHECKOUT },
      {
        output: "lint failed\n",
        exitCode: 1,
      },
    ),
  );
  assert.ok(failed.body.includes("lint failed\nexit 1"), failed.body);
  const running = opened(storedPart("commandExecution", { command: "sleep 600", cwd: CHECKOUT }));
  assert.ok(running.line.includes("sleep 600"));
});

test("Codex's plan is drawn as the agent's to-do list, a completed step done", () => {
  const plan = {
    explanation: null,
    plan: [
      { step: "Round the totals", status: "completed" },
      { step: "Export the invoices", status: "inProgress" },
      { step: "Open the pull request", status: "pending" },
    ],
  };
  const { container } = drawn(storedPart("todoList", plan, plan));
  const line = container.querySelector("summary") ?? assert.fail("the list is a fold's line");
  assert.ok(line.textContent?.includes("1 of 3 done"), line.textContent ?? "");
  act(() => line.click());
  const items = [...container.querySelectorAll("[data-todo-status]")].map((item) => [
    item.textContent,
    item.getAttribute("data-todo-status"),
  ]);
  assert.deepEqual(items, [
    ["Round the totals", "done"],
    ["Export the invoices", "in_progress"],
    ["Open the pull request", "pending"],
  ]);
});

test("Codex's reasoning summary is drawn as the agent's reasoning", () => {
  const { container } = drawn({ type: "reasoning", text: "Reading the inbox first." });
  assert.ok(
    container.textContent?.includes("Reading the inbox first."),
    container.textContent ?? "",
  );
});

test("Luke's read_inbox, called over its MCP server and stored under its own name, opens the inbox", () => {
  const { container, opened: targets } = drawn(
    storedPart("read_inbox", {}, { status: "accepted", inbox: [] }),
  );
  const row =
    container.querySelector<HTMLButtonElement>('button[data-call-id="item_read_inbox"]') ??
    assert.fail("the row is a button");
  act(() => row.click());
  assert.deepEqual(targets, [{ kind: TOOL_TARGET.INBOX }]);
});
