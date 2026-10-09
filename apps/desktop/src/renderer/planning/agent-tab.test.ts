// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { PublishedRow } from "./agent-published";
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
const copyNothing = () => Promise.resolve();

/** Doors that lead nowhere. */
const SHUT = { openGitHub: ignore, copy: ignore };

const PULL_REQUEST: CodingAgentPullRequest = {
  number: 123,
  title: "Teammate invitations",
  url: "https://github.com/acme/relay/pull/123",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.PASSING,
  additions: 210,
  deletions: 14,
  changedFiles: 6,
};

const PUBLISHED: CodingAgentPullRequestAnswer = {
  repository: "acme/relay",
  branch: "luke/teammate-invitations",
  pullRequest: PULL_REQUEST,
};

const AGENT = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
} as const;

/** The head mounted live, so its ⋯ can be opened and its items pressed. */
function mountedHead(
  published: CodingAgentPullRequestAnswer | undefined,
  doors: { openGitHub: (url: string) => void; copy: (words: string) => void },
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      createElement(AgentHeader, {
        agent: AGENT,
        models: undefined,
        published,
        doors,
        onStop: () => Promise.resolve(),
      }),
    );
  });
  return container;
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}

/** Opens the head's ⋯ and presses the item named. */
function choose(container: HTMLElement, label: string): void {
  const more = container.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]');
  assert.ok(more, "the ⋯ stands");
  act(() => more.click());
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}

function drawn(messages: readonly CodingAgentMessage[], working = false): string {
  return renderToStaticMarkup(
    createElement(AgentTranscriptView, {
      messages,
      reading: false,
      failed: false,
      working,
      onRetry: ignore,
      openGitHub: ignore,
      copyText: copyNothing,
    }),
  );
}

/** The transcript mounted live, so a row can be opened. */
function mounted(
  messages: readonly CodingAgentMessage[],
  openGitHub: (url: string) => void = ignore,
  copyText: (words: string) => Promise<void> = copyNothing,
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
        working: false,
        onRetry: ignore,
        openGitHub,
        copyText,
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
  const agent = AGENT;
  const running = renderToStaticMarkup(
    createElement(AgentHeader, {
      agent,
      models: undefined,
      published: undefined,
      doors: SHUT,
      onStop: () => Promise.resolve(),
    }),
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
      published: undefined,
      doors: SHUT,
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
      published: undefined,
      doors: SHUT,
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
        working: false,
        onRetry: ignore,
        openGitHub: ignore,
        copyText: copyNothing,
      }),
    );
  assert.match(empty(false, false), /The agent is starting\./u);
  assert.match(empty(true, false), /Reading the transcript…/u);
  assert.match(empty(false, true), /could not be read[\s\S]*Try again/u);
});

/** A message the developer sent the agent after the plan, as O1's messaging stores one. */
const FOLLOW_UP: CodingAgentMessage = {
  id: "m-follow-up",
  role: "user",
  parts: [{ type: "text", text: "Also expire them after a week." }],
};

test("each kind of part is drawn by its AI Elements component: the plan a card, a tool a row, the thinking folded, the words a response, an error in red", () => {
  const container = mounted([PLAN, TURN]);
  const log = container.querySelector('[role="log"]');
  assert.ok(log);
  // The plan card is the registry's Plan: a details first in the log, holding its content once opened.
  assert.ok(log.firstElementChild?.matches("details[data-plan-card]"));
  // Each tool call is one Tool row with its input and output under it.
  const rows = [...log.querySelectorAll("details[data-call-id]")];
  assert.equal(rows.length, 4);
  for (const row of rows) assert.ok(row.querySelector("summary [data-tool-state]"));
  // The reasoning is one Reasoning fold under its line.
  const thoughts = [...log.querySelectorAll("details")].filter(
    (fold) => fold.querySelector("summary")?.textContent === "Thought",
  );
  assert.equal(thoughts.length, 1);
  // The words are a Response: markdown inside the assistant's message.
  const turn = log.querySelector(".is-assistant");
  assert.ok(turn);
  assert.ok(turn.querySelector("p")?.textContent?.startsWith("Opened "));
  // A call that failed carries the error in red, as an alert, once opened.
  const failed = open(container, '[data-call-id="call_4"]');
  const error = failed.querySelector('[role="alert"]');
  assert.ok(error);
  assert.ok(error.classList.contains("text-danger"));
  assert.equal(
    failed
      .querySelector('[data-tool-state="output-error"]')
      ?.querySelector("svg")
      ?.classList.contains("text-danger"),
    true,
  );
});

