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

/** A terminal's bold on and off, which a command's output may carry. */
const BOLD_ON = `${String.fromCharCode(27)}[1m`;
const BOLD_OFF = `${String.fromCharCode(27)}[0m`;

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
      output: {
        status: "completed",
        exitCode: 0,
        stdout: `${BOLD_ON}# Agent guide${BOLD_OFF}\n`,
        stderr: "",
        truncated: false,
      },
    },
    {
      type: "tool-read_file",
      toolCallId: "call_2",
      state: "output-available",
      input: { filePath: "/workspace/repository/apps/web/server/routes/invite.ts" },
      output: { content: "export const route = 1;\n" },
    },
    {
      type: "tool-apply_patch",
      toolCallId: "call_3",
      state: "input-available",
      input: {
        root: "/workspace/repository",
        patchText:
          "*** Begin Patch\n*** Update File: apps/web/server/db/schema.ts\n@@\n-  a\n+  b\n*** End Patch",
      },
    },
    {
      type: "tool-bash",
      toolCallId: "call_4",
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

/** The transcript mounted live, so a row can be opened. */
function mounted(
  messages: readonly CodingAgentMessage[],
  openGitHub: (url: string) => void = ignore,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      createElement(AgentTranscriptView, {
        messages,
        reading: false,
        failed: false,
        onRetry: ignore,
        openGitHub,
      }),
    );
  });
  return container;
}

/** Opens the fold whose root the selector names, by the click a reader would make on its line. */
function open(container: HTMLElement, selector: string): HTMLDetailsElement {
  const fold = container.querySelector<HTMLDetailsElement>(selector);
  assert.ok(fold, `no fold at ${selector}`);
  const summary = fold.querySelector("summary");
  assert.ok(summary);
  act(() => summary.click());
  assert.equal(fold.open, true);
  return fold;
}

test("a bash call's row reads as its command behind a prompt, never as the input's JSON", () => {
  const markup = drawn([TURN]);
  assert.match(markup, /\$ cat AGENTS\.md<\/span>/u);
  assert.doesNotMatch(markup, /"command"/u);
  assert.doesNotMatch(markup, /\{&quot;command&quot;/u);
});

test("each row says what the call did and where it stands, and the chevron, icon, and mark are 16px", () => {
  const markup = drawn([TURN]);
  assert.match(
    markup,
    /Read <\/span><span[^>]*>\/workspace\/repository\/apps\/web\/server\/routes\/invite\.ts</u,
  );
  assert.match(markup, /Edited <\/span><span[^>]*>apps\/web\/server\/db\/schema\.ts</u);
  assert.match(markup, /data-tool-state="output-available"[^>]*aria-label="Completed"/u);
  assert.match(markup, /data-tool-state="input-available"[^>]*aria-label="Running"/u);
  assert.match(markup, /data-tool-state="output-error"[^>]*aria-label="Failed"/u);
  // Every svg drawn on a row is the one size, so nothing shifts as a mark changes.
  const icons = markup.match(/<svg[^>]*class="[^"]*"/gu) ?? [];
  assert.ok(icons.length >= 8);
  for (const icon of icons) assert.match(icon, /\bsize-4\b|lucide/u);
  // Nothing opens on its own, and a closed row draws no body.
  assert.doesNotMatch(markup, /<details[^>]*\sopen/u);
  assert.doesNotMatch(markup, /data-tool-output/u);
});

test("opening a row shows the command's answer with the terminal's escapes taken out, and an error in a live row", () => {
  const container = mounted([TURN]);
  assert.equal(container.textContent?.includes("# Agent guide"), false);

  const bash = open(container, '[data-call-id="call_1"]');
  const output = bash.querySelector("[data-tool-output]");
  assert.ok(output);
  assert.equal(output.textContent, "# Agent guide");
  assert.equal(bash.querySelector("[data-tool-input]")?.textContent, "$ cat AGENTS.md");

  const failed = open(container, '[data-call-id="call_4"]');
  assert.equal(failed.querySelector('[role="alert"]')?.textContent, "exit status 1");
});

test("a long answer is cut to its first lines, and Show more shows the rest", () => {
  const lines = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`);
  const container = mounted([
    {
      id: "m",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call_long",
          state: "output-available",
          input: { command: "seq 45" },
          output: {
            status: "completed",
            exitCode: 0,
            stdout: lines.join("\n"),
            stderr: "",
            truncated: false,
          },
        },
      ],
    },
  ]);
  const row = open(container, '[data-call-id="call_long"]');
  const output = () => row.querySelector("[data-tool-output]")?.textContent ?? "";
  assert.ok(output().includes("line 40"));
  assert.equal(output().includes("line 41"), false);
  const more = row.querySelector("button");
  assert.ok(more);
  assert.match(more.textContent ?? "", /Show more \(5 more lines\)/u);
  act(() => more.click());
  assert.ok(output().includes("line 45"));
  assert.equal(row.querySelector("button"), null);
});

test("the reasoning folds under one quiet line and opens on a click", () => {
  const container = mounted([TURN]);
  const reasoning = container.querySelector<HTMLDetailsElement>(
    "details:not([data-call-id]):not([data-plan-card])",
  );
  assert.ok(reasoning);
  assert.equal(reasoning.querySelector("summary")?.textContent, "Thought");
  assert.equal(container.textContent?.includes("Read AGENTS.md before anything else."), false);
  open(container, "details:not([data-call-id]):not([data-plan-card])");
  assert.ok(container.textContent?.includes("Read AGENTS.md before anything else."));
});

test("the plan is a card across the top of the transcript, folded under its title, not a bubble", () => {
  const markup = drawn([PLAN, TURN]);
  assert.match(
    markup,
    /<div[^>]*role="log"[^>]*><details[^>]*data-plan-card=""[^>]*><summary[^>]*>.*?Plan · <\/span><span[^>]*>Teammate invitations<\/span>/u,
  );
  assert.doesNotMatch(markup, /(?:^|\s)is-user(?:\s|")/u);

  const container = mounted([PLAN, TURN]);
  assert.equal(container.textContent?.includes("Invite a teammate by email."), false);
  const card = open(container, "[data-plan-card]");
  assert.equal(card.querySelector("h1")?.textContent, "Teammate invitations");
  assert.ok(card.textContent?.includes("Invite a teammate by email."));
});

test("the words are markdown, with the pull request's link opening on GitHub in the browser rather than in the window", () => {
  const markup = drawn([TURN]);
  assert.match(markup, /<a href="https:\/\/github\.com\/acme\/relay\/pull\/7" class="agent-link"/u);
  // A link off GitHub is drawn as words that go nowhere.
  assert.doesNotMatch(markup, /href="https:\/\/example\.com\/docs"/u);
  assert.match(markup, /class="agent-link-inert"[^>]*>the docs</u);

  const opened: string[] = [];
  const container = mounted([TURN], (url) => opened.push(url));
  const link = container.querySelector<HTMLAnchorElement>("a.agent-link");
  assert.ok(link);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(click);
  });
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/7"]);
});

test("the head says model · effort · status with the dot, and offers Stop only while a turn runs", () => {
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

  // A starting agent has no turn the service could cancel yet, so Stop waits for one.
  const starting = renderToStaticMarkup(
    createElement(AgentHeader, {
      agent: { ...agent, status: CODING_AGENT_STATUS.STARTING },
      models: undefined,
      onStop: () => Promise.resolve(),
    }),
  );
  assert.match(starting, /data-status="starting" data-live="true"/u);
  assert.doesNotMatch(starting, /Stop<\/button>/u);
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
