// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { PLAN_WORK_PART, PLAN_WORK_STATE, PLAN_WORK_TOOL } from "@sidecar/hosted/planning-view";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { selectedText, sheetStyle } from "#testing/css-rules";
import { TOOL_BLOCK, TOOL_STATE } from "../ai-elements/tool";
import { AgentTranscriptView } from "./agent-tab";
import { PlanWork } from "./plan-work";
import {
  TranscriptOpeningCall,
  TranscriptReasoning,
  TranscriptSubagent,
  TranscriptTool,
} from "./transcript-blocks";
import { CALL_KIND } from "./turn-rows";

/**
 * The Work tab and a coding agent's tab draw a turn's reasoning and its
 * tool calls through the same rows, so what a reader learns on one tab
 * holds on the other: a row is closed until clicked, and opens onto what
 * the call was given and what it answered.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function mounted(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The fold whose line says this, closed or open. */
function foldSaying(container: HTMLElement, words: string): HTMLDetailsElement {
  const fold = [...container.querySelectorAll<HTMLDetailsElement>("details")].find((candidate) =>
    candidate.querySelector("summary")?.textContent?.includes(words),
  );
  assert.ok(fold, `no row says ${words}`);
  return fold;
}

const REASONING = "List the sources first.";
/** The reasoning as a model sends it: a blank line around its words, which keep their indent. */
const REASONING_SENT = `\n  ${REASONING}\n\n`;
const COMMAND = "ls src";
const OUTPUT = "invite.ts";

/** What the described call says it is for. */
const DESCRIPTION = "List the sources";

/** A repository call on the Work tab's wire, with what it is for where the model said it. */
function workCall(id: string, command: string, description?: string) {
  return {
    type: PLAN_WORK_PART.TOOL,
    id,
    tool: PLAN_WORK_TOOL.REPOSITORY,
    name: "run_in_repository",
    state: PLAN_WORK_STATE.DONE,
    subject: command,
    input: JSON.stringify({ command, description }),
    output: OUTPUT,
  } as const;
}

/** The same call on an agent's wire. */
function agentCall(
  id: string,
  command: string,
  description?: string,
): CodingAgentMessage["parts"][number] {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: description === undefined ? { command } : { command, description },
    output: {
      status: "completed",
      exitCode: 0,
      stdout: `${OUTPUT}\n`,
      stderr: "",
      truncated: false,
    },
  };
}

/** One finished turn drawn on each tab: the words, the reasoning, then one call, described where asked; or two calls ahead of the words. */
function surfaces(
  callsFirst: boolean,
  description?: string,
): readonly (readonly [string, ReactElement])[] {
  const work = createElement(PlanWork, {
    callLive: false,
    earlier: undefined,
    onLoadEarlier: () => Promise.resolve(),
    onOpenSubagent: () => undefined,
    shown: true,
    turns: [
      {
        turnId: "turn-1",
        startedAt: 1_000,
        state: PLAN_WORK_STATE.DONE,
        earlierOmitted: false,
        parts: callsFirst
          ? [
              { type: PLAN_WORK_PART.REASONING, text: REASONING_SENT },
              workCall("call-1", COMMAND),
              workCall("call-2", "cat src/invite.ts"),
              { type: PLAN_WORK_PART.TEXT, text: "One file." },
            ]
          : [
              { type: PLAN_WORK_PART.TEXT, text: "Looking at the sources." },
              { type: PLAN_WORK_PART.REASONING, text: REASONING_SENT },
              workCall("call-1", COMMAND, description),
            ],
      },
    ],
  });
  const agent = createElement(AgentTranscriptView, {
    messages: [
      {
        id: "m-turn",
        role: "assistant",
        parts: callsFirst
          ? [
              { type: "reasoning", text: REASONING_SENT },
              agentCall("call-1", COMMAND),
              agentCall("call-2", "cat src/invite.ts"),
              { type: "text", text: "One file." },
            ]
          : [
              { type: "text", text: "Looking at the sources." },
              { type: "reasoning", text: REASONING_SENT },
              agentCall("call-1", COMMAND, description),
            ],
      },
    ],
    reading: false,
    failed: false,
    working: false,
    onRetry: () => undefined,
  });
  return [
    ["the Work tab", work],
    ["an agent's tab", agent],
  ];
}