test("a working line shimmers at the end only while the agent may still write, so a finished turn ends on its own last line", () => {
  const running = drawn([PLAN, TURN], true);
  assert.match(
    running,
    /<p[^>]*data-working=""[^>]*><span[^>]*animate-shimmer[^>]*>Working…<\/span><\/p><\/div>/u,
  );
  const ended = drawn([PLAN, TURN], false);
  assert.doesNotMatch(ended, /Working…/u);
  assert.doesNotMatch(ended, /data-working/u);
  // Nothing trails the last message: the log's own padding is the end.
  assert.match(ended, /<\/div><\/div><\/div>$/u);
});

test("a message the developer sent after the plan is the developer's bubble, and only the first is the plan card", () => {
  const markup = drawn([PLAN, TURN, FOLLOW_UP]);
  const cards = markup.match(/data-plan-card=""/gu) ?? [];
  assert.equal(cards.length, 1);
  assert.match(
    markup,
    /<div class="[^"]*\bis-user\b[^"]*"[^>]*>.*?Also expire them after a week\./u,
  );
  assert.doesNotMatch(markup, /Plan · <\/span><span[^>]*>Also expire them/u);
});

test("copying a turn hands the clipboard the agent's words alone, never its tool calls, and a turn of calls alone offers no copy", async () => {
  const copied: string[] = [];
  const container = mounted([PLAN, TURN], ignore, (words) => {
    copied.push(words);
    return Promise.resolve();
  });
  const copy = container.querySelector<HTMLButtonElement>(
    '.is-assistant button[aria-label="Copy"]',
  );
  assert.ok(copy);
  await act(async () => {
    copy.click();
    await Promise.resolve();
  });
  assert.deepEqual(copied, [
    "Opened [the pull request](https://github.com/acme/relay/pull/7). See [the docs](https://example.com/docs).",
  ]);
  assert.equal(copy.getAttribute("aria-label"), "Copied");

  const callsOnly = mounted([
    {
      id: "m-calls",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call_only",
          state: "output-available",
          input: { command: "ls" },
          output: { status: "completed", exitCode: 0, stdout: "a\n", stderr: "", truncated: false },
        },
      ],
    },
  ]);
  assert.equal(callsOnly.querySelector('button[aria-label="Copy"]'), null);
});

