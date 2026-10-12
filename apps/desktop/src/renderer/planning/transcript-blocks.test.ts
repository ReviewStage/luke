// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { PLAN_WORK_PART, PLAN_WORK_STATE, PLAN_WORK_TOOL } from "@sidecar/hosted/planning-view";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import { AgentTranscriptView } from "./agent-tab";
import { PlanWork } from "./plan-work";
import { TranscriptSubagent } from "./transcript-blocks";

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

/** A repository call on the Work tab's wire. */
function workCall(id: string, command: string) {
  return {
    type: PLAN_WORK_PART.TOOL,
    id,
    tool: PLAN_WORK_TOOL.REPOSITORY,
    name: "run_in_repository",
    state: PLAN_WORK_STATE.DONE,
    subject: command,
    input: JSON.stringify({ command }),
    output: OUTPUT,
  } as const;
}

/** The same call on an agent's wire. */
function agentCall(id: string, command: string): CodingAgentMessage["parts"][number] {
  return {
    type: "tool-bash",
    toolCallId: id,
    state: "output-available",
    input: { command },
    output: {
      status: "completed",
      exitCode: 0,
      stdout: `${OUTPUT}\n`,
      stderr: "",
      truncated: false,
    },
  };
}

/** One finished turn drawn on each tab: the words, the reasoning, then one call; or two calls ahead of the words. */
function surfaces(callsFirst: boolean): readonly (readonly [string, ReactElement])[] {
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
              workCall("call-1", COMMAND),
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
              agentCall("call-1", COMMAND),
            ],
      },
    ],
    reading: false,
    failed: false,
    working: false,
    onRetry: () => undefined,
    openGitHub: () => undefined,
  });
  return [
    ["the Work tab", work],
    ["an agent's tab", agent],
  ];
}

test.each(surfaces(false))(
  "on %s a tool call is one row saying what it ran, closed until clicked, and the reasoning folds the same way",
  (_surface, element) => {
    const container = mounted(element);
    const said = () => container.textContent ?? "";

    const call = foldSaying(container, COMMAND);
    assert.equal(call.querySelector("summary")?.textContent, `Ran ${COMMAND}`);
    assert.equal(call.open, false);
    assert.equal(call.querySelector("[data-tool-output]"), null);
    assert.equal(said().includes(OUTPUT), false);
    act(() => call.querySelector("summary")?.click());
    assert.equal(call.open, true);
    assert.equal(call.querySelector("[data-tool-input]")?.textContent, `$ ${COMMAND}`);
    assert.equal(call.querySelector("[data-tool-output]")?.textContent, OUTPUT);

    const thought = foldSaying(container, "Thought");
    assert.equal(thought.open, false);
    assert.equal(said().includes(REASONING), false);
    act(() => thought.querySelector("summary")?.click());
    assert.ok(said().includes(REASONING));
  },
);

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
    const call = foldSaying(container, COMMAND);
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
  ["Claude Code's Clawd for an Anthropic model", HAIKU.id, "svg.provider-mark"],
  ["Codex's cloud for an OpenAI model", GPT.id, 'img.provider-mark[src="marks/codex-16.png"]'],
  ["the robot for a model the catalog does not list", "anthropic/claude-haiku-9", "svg.lucide-bot"],
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