test.each(surfaces(false))(
  "on %s a command is one row saying what it ran, closed until clicked, and the reasoning folds the same way, each line dropping its preview while open",
  (_surface, element) => {
    const container = mounted(element);
    const said = () => container.textContent ?? "";
    const line = (fold: HTMLDetailsElement) => fold.querySelector("summary")?.textContent;
    const click = (fold: HTMLDetailsElement) => act(() => fold.querySelector("summary")?.click());

    const call = foldSaying(container, COMMAND);
    assert.equal(line(call), `Ran ${COMMAND}`);
    assert.equal(call.open, false);
    assert.equal(call.querySelector("[data-tool-output]"), null);
    assert.equal(said().includes(OUTPUT), false);
    click(call);
    assert.equal(call.open, true);
    assert.equal(line(call), "Ran");
    assert.equal(call.querySelector("[data-tool-input]")?.textContent, `$ ${COMMAND}`);
    assert.equal(call.querySelector("[data-tool-output]")?.textContent, OUTPUT);
    click(call);
    assert.equal(line(call), `Ran ${COMMAND}`);

    const thought = foldSaying(container, "Thought");
    assert.equal(thought.open, false);
    assert.equal(line(thought), `Thought ${REASONING}`);
    assert.equal(thought.querySelector("summary + div"), null);
    click(thought);
    assert.equal(line(thought), "Thought");
    assert.equal(thought.querySelector("summary + div")?.textContent, `  ${REASONING}`);
    click(thought);
    assert.equal(line(thought), `Thought ${REASONING}`);
  },
);

test.each(surfaces(false, DESCRIPTION))(
  "on %s a command the model described is a row saying what it is for, in words, then previewing the command in code while closed, and the command is what it opens onto",
  (_surface, element) => {
    const container = mounted(element);

    // Note that the row is found by its call, because the thought's preview opens on the same words.
    const call = container.querySelector<HTMLDetailsElement>('details[data-call-id="call-1"]');
    assert.ok(call);
    const line = call.querySelector("summary");
    assert.equal(line?.textContent, `${DESCRIPTION} ${COMMAND}`);
    assert.equal(line?.querySelector(".font-mono")?.textContent, COMMAND);
    act(() => line?.click());
    assert.equal(line?.textContent, DESCRIPTION);
    assert.equal(call.querySelector("[data-tool-input]")?.textContent, `$ ${COMMAND}`);
    assert.equal(call.querySelector("[data-tool-output]")?.textContent, OUTPUT);
  },
);

test("a described command's closed row previews the command's first line alone, while an undescribed command's row still says it all", () => {
  const command = "\ncd apps/web\npnpm test --filter web";
  const row = (description: string | undefined) =>
    mounted(
      createElement(TranscriptTool, {
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        kind: CALL_KIND.COMMAND,
        subject: command,
        description,
        input: { kind: TOOL_BLOCK.COMMAND, text: command },
        output: { kind: TOOL_BLOCK.TEXT, text: OUTPUT },
        errorText: undefined,
      }),
    );
  const described = row("Run the web tests");
  assert.equal(described.querySelector("summary")?.textContent, "Run the web tests cd apps/web");
  const undescribed = row(undefined);
  assert.equal(undescribed.querySelector("summary")?.textContent, `Ran ${command}`);
});

test.each(surfaces(true))(
  "on %s a finished turn folds what came before its last words under one line, its calls on rows of their own inside it, never grouped a second time",
  (_surface, element) => {
    const container = mounted(element);
    const lead = foldSaying(container, "2 tool calls");
    assert.equal(lead.open, false);
    assert.equal(container.querySelector("details[data-turn-fold] details"), null);
    act(() => lead.querySelector("summary")?.click());
    assert.equal(
      container.querySelectorAll("[data-turn-fold]").length,
      1,
      "one fold, no group in it",
    );
    assert.equal(container.textContent?.includes("tools called"), false);
    assert.ok(foldSaying(container, COMMAND));
    assert.ok(foldSaying(container, "cat src/invite.ts"));
  },
);

