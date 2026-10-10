// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { PLAN_WORK_PART, PLAN_WORK_STATE, PLAN_WORK_TOOL } from "@sidecar/hosted/planning-view";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AgentTranscriptView } from "./agent-tab";
import { PlanWork } from "./plan-work";

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

const AGENT_TURN: CodingAgentMessage = {
  id: "m-turn",
  role: "assistant",
  parts: [
    { type: "reasoning", text: "List the sources first." },
    {
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { command: "ls src" },
      output: {
        status: "completed",
        exitCode: 0,
        stdout: "invite.ts\n",
        stderr: "",
        truncated: false,
      },
    },
    { type: "text", text: "One file." },
  ],
};

const SURFACES: readonly (readonly [string, ReactElement])[] = [
  [
    "the Work tab",
    createElement(PlanWork, {
      callLive: false,
      turns: [
        {
          turnId: "turn-1",
          startedAt: 1_000,
          state: PLAN_WORK_STATE.DONE,
          earlierOmitted: false,
          parts: [
            { type: PLAN_WORK_PART.TEXT, text: "Looking at the sources." },
            { type: PLAN_WORK_PART.REASONING, text: "List the sources first." },
            {
              type: PLAN_WORK_PART.TOOL,
              id: "call-1",
              tool: PLAN_WORK_TOOL.REPOSITORY,
              name: "run_in_repository",
              state: PLAN_WORK_STATE.DONE,
              subject: "ls src",
              input: '{ "command": "ls src" }',
              output: "invite.ts",
            },
          ],
        },
      ],
    }),
  ],
  [
    "an agent's tab",
    createElement(AgentTranscriptView, {
      messages: [AGENT_TURN],
      reading: false,
      failed: false,
      working: false,
      onRetry: () => undefined,
      openGitHub: () => undefined,
      copyText: () => Promise.resolve(),
    }),
  ],
];

test.each(SURFACES)(
  "on %s a tool call is one row, closed until clicked, and the reasoning folds the same way",
  (_surface, element) => {
    const container = mounted(element);
    const said = () => container.textContent ?? "";

    const call = foldSaying(container, "ls src");
    assert.equal(call.open, false);
    assert.equal(call.querySelector("[data-tool-output]"), null);
    assert.equal(said().includes("invite.ts"), false);
    act(() => call.querySelector("summary")?.click());
    assert.equal(call.open, true);
    assert.ok(call.querySelector("[data-tool-input]")?.textContent?.includes("ls src"));
    assert.equal(call.querySelector("[data-tool-output]")?.textContent, "invite.ts");

    const thought = foldSaying(container, "Thought");
    assert.equal(thought.open, false);
    assert.equal(said().includes("List the sources first."), false);
    act(() => thought.querySelector("summary")?.click());
    assert.ok(said().includes("List the sources first."));
  },
);
