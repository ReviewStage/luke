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

const REASONING = "List the sources first.";
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
    turns: [
      {
        turnId: "turn-1",
        startedAt: 1_000,
        state: PLAN_WORK_STATE.DONE,
        earlierOmitted: false,
        parts: callsFirst
          ? [
              { type: PLAN_WORK_PART.REASONING, text: REASONING },
              workCall("call-1", COMMAND),
              workCall("call-2", "cat src/invite.ts"),
              { type: PLAN_WORK_PART.TEXT, text: "One file." },
            ]
          : [
              { type: PLAN_WORK_PART.TEXT, text: "Looking at the sources." },
              { type: PLAN_WORK_PART.REASONING, text: REASONING },
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
              { type: "reasoning", text: REASONING },
              agentCall("call-1", COMMAND),
              agentCall("call-2", "cat src/invite.ts"),
              { type: "text", text: "One file." },
            ]
          : [
              { type: "text", text: "Looking at the sources." },
              { type: "reasoning", text: REASONING },
              agentCall("call-1", COMMAND),
            ],
      },
    ],
    reading: false,
    failed: false,
    working: false,
    onRetry: () => undefined,
    openGitHub: () => undefined,
    copyText: () => Promise.resolve(),
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
  "on %s a finished turn folds what came before its last words under one line, its calls grouped under another",
  (_surface, element) => {
    const container = mounted(element);
    const lead = foldSaying(container, "2 tool calls");
    assert.equal(lead.open, false);
    assert.equal(container.querySelector("details[data-turn-fold] details"), null);
    act(() => lead.querySelector("summary")?.click());
    const group = foldSaying(container, "2 tools called");
    assert.equal(group.open, false);
    act(() => group.querySelector("summary")?.click());
    assert.ok(foldSaying(container, COMMAND));
    assert.ok(foldSaying(container, "cat src/invite.ts"));
  },
);