test.each(surfaces(true))(
  "on %s every folded row starts with its own icon, not a chevron, and the whole line opens it and says so",
  (_surface, element) => {
    const container = mounted(element);
    const closed = () => container.querySelector("details:not([open]) > summary");
    for (let line = closed(); line instanceof HTMLElement; line = closed()) {
      assert.equal(line.getAttribute("aria-expanded"), "false");
      act(() => line.click());
      assert.equal(line.getAttribute("aria-expanded"), "true");
    }
    const rows = [...container.querySelectorAll("summary")];
    // The calls, the reasoning, and the lines folding them.
    assert.ok(rows.length >= 4);
    for (const row of rows) {
      assert.equal(row.querySelector(".lucide-chevron-right"), null);
      assert.ok(row.firstElementChild?.matches("svg, span:has(> svg)"));
      // A summary is in the tab order, and Enter and Space press it as a click.
      assert.equal(row.tabIndex, 0);
    }
    const call = container.querySelector<HTMLDetailsElement>('details[data-call-id="call-1"]');
    assert.ok(call);
    act(() => call.querySelector("summary")?.click());
    assert.equal(call.querySelector("summary")?.getAttribute("aria-expanded"), "false");
    assert.equal(call.open, false);
  },
);

test.each(surfaces(false))(
  "on %s an opened reasoning starts on its first line and ends on its last word, with no blank line around it",
  (_surface, element) => {
    const container = mounted(element);
    const thought = foldSaying(container, "Thought");
    act(() => thought.querySelector("summary")?.click());
    assert.equal(thought.querySelector("summary + div")?.textContent, `  ${REASONING}`);
  },
);

/** The closed line of a thought with these words. */
function thoughtLine(text: string): string | null | undefined {
  return mounted(createElement(TranscriptReasoning, { text })).querySelector("summary")
    ?.textContent;
}

test("a thought's closed line previews its first line as plain words, its markdown's marks left out", () => {
  assert.equal(
    thoughtLine("\n**Reading the route**\n\nStart with the seat check."),
    "Thought Reading the route",
  );
  assert.equal(
    thoughtLine(
      "Start with `invite.ts`, then [the docs](https://example.com/docs).\nThen the tests.",
    ),
    "Thought Start with invite.ts, then the docs.",
  );
});

test("a long thought's preview is one line, cut short of its end", () => {
  const steps = Array.from({ length: 60 }, (_, index) => `Step ${index + 1} of the plan.`);
  const line = thoughtLine(steps.join(" ")) ?? "";
  assert.ok(line.startsWith("Thought Step 1 of the plan. Step 2 of the plan."));
  assert.equal(line.includes("Step 60"), false);
});

test("a thought with no words says Thought alone", () => {
  assert.equal(thoughtLine(""), "Thought");
  assert.equal(thoughtLine("\n  \n"), "Thought");
});

test("a call that is not a command keeps its subject on the open row", () => {
  const container = mounted(
    createElement(TranscriptTool, {
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      kind: CALL_KIND.READ_FILE,
      subject: "src/invite.ts",
      input: { kind: TOOL_BLOCK.TEXT, text: "src/invite.ts" },
      output: { kind: TOOL_BLOCK.TEXT, text: "export {};" },
      errorText: undefined,
    }),
  );
  const summary = container.querySelector("summary");
  assert.ok(summary);
  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(summary.textContent, "Read src/invite.ts");
});

/** The inks a muted line is drawn in: the utility's token, and the token it names, which a row written in CSS uses. */
const MUTED_INK = new Set(["var(--color-muted-foreground)", "var(--text-secondary)"]);

/** The inks words in full are drawn in, by the same two names. */
const FULL_INK = new Set(["var(--color-foreground)", "var(--text-primary)"]);

/** The ink a text node is drawn in, as the nearest rule setting one says. */
async function inkReader(): Promise<(node: Node) => string | undefined> {
  const style = await sheetStyle();
  return (node) => {
    for (let element = node.parentElement; element !== null; element = element.parentElement) {
      const color = style(element, "color");
      if (color !== undefined) return color;
    }
    return undefined;
  };
}

/** The text nodes under an element that hold words. */
function texts(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.data.trim() !== "") found.push(node);
  }
  return found;
}

