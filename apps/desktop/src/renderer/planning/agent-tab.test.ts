// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentMessage } from "@sidecar/hosted/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { AgentHeader, AgentTranscriptView } from "./agent-tab";

const PLAN: CodingAgentMessage = {
  id: "m-plan",
  role: "user",
  parts: [{ type: "text", text: "# Teammate invitations\n\nInvite a teammate by email." }],
};

const TURN: CodingAgentMessage = {
  id: "m-turn",
  role: "assistant",
  parts: [
    { type: "step-start" },
    { type: "reasoning", text: "Read AGENTS.md before anything else." },
    {
      type: "tool-bash",
      toolCallId: "call_1",
      state: "output-available",
      input: { command: "cat AGENTS.md" },
      output: "# Agent guide",
    },
    {
      type: "tool-bash",
      toolCallId: "call_2",
      state: "output-error",
      input: { command: "pnpm check" },
      errorText: "exit status 1",
    },
    { type: "step-start" },
    {
      type: "text",
      text: "Opened [the pull request](https://github.com/acme/relay/pull/7). See [the docs](https://example.com/docs).",
    },
  ],
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const ignore = () => undefined;

function drawn(messages: readonly CodingAgentMessage[]): string {
  return renderToStaticMarkup(
    createElement(AgentTranscriptView, {
      messages,
      reading: false,
      failed: false,
      onRetry: ignore,
      openGitHub: ignore,
    }),
  );
}

test("the plan stands folded as the one user turn, the reasoning and each tool call fold closed, and the text is markdown", () => {
  const markup = drawn([PLAN, TURN]);
  const folds = markup.match(/<details/gu) ?? [];
  // The plan, the reasoning, and the two calls each fold, and none opens on its own.
  assert.equal(folds.length, 4);
  assert.doesNotMatch(markup, /<details[^>]*\sopen/u);
  assert.match(markup, /<summary[^>]*>[^<]*<span[^>]*>▸<\/span>Plan<\/summary>/u);
  assert.match(markup, /Reasoning<\/summary>/u);
  assert.match(markup, /Read AGENTS\.md before anything else\./u);
  // Each call is named by its tool with its state, and holds its input and its answer.
  assert.match(markup, /bash<\/span><span[^>]*data-tool-state="output-available"[^>]*>Completed/u);
  assert.match(markup, /cat AGENTS\.md/u);
  assert.match(markup, /# Agent guide/u);
  // A call that ended in an error says so in a live row.
  assert.match(markup, /data-tool-state="output-error"[^>]*>Error/u);
  assert.match(markup, /role="alert"[^>]*>exit status 1</u);
  // The words are markdown: the link is drawn as one.
  assert.match(markup, /<a href="https:\/\/github\.com\/acme\/relay\/pull\/7" class="agent-link"/u);
  // A link off GitHub is drawn as words that go nowhere.
  assert.doesNotMatch(markup, /href="https:\/\/example\.com\/docs"/u);
  assert.match(markup, /class="agent-link-inert"[^>]*>the docs</u);
});

test("the pull request's link opens on GitHub in the browser rather than in the window", () => {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      createElement(AgentTranscriptView, {
        messages: [TURN],
        reading: false,
        failed: false,
        onRetry: ignore,
        openGitHub: (url) => opened.push(url),
      }),
    );
  });

  const link = container.querySelector<HTMLAnchorElement>("a.agent-link");
  assert.ok(link);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(click);
  });
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/7"]);
});

test("the head says model · effort · status with the dot, and offers Stop only while the agent may still write", () => {
  const agent = {
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    createdAt: 1,
    status: CODING_AGENT_STATUS.RUNNING,
  } as const;
  const running = renderToStaticMarkup(
    createElement(AgentHeader, { agent, models: undefined, onStop: () => Promise.resolve() }),
  );
  assert.match(running, /class="agent-status-dot" data-status="running" data-live="true"/u);
  assert.match(
    running,
    /Claude Opus 5\.5<\/strong><span[^>]*> · <\/span>high<span[^>]*> · <\/span><span data-status="running">Running/u,
  );
  assert.match(running, /Stop<\/button>/u);

  const ended = renderToStaticMarkup(
    createElement(AgentHeader, {
      agent: { ...agent, status: CODING_AGENT_STATUS.COMPLETED },
      models: undefined,
      onStop: () => Promise.resolve(),
    }),
  );
  assert.match(ended, /data-status="completed" data-live="false"/u);
  assert.doesNotMatch(ended, /Stop<\/button>/u);
});

test("with nothing held the tab says the agent is starting, a read out says it is reading, and a failed read offers Try again", () => {
  const empty = (reading: boolean, failed: boolean) =>
    renderToStaticMarkup(
      createElement(AgentTranscriptView, {
        messages: [],
        reading,
        failed,
        onRetry: ignore,
        openGitHub: ignore,
      }),
    );
  assert.match(empty(false, false), /The agent is starting\./u);
  assert.match(empty(true, false), /Reading the transcript…/u);
  assert.match(empty(false, true), /could not be read[\s\S]*Try again/u);
});