test("the head wears the pull request's pill in its state's colour with the check dot, the branch's chip with no pull request, and nothing before the service has said", () => {
  const head = (published: CodingAgentPullRequestAnswer | undefined) =>
    renderToStaticMarkup(
      createElement(AgentHeader, {
        agent: AGENT,
        models: undefined,
        published,
        doors: SHUT,
        onStop: () => Promise.resolve(),
      }),
    );
  for (const state of Object.values(PULL_REQUEST_STATE)) {
    const pill = head({ ...PUBLISHED, pullRequest: { ...PULL_REQUEST, state } });
    assert.match(pill, new RegExp(`class="agent-pr-pill" data-state="${state}"`, "u"));
    assert.match(pill, /class="agent-pr-number">#123</u);
  }
  for (const checks of Object.values(CHECK_SUMMARY)) {
    const pill = head({ ...PUBLISHED, pullRequest: { ...PULL_REQUEST, checks } });
    assert.match(pill, new RegExp(`class="agent-check-dot" data-checks="${checks}"`, "u"));
  }
  assert.match(head(PUBLISHED), /aria-label="Pull request #123, open, checks passing"/u);
  assert.match(head(PUBLISHED), /aria-label="Pull request actions"/u);
  assert.doesNotMatch(head(PUBLISHED), /agent-branch-chip/u);

  const chip = head({ ...PUBLISHED, pullRequest: null });
  assert.match(chip, /class="agent-branch-chip"[^>]*>[\s\S]*luke\/teammate-invitations</u);
  assert.doesNotMatch(chip, /agent-pr-pill/u);
  assert.match(chip, /aria-label="Pull request actions"/u);

  for (const bare of [undefined, { ...PUBLISHED, branch: null, pullRequest: null }]) {
    const nothing = head(bare);
    assert.doesNotMatch(nothing, /agent-pr-pill|agent-branch-chip|Pull request actions/u);
  }
});

test("the pill opens the pull request, and the ⋯ offers opening it, copying the branch and its checkout command word for word, and the changes on GitHub", () => {
  const opened: string[] = [];
  const copied: string[] = [];
  const doors = {
    openGitHub: (url: string) => opened.push(url),
    copy: (words: string) => copied.push(words),
  };
  const container = mountedHead(PUBLISHED, doors);

  const pill = container.querySelector<HTMLButtonElement>(".agent-pr-pill");
  assert.ok(pill);
  act(() => pill.click());
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/123"]);

  choose(container, "Open pull request");
  choose(container, "Copy branch name");
  choose(container, "Copy checkout command");
  choose(container, "View changes on GitHub");
  assert.deepEqual(opened, [
    "https://github.com/acme/relay/pull/123",
    "https://github.com/acme/relay/pull/123",
    "https://github.com/acme/relay/pull/123/files",
  ]);
  assert.deepEqual(copied, [
    "luke/teammate-invitations",
    "git fetch origin luke/teammate-invitations && git switch luke/teammate-invitations",
  ]);
  // The menu closes on a choice, and nothing in it is Stop, which stays the head's own button.
  assert.deepEqual(menuItems(), []);
  const more = container.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]');
  assert.ok(more);
  act(() => more.click());
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Open pull request", "Copy branch name", "Copy checkout command", "View changes on GitHub"],
  );
});

test("with a branch and no pull request the ⋯ offers the copies and the compare page alone", () => {
  const opened: string[] = [];
  const container = mountedHead(
    { ...PUBLISHED, pullRequest: null },
    { openGitHub: (url) => opened.push(url), copy: ignore },
  );
  const more = container.querySelector<HTMLButtonElement>('[aria-label="Pull request actions"]');
  assert.ok(more);
  act(() => more.click());
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Copy branch name", "Copy checkout command", "View changes on GitHub"],
  );
  const changes = menuItems().find((item) => item.textContent === "View changes on GitHub");
  assert.ok(changes);
  act(() => changes.click());
  assert.deepEqual(opened, [
    "https://github.com/acme/relay/compare/luke/teammate-invitations?expand=1",
  ]);
});

test("a finished transcript ends on the row summing the pull request up, whose Open opens it", () => {
  const opened: string[] = [];
  const markup = renderToStaticMarkup(
    createElement(AgentTranscriptView, {
      messages: [PLAN, TURN],
      reading: false,
      failed: false,
      working: false,
      onRetry: ignore,
      openGitHub: ignore,
      copyText: copyNothing,
      footer: createElement(PublishedRow, { pullRequest: PULL_REQUEST, openGitHub: ignore }),
    }),
  );
  assert.match(
    markup,
    /<\/div><div[^>]*data-published-row=""[^>]*data-state="open"[^>]*>[\s\S]*Opened #123 · \+210 −14 in 6 files<\/span><span class="agent-check-dot" data-checks="passing"/u,
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      createElement(PublishedRow, {
        pullRequest: PULL_REQUEST,
        openGitHub: (url) => opened.push(url),
      }),
    );
  });
  const open = container.querySelector<HTMLButtonElement>(".agent-published-open");
  assert.ok(open);
  assert.equal(open.textContent, "Open");
  act(() => open.click());
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/123"]);
});