/** Asserts a line's first words, what it did, are in full ink, and every word after them, its preview, in the muted ink. */
function assertTitleThenPreview(line: Element, inkOf: (node: Node) => string | undefined): void {
  const [title, ...preview] = texts(line);
  assert.ok(title, "the line says what it did");
  assert.ok(FULL_INK.has(inkOf(title) ?? ""), `"${title.data}" is drawn in ${inkOf(title)}`);
  for (const text of preview) {
    assert.ok(MUTED_INK.has(inkOf(text) ?? ""), `"${text.data}" is drawn in ${inkOf(text)}`);
  }
}

/** One turn of an agent's: words, then a call of each shape a row draws, one of them failed, then a subagent and a to-do list. */
const MIXED_TURN: CodingAgentMessage = {
  id: "m-mixed",
  role: "assistant",
  parts: [
    { type: "text", text: "Looking at the sources." },
    agentCall("call-1", COMMAND),
    agentCall("call-8", COMMAND, DESCRIPTION),
    {
      type: "tool-read_file",
      toolCallId: "call-2",
      state: "output-available",
      input: { filePath: "src/invite.ts" },
      output: { content: "export const seats = 3;" },
    },
    {
      type: "tool-apply_patch",
      toolCallId: "call-3",
      state: "output-available",
      input: { patchText: "*** Update File: src/invite.ts\n-a\n+b" },
      output: { files: [{ operation: "update", path: "src/invite.ts" }] },
    },
    {
      type: "tool-grep",
      toolCallId: "call-4",
      state: "output-error",
      input: { pattern: "seats" },
      errorText: "grep exited 2",
    },
    {
      type: "tool-delegate",
      toolCallId: "call-5",
      state: "input-available",
      input: { task: "Read the docs" },
    },
    {
      type: "tool-write_todos",
      toolCallId: "call-6",
      state: "output-available",
      input: { todos: [{ content: "Count pending invites", status: "pending" }] },
      output: {},
    },
  ],
};

test("every call's line says what it did in full ink and its icon and subject in the muted ink, while the model's words, an opened body, and an error keep their own", async () => {
  const inkOf = await inkReader();
  const container = mounted(
    createElement("div", null, [
      createElement(AgentTranscriptView, {
        key: "agent",
        messages: [MIXED_TURN],
        reading: false,
        failed: false,
        working: true,
        onRetry: () => undefined,
      }),
      createElement(TranscriptOpeningCall, {
        key: "opening",
        callId: "call-7",
        kind: CALL_KIND.START_AGENT,
        subject: "Invite flow",
        state: TOOL_STATE.OUTPUT_AVAILABLE,
        onOpen: () => undefined,
      }),
    ]),
  );
  for (
    let fold = container.querySelector("[data-turn-fold]:not([open]) > summary");
    fold instanceof HTMLElement;
    fold = container.querySelector("[data-turn-fold]:not([open]) > summary")
  ) {
    act(() => fold.click());
  }
  const lines = [
    ...container.querySelectorAll(
      "details[data-call-id] > summary, [data-subagent-row], button[data-call-id]",
    ),
  ];
  assert.equal(lines.length, 8, "a line for every call");
  for (const line of lines) {
    assertTitleThenPreview(line, inkOf);
    // Note that the icon is read from inside it, because the ink is read from a node's parent up.
    const icon = line.firstElementChild?.firstChild;
    assert.ok(icon && MUTED_INK.has(inkOf(icon) ?? ""), "the icon is muted");
  }

  const words = texts(container).find((text) => text.data.includes("Looking at the sources."));
  assert.ok(words);
  assert.equal(MUTED_INK.has(inkOf(words) ?? ""), false, "the model's words are in full ink");
  for (const id of ["call-2", "call-4"]) {
    act(() => container.querySelector<HTMLElement>(`[data-call-id="${id}"] > summary`)?.click());
  }
  const answer = container.querySelector('[data-call-id="call-2"] [data-tool-output]');
  const error = container.querySelector('[data-call-id="call-4"] [role="alert"]');
  assert.ok(answer && error);
  for (const text of [...texts(answer), ...texts(error)]) {
    assert.equal(MUTED_INK.has(inkOf(text) ?? ""), false, `"${text.data}" keeps its own ink`);
  }
});

