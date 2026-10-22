// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_PAYER, type CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord, type WireValue } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { agentUsageLine } from "./coding-agent-model.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";

/**
 * claude-code-transcript.test.ts -- a coding agent on Claude Code stores its
 * calls under the CLI's own tool names, with the CLI's own input and the text
 * the model read as the answer (`claude-code-moments.ts`), and its tab draws
 * each on the renderer Luke's own tool of that kind draws on: its row's verb
 * and subject, and its input and answer once opened. A call to Luke's own MCP
 * server is stored under Luke's tool's name and its answer as that tool's
 * JSON, and is drawn as Luke's tool always is. Synthetic paths and words.
 */

const ESCAPE = String.fromCharCode(27);

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** One part as the events route stores a Claude Code call: answered where `output` is given, still running where not. */
function storedPart(tool: string, input: WireRecord, output?: WireValue): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: `toolu_${tool}`,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

/** The part drawn as a turn of the agent's, every target its row opens recorded. */
function drawn(part: WireRecord) {
  const message: CodingAgentMessage = {
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [part],
  };
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

const CLI_CALLS: readonly {
  readonly tool: string;
  readonly input: WireRecord;
  readonly output: WireValue;
  /** What the row's line says. */
  readonly line: readonly string[];
  /** What its opened body shows, of its input and its answer. */
  readonly body: readonly string[];
}[] = [
  {
    tool: "Bash",
    input: { command: "pnpm test --filter web", description: "Run the web tests" },
    output: `${ESCAPE}[32m12 passed${ESCAPE}[0m\n`,
    line: ["Run the web tests"],
    body: ["pnpm test --filter web", "12 passed"],
  },
  {
    tool: "Read",
    input: { file_path: `${CHECKOUT}/src/invoice.ts`, offset: 1, limit: 40 },
    output: "     1\texport const invoice = 1;\n",
    line: ["Read", `${CHECKOUT}/src/invoice.ts`],
    body: ["export const invoice = 1;"],
  },
  {
    tool: "Edit",
    input: {
      file_path: `${CHECKOUT}/src/invoice.ts`,
      old_string: "const invoice = 1;\n",
      new_string: "const invoice = 2;\n\nexport {};\n",
    },
    output: "The file has been updated successfully.",
    line: ["Edited", `${CHECKOUT}/src/invoice.ts`],
    body: ["-const invoice = 1;", "+const invoice = 2;", "updated successfully"],
  },
  {
    tool: "Write",
    input: { file_path: `${CHECKOUT}/src/export.ts`, content: "export {};\n" },
    output: `File created successfully at: ${CHECKOUT}/src/export.ts`,
    line: ["Wrote", `${CHECKOUT}/src/export.ts`],
    body: ["export {};", "File created successfully"],
  },
  {
    tool: "NotebookEdit",
    input: {
      notebook_path: `${CHECKOUT}/notes/explore.ipynb`,
      cell_id: "cell-3",
      new_source: "print(total)",
      edit_mode: "replace",
    },
    output: "Updated cell cell-3",
    line: ["Edited", `${CHECKOUT}/notes/explore.ipynb`],
    body: ["@@ replace cell cell-3", "+print(total)"],
  },
  {
    tool: "Glob",
    input: { pattern: "src/**/*.ts" },
    output: `${CHECKOUT}/src/invoice.ts\n${CHECKOUT}/src/export.ts`,
    line: ["Searched", "src/**/*.ts"],
    body: [`${CHECKOUT}/src/export.ts`],
  },
  {
    tool: "Grep",
    input: { pattern: "invoiceTotal", output_mode: "files_with_matches" },
    output: "Found 1 file\nsrc/invoice.ts",
    line: ["Searched", "invoiceTotal"],
    body: ["Found 1 file"],
  },
  {
    tool: "WebFetch",
    input: { url: "https://docs.example.com/invoices/export", prompt: "How are totals rounded?" },
    output: "Totals are rounded half to even.",
    line: ["Fetched"],
    body: ["https://docs.example.com/invoices/export", "rounded half to even"],
  },
  {
    tool: "WebSearch",
    input: { query: "banker's rounding in JavaScript" },
    output: 'Web search results for query: "banker\'s rounding in JavaScript"',
    line: ["Searched the web for", "banker's rounding in JavaScript"],
    body: ["Web search results for query"],
  },
  {
    tool: "Skill",
    input: { skill: "testing" },
    output: "Launching skill: testing",
    line: ["testing"],
    body: ["Launching skill: testing"],
  },
  {
    tool: "ScheduleWakeup",
    input: { delaySeconds: 270, reason: "Wait for CI", prompt: "Check CI", noop: false },
    output: "Wakeup scheduled in 270 seconds.",
    line: ["ScheduleWakeup"],
    body: ["Wait for CI", "Wakeup scheduled"],
  },
  {
    tool: "Monitor",
    input: {
      description: "Watch the checks",
      command: "gh pr checks 12 --watch",
      timeout_ms: 300000,
    },
    output: "Monitor started.",
    line: ["Watch the checks"],
    body: ["gh pr checks 12 --watch", "Monitor started."],
  },
];

for (const call of CLI_CALLS) {
  test(`Claude Code's ${call.tool} is drawn on the renderer of Luke's tool of its kind`, () => {
    const { line, body } = opened(storedPart(call.tool, call.input, call.output));
    for (const words of call.line) assert.ok(line.includes(words), `${line} says ${words}`);
    for (const words of call.body) assert.ok(body.includes(words), `${body} shows ${words}`);
    assert.ok(!body.includes(ESCAPE), "a terminal's escapes are taken out");
  });
}

test("Claude Code's Agent is drawn as a subagent's row, named by its description, on the model it asked for, running until its call settles", () => {
  const input = {
    description: "Find the invoice callers",
    prompt: "Find every caller of invoiceTotal and say which round.",
    model: "sonnet",
    effort: "high",
  };
  const running = drawn({
    type: "tool-Agent",
    toolCallId: "toolu_agent",
    state: "input-available",
    input,
  }).container;
  const row = running.querySelector("[data-subagent-row]") ?? assert.fail("a subagent's row");
  assert.ok(row.textContent?.includes("Find the invoice callers"), row.textContent ?? "");
  assert.ok(row.textContent?.includes("Sonnet"), row.textContent ?? "");
  assert.notEqual(row.tagName, "BUTTON", "no worker's tab to open yet");
  const settled = drawn({
    type: "tool-Agent",
    toolCallId: "toolu_agent",
    state: "output-available",
    input,
    output: "Two callers round: src/export.ts and src/print.ts.",
  }).container;
  const line = settled.querySelector<HTMLElement>("[data-subagent-row]") ?? assert.fail("a row");
  act(() => line.click());
  // With no worker's tab to read it in, the task and the answer fold open under the row.
  assert.ok(settled.textContent?.includes("Find every caller of invoiceTotal"));
  assert.ok(settled.textContent?.includes("Two callers round"));
});

test("an Edit's patch marks the lines it changed, the newline ending its words opening none", () => {
  const { container } = drawn(
    storedPart(
      "Edit",
      { file_path: `${CHECKOUT}/src/a.ts`, old_string: "a;\n", new_string: "b;\n\nc;\n" },
      "The file has been updated successfully.",
    ),
  );
  const line = container.querySelector("summary") ?? assert.fail("the call is a fold's line");
  act(() => line.click());
  const marked = (kind: string) =>
    [...container.querySelectorAll(`[data-line="${kind}"]`)].map((each) => each.textContent);
  assert.deepEqual(marked("removed"), ["-a;"]);
  assert.deepEqual(marked("added"), ["+b;", "+", "+c;"]);
});

test("a call still running draws its row from its input alone", () => {
  const { line } = opened(storedPart("Read", { file_path: `${CHECKOUT}/src/invoice.ts` }));
  assert.ok(line.includes(`${CHECKOUT}/src/invoice.ts`));
});

test("a failed Bash call shows the error the CLI answered", () => {
  const { body } = opened({
    type: "tool-Bash",
    toolCallId: "toolu_Bash",
    state: "output-error",
    input: { command: "pnpm lint" },
    output: "Exit code 1\nlint failed",
    errorText: "Exit code 1\nlint failed",
  });
  assert.ok(body.includes("lint failed"));
});

test("Claude Code's TodoWrite is drawn as the agent's to-do list, a completed item done", () => {
  const { container } = drawn(
    storedPart(
      "TodoWrite",
      {
        todos: [
          { content: "Round the totals", status: "completed", activeForm: "Rounding the totals" },
          { content: "Export the invoices", status: "in_progress", activeForm: "Exporting" },
          { content: "Open the pull request", status: "pending", activeForm: "Opening it" },
        ],
      },
      "Todos have been modified successfully.",
    ),
  );
  const line = container.querySelector("summary") ?? assert.fail("the list is a fold's line");
  assert.ok(line.textContent?.includes("1 of 3 done"), line.textContent ?? "");
  act(() => line.click());
  const words = container.textContent ?? "";
  for (const item of ["Round the totals", "Export the invoices", "Open the pull request"]) {
    assert.ok(words.includes(item), `${words} lists ${item}`);
  }
});

const LUKE_CALLS: readonly {
  readonly tool: string;
  readonly input: WireRecord;
  readonly output: WireRecord;
  readonly target: ToolTarget;
}[] = [
  {
    tool: "read_inbox",
    input: {},
    output: { status: "accepted", inbox: [] },
    target: { kind: TOOL_TARGET.INBOX },
  },
  {
    tool: "edit_plan",
    input: { notes: [{ kind: "add", section: "Goal", text: "Export invoices" }] },
    output: { status: "accepted" },
    target: { kind: TOOL_TARGET.PLAN },
  },
  {
    tool: "show_page",
    input: { title: "Rounding explorer", path: "rounding.html" },
    output: { status: "accepted", page: { id: "page-1", version: 1 } },
    target: { kind: TOOL_TARGET.PAGE, page: "page-1" },
  },
];

for (const call of LUKE_CALLS) {
  test(`Luke's ${call.tool}, called over its MCP server and stored under its own name, opens what it always opens`, () => {
    const { container, opened } = drawn(storedPart(call.tool, call.input, call.output));
    const row =
      container.querySelector<HTMLButtonElement>(`button[data-call-id="toolu_${call.tool}"]`) ??
      assert.fail("the row is a button");
    act(() => row.click());
    assert.deepEqual(opened, [call.target]);
  });
}

test("an agent paid for by a plan says the plan where an agent on a key says dollars", () => {
  const usage = { inputTokens: 1_200_000, outputTokens: 30_000, costUsd: 2.41 };
  assert.equal(agentUsageLine(usage), "This agent: 1.2M tokens · $2.41");
  assert.equal(
    agentUsageLine({ ...usage, payer: CODING_AGENT_PAYER.API_KEY }),
    "This agent: 1.2M tokens · $2.41",
  );
  assert.equal(
    agentUsageLine({ ...usage, payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION }),
    "This agent: 1.2M tokens · Claude plan",
  );
  assert.equal(
    agentUsageLine({ ...usage, payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION }),
    "This agent: 1.2M tokens · ChatGPT plan",
  );
});