test("what a call answered, and the error it ended in, select and copy as text", async () => {
  const style = await sheetStyle();
  const container = mounted(
    createElement(AgentTranscriptView, {
      messages: [MIXED_TURN],
      reading: false,
      failed: false,
      working: true,
      onRetry: () => undefined,
    }),
  );
  for (
    let fold = container.querySelector("[data-turn-fold]:not([open]) > summary");
    fold instanceof HTMLElement;
    fold = container.querySelector("[data-turn-fold]:not([open]) > summary")
  ) {
    act(() => fold.click());
  }
  for (const id of ["call-2", "call-4"]) {
    act(() => container.querySelector<HTMLElement>(`[data-call-id="${id}"] > summary`)?.click());
  }

  const answer = container.querySelector('[data-call-id="call-2"] [data-tool-output]');
  const error = container.querySelector('[data-call-id="call-4"] [role="alert"]');
  assert.ok(answer && error);
  assert.equal(selectedText(style, answer), "export const seats = 3;");
  assert.equal(selectedText(style, error), "grep exited 2");
});

test.each(surfaces(true))(
  "on %s a finished turn's fold counting its rows is all muted, while the thought, a row of its own, says it is one in full ink and previews it muted",
  async (_surface, element) => {
    const inkOf = await inkReader();
    const container = mounted(element);
    const lead = foldSaying(container, "2 tool calls");
    act(() => lead.querySelector("summary")?.click());
    for (const text of texts(lead.querySelector("summary") ?? lead)) {
      assert.ok(MUTED_INK.has(inkOf(text) ?? ""), `"${text.data}" is drawn in ${inkOf(text)}`);
    }
    const thought = foldSaying(container, "Thought").querySelector("summary");
    assert.ok(thought);
    assertTitleThenPreview(thought, inkOf);
    assert.equal(texts(thought).length, 2, "a preview");
  },
);

const GPT: CatalogModel = {
  id: "openai/gpt-5.6-sol",
  name: "GPT-5.6 Sol",
  provider: MODEL_PROVIDER.OPENAI,
  efforts: ["low", "medium", "high"],
};

const HAIKU: CatalogModel = {
  id: "anthropic/claude-haiku-5.5",
  name: "Claude Haiku 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high"],
};

test.each([
  [
    "code shown wears the Code tab's brackets, not the file glyph",
    CALL_KIND.SHOW_CODE,
    "lucide-code-xml",
  ],
  [
    "the agents listed wear the Coding agents glyph, not a terminal or the subagent's robot",
    CALL_KIND.LIST_AGENTS,
    "lucide-workflow",
  ],
  ["an agent read wears the Coding agents glyph too", CALL_KIND.READ_AGENT, "lucide-workflow"],
] as const)("a call's row: %s", (_what, kind, glyph) => {
  const container = mounted(
    createElement(TranscriptTool, {
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      kind,
      subject: "src/invite.ts",
      input: { kind: TOOL_BLOCK.TEXT, text: "{}" },
      output: { kind: TOOL_BLOCK.TEXT, text: "{}" },
      errorText: undefined,
    }),
  );
  assert.equal(container.querySelector(`summary svg.${glyph}`) === null, false);
  assert.equal(
    container.querySelector(
      "summary svg.lucide-file-code, summary svg.lucide-bot, summary svg.lucide-square-terminal",
    ) === null,
    true,
  );
});

test.each([
  ["Claude Code's Clawd for an Anthropic model", HAIKU.id, "svg.provider-mark"],
  ["Codex's cloud for an OpenAI model", GPT.id, 'img.provider-mark[src="marks/codex-16.png"]'],
  [
    "Clawd for an Anthropic model the catalog does not list yet",
    "anthropic/claude-haiku-9",
    "svg.provider-mark",
  ],
  ["the robot for a model of no provider Luke runs agents on", "mistral/large-3", "svg.lucide-bot"],
] as const)("a subagent's row leads with %s", (_glyph, model, drawn) => {
  const container = mounted(
    createElement(TranscriptSubagent, {
      callId: "call_d1",
      job: "Count the routes.",
      pair: { choice: { model, effort: "low" }, models: [HAIKU, GPT] },
      state: TOOL_STATE.OUTPUT_AVAILABLE,
      errorText: undefined,
      onOpen: () => undefined,
    }),
  );
  const row = container.querySelector("[data-subagent-row]");
  assert.ok(row?.firstElementChild?.matches(`${drawn}, :has(> ${drawn})`));
});
