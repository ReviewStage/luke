// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CHECK_SUMMARY,
  CODING_AGENT_BRIEF,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  type CodingAgentBrief,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  type CodingAgentSummary,
  type CodingAgentUsage,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { installClipboard, onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { PublishedChip, PublishedRow } from "./agent-published";
import { AgentTabView, AgentTranscriptView, type DelegationDoors } from "./agent-tab";

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
  title: null,
  createdAt: 1,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: null,
} as const;

/** The published chip mounted live, so it can be pressed and its right-click menu's items chosen. */
function mountedChip(
  published: CodingAgentPullRequestAnswer | undefined,
  doors: { openGitHub: (url: string) => void; copy: (words: string, label: string) => void },
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(createElement(PublishedChip, { published, doors }));
  });
  return container;
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
}

const chipOf = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(".agent-published-chip");

/** Right-clicks the chip, as the pointer would, and answers whether the page's own menu was kept from opening. */
function rightClick(chip: HTMLElement): boolean {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 300,
  });
  act(() => chip.dispatchEvent(event));
  return event.defaultPrevented;
}

/** Right-clicks the chip and chooses the item named from its menu. */
function choose(container: HTMLElement, label: string): void {
  const chip = chipOf(container);
  assert.ok(chip, "the chip stands");
  rightClick(chip);
  const item = menuItems().find((candidate) => candidate.textContent === label);
  assert.ok(item, `the menu offers ${label}`);
  act(() => item.click());
}

/** The whole tab drawn once, with the agent in the status given and the transcript's last page saying why it failed. */
function tabMarkup(
  status: CodingAgentSummary["status"],
  failure?: CodingAgentFailure,
  turnUsage?: CodingAgentUsage,
): string {
  return renderToStaticMarkup(
    createElement(AgentTabView, {
      agent: { ...AGENT, status },
      models: undefined,
      startedAt: undefined,
      readModels: ignore,
      transcript: {
        messages: [PLAN, TURN],
        failure,
        usage: undefined,
        turnUsage,
        context: undefined,
        reading: false,
        failed: false,
        onRetry: ignore,
      },
      composer: {
        draft: "",
        setDraft: ignore,
        sending: false,
        note: undefined,
        closed: undefined,
        send: ignore,
        retry: ignore,
        sent: [],
      },
      model: {
        choice: { model: AGENT.model, effort: AGENT.effort },
        note: undefined,
        choose: ignore,
      },
      published: undefined,
      doors: SHUT,
      onStop: () => Promise.resolve(),
      openGitHub: ignore,
    }),
  );
}

function drawn(
  messages: readonly CodingAgentMessage[],
  working = false,
  brief: CodingAgentBrief | undefined = undefined,
): string {
  return renderToStaticMarkup(
    createElement(AgentTranscriptView, {
      messages,
      brief,
      reading: false,
      failed: false,
      working,
      onRetry: ignore,
      openGitHub: ignore,
    }),
  );
}

/** The transcript mounted live, so a row can be opened. */
function mounted(
  messages: readonly CodingAgentMessage[],
  openGitHub: (url: string) => void = ignore,
  registry?: AtomRegistry,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    const view = createElement(AgentTranscriptView, {
      messages,
      reading: false,
      failed: false,
      working: false,
      onRetry: ignore,
      openGitHub,
    });
    root.render(registry === undefined ? view : onRegistry(registry, view));
  });
  return container;
}

const SONNET: CatalogModel = {
  id: "anthropic/claude-sonnet-5.5",
  name: "Claude Sonnet 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high"],
};

const TASK = "Count the routes.\n\nList every file under apps/web/server/routes.";

/** A turn delegating twice: one worker answered on the pair the agent chose, one still at work on the agent's own. */
const DELEGATING: CodingAgentMessage = {
  id: "m-delegating",
  role: "assistant",
  parts: [
    { type: "reasoning", text: "Two workers can read in parallel." },
    {
      type: "tool-delegate",
      toolCallId: "call_d1",
      state: "output-available",
      input: { task: TASK, model: SONNET.id, effort: "medium" },
      output: { model: SONNET.id, effort: "medium", result: "Three routes: plans, agents, sweep." },
    },
    {
      type: "tool-delegate",
      toolCallId: "call_d2",
      state: "input-available",
      input: { task: "Find the sweep's bound." },
    },
  ],
};

test("a delegation draws as a subagent's row on a line of its own, saying the task and the model with its effort dimmed after it and no mark, the agent's own pair where it chose none, a spinner while the worker runs and a check once it answered; running or finished, the row is one button that opens the worker's tab, with nothing to expand and no button of its own", () => {
  const opened: Parameters<NonNullable<DelegationDoors["onOpen"]>>[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      createElement(AgentTranscriptView, {
        messages: [PLAN, DELEGATING],
        delegation: {
          models: [SONNET],
          own: { model: AGENT.model, effort: AGENT.effort },
          onOpen: (...args) => opened.push(args),
        },
        reading: false,
        failed: false,
        working: true,
        onRetry: ignore,
        openGitHub: ignore,
      }),
    );
  });

  const rows = [...container.querySelectorAll<HTMLElement>("[data-subagent-row]")];
  assert.deepEqual(
    rows.map((row) => row.getAttribute("data-call-id")),
    ["call_d1", "call_d2"],
  );
  assert.equal(container.querySelector("[data-turn-fold]"), null, "each on a row of its own");
  const [done, running] = rows;
  assert.ok(done && running);
  assert.equal(done.textContent, "Count the routes.Sonnet 5.5 Medium");
  assert.equal(
    done.querySelector("[data-subagent-pair] .model-label-detail")?.textContent,
    "Medium",
    "the effort dimmed after the model",
  );
  assert.equal(done.querySelector("[data-subagent-pair] .provider-mark"), null, "no mark");
  assert.ok(done.querySelector('[data-tool-state="output-available"]'));
  assert.equal(running.querySelector("[data-subagent-pair]")?.textContent, "Opus 5.5 High");
  assert.ok(running.querySelector('[data-tool-state="input-available"]'));
  assert.ok(running.querySelector("svg.lucide-bot.text-luke"), "lit while it runs");
  for (const row of rows) {
    assert.equal(row.tagName, "BUTTON", "the whole row is the button");
    assert.equal(row.closest("details"), null, "nothing to expand");
    assert.equal(row.querySelector("button, summary, details"), null, "no control inside it");
  }
  assert.equal(container.textContent?.includes("Three routes"), false, "the answer is the tab's");

  act(() => running.click());
  act(() => done.click());
  assert.deepEqual(opened, [
    ["call_d2", "Find the sweep's bound.", CODING_AGENT_STATUS.RUNNING],
    ["call_d1", TASK, CODING_AGENT_STATUS.COMPLETED],
  ]);
  assert.equal(container.textContent?.includes("Three routes"), false, "nothing opened in place");
});

test("a delegation refused before its worker began says why in red under its row, with nothing to open first", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const refusal = "The model anthropic/claude-haiku-9 is not in the catalog.";
  act(() => {
    root.render(
      createElement(AgentTranscriptView, {
        messages: [
          PLAN,
          {
            id: "m-refused",
            role: "assistant",
            parts: [
              {
                type: "tool-delegate",
                toolCallId: "call_d3",
                state: "output-error",
                input: { task: "Count the routes." },
                errorText: refusal,
              },
            ],
          },
        ],
        delegation: { models: [SONNET], onOpen: ignore },
        reading: false,
        failed: false,
        working: false,
        onRetry: ignore,
        openGitHub: ignore,
      }),
    );
  });

  const row = container.querySelector<HTMLElement>('[data-subagent-row][data-call-id="call_d3"]');
  assert.ok(row);
  assert.equal(row.tagName, "BUTTON");
  assert.ok(row.querySelector('[data-tool-state="output-error"]'));
  assert.equal(container.querySelector('[role="alert"]')?.textContent, refusal);
});

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

/** The transcript mounted with every run of calls and folded lead opened, as a reader opens them to reach the rows. */
function unfolded(
  messages: readonly CodingAgentMessage[],
  openGitHub: (url: string) => void = ignore,
  registry?: AtomRegistry,
): HTMLElement {
  const container = mounted(messages, openGitHub, registry);
  for (;;) {
    const fold = container.querySelector<HTMLDetailsElement>("[data-turn-fold]:not([open])");
    if (fold === null) return container;
    act(() => fold.querySelector("summary")?.click());
  }
}

test("a bash call's row reads as the command it ran, never as the input's JSON", () => {
  const markup = unfolded([TURN]).innerHTML;
  assert.match(markup, /Ran <\/span><span[^>]*>cat AGENTS\.md<\/span>/u);
  assert.doesNotMatch(markup, /"command"/u);
  assert.doesNotMatch(markup, /\{&quot;command&quot;/u);
});

test("a finished turn folds its calls under one line saying how many, as the Work tab folds Luke's, and nothing opens on its own", () => {
  const markup = drawn([TURN]);
  assert.match(markup, /<details[^>]*data-turn-fold=""[^>]*><summary[^>]*>.*?4 tool calls</u);
  assert.doesNotMatch(markup, /data-call-id/u);
  assert.doesNotMatch(markup, /<details[^>]*\sopen/u);
  const container = unfolded([TURN]);
  assert.equal(
    container.querySelectorAll("[data-turn-fold]").length,
    1,
    "no group inside the lead",
  );
  assert.equal(container.querySelectorAll("details[data-call-id]").length, 4);
});

test("each row says what the call did and where it stands, and the icon and mark are 16px", () => {
  const markup = unfolded([TURN]).innerHTML;
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
  // No row opens on its own, and a closed row draws no body.
  assert.doesNotMatch(markup, /<details[^>]*data-call-id[^>]*\sopen/u);
  assert.doesNotMatch(markup, /data-tool-output/u);
});

test("opening a row shows the command's answer with the terminal's escapes taken out, and an error in a live row", () => {
  const container = unfolded([TURN]);
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
  const container = unfolded([
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
  const container = unfolded([TURN]);
  const selector = "details:not([data-call-id]):not([data-plan-card]):not([data-turn-fold])";
  const reasoning = container.querySelector<HTMLDetailsElement>(selector);
  assert.ok(reasoning);
  assert.equal(reasoning.querySelector("summary")?.textContent, "Thought");
  assert.equal(container.textContent?.includes("Read AGENTS.md before anything else."), false);
  open(container, selector);
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
  const container = unfolded([TURN], (url) => opened.push(url));
  const link = container.querySelector<HTMLAnchorElement>("a.agent-link");
  assert.ok(link);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link.dispatchEvent(click);
  });
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/7"]);
});

test("the tab wears no head: it opens on the transcript, what the agent runs on is the chip at the box's foot, and a stopped or failed turn ends the transcript on one quiet line saying so", () => {
  const running = tabMarkup(CODING_AGENT_STATUS.RUNNING);
  assert.doesNotMatch(running, /<header|agent-tab-header|agent-status-dot|agent-end-line/u);
  assert.match(running, /<section[^>]*class="agent-tab[^"]*"[^>]*><div[^>]*><div role="log"/u);
  assert.match(
    running,
    /class="agent-model-chip">.*?<span class="model-label-name">Opus 5\.5<\/span> <span class="model-label-detail">High<\/span>/u,
  );
  assert.match(
    tabMarkup(CODING_AGENT_STATUS.CANCELLED),
    /<p class="agent-end-line"[^>]*>Stopped</u,
  );
  assert.match(
    tabMarkup(CODING_AGENT_STATUS.FAILED, CODING_AGENT_FAILURE.GITHUB),
    /<p class="agent-end-line"[^>]*>Failed: GitHub refused or could not be reached</u,
  );
  assert.match(tabMarkup(CODING_AGENT_STATUS.FAILED), /agent-end-line"[^>]*>Failed</u);
  assert.match(
    tabMarkup(CODING_AGENT_STATUS.CANCELLED, undefined, {
      inputTokens: 9,
      outputTokens: 1,
      costUsd: 0.001,
    }),
    /agent-end-line"[^>]*>Stopped · &lt;\$0\.01</u,
  );
  assert.doesNotMatch(tabMarkup(CODING_AGENT_STATUS.COMPLETED), /agent-end-line/u);
});

test("with nothing held the tab says the agent is starting, or how it ended before its first message, a read out says it is reading, and a failed read offers Try again", () => {
  const empty = (reading: boolean, failed: boolean, ended?: string) =>
    renderToStaticMarkup(
      createElement(AgentTranscriptView, {
        messages: [],
        reading,
        failed,
        working: false,
        ended,
        onRetry: ignore,
        openGitHub: ignore,
      }),
    );
  assert.match(empty(false, false), /The agent is starting\./u);
  assert.match(empty(false, false, "Failed"), /data-ended="">Failed</u);
  assert.doesNotMatch(empty(false, false, "Failed"), /starting/u);
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
  const container = unfolded([PLAN, TURN]);
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

test("an agent handed a task draws it as the developer's message, with no plan card, and an agent handed the plan still draws its card", () => {
  const tasked = drawn([PLAN, TURN], false, CODING_AGENT_BRIEF.TASK);
  assert.doesNotMatch(tasked, /data-plan-card=""/u);
  assert.match(tasked, /<div class="[^"]*\bis-user\b[^"]*"[^>]*>.*?Teammate invitations/u);
  const planned = drawn([PLAN, TURN], false, CODING_AGENT_BRIEF.PLAN);
  assert.equal((planned.match(/data-plan-card=""/gu) ?? []).length, 1);
});

it.effect(
  "copying a turn hands the clipboard the agent's words alone, never its tool calls, and a turn of calls alone offers no copy",
  () =>
    Effect.gen(function* () {
      const clipboard = installClipboard();
      const container = unfolded([PLAN, TURN], ignore, yield* registryOnTestClock);
      const copy = container.querySelector<HTMLButtonElement>(
        '.is-assistant button[aria-label="Copy"]',
      );
      assert.ok(copy);
      act(() => copy.click());
      yield* Effect.promise(() =>
        act(async () => {
          for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
        }),
      );
      assert.deepEqual(clipboard.copied, [
        "Opened [the pull request](https://github.com/acme/relay/pull/7). See [the docs](https://example.com/docs).",
      ]);
      assert.equal(copy.querySelector('[role="status"]')?.textContent, "Copied");

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
              output: {
                status: "completed",
                exitCode: 0,
                stdout: "a\n",
                stderr: "",
                truncated: false,
              },
            },
          ],
        },
      ]);
      assert.equal(callsOnly.querySelector('button[aria-label="Copy"]'), null);
    }),
);

test("the box's foot wears the pull request's chip in its state's colour with no dot, the branch's chip with no pull request, and nothing before the service has said", () => {
  const chip = (published: CodingAgentPullRequestAnswer | undefined) =>
    renderToStaticMarkup(createElement(PublishedChip, { published, doors: SHUT }));
  const pullRequest = chip(PUBLISHED);
  assert.match(
    pullRequest,
    /class="plan-compose-chip agent-published-chip" data-state="open" data-menu-open="false" aria-label="Pull request #123, open">[\s\S]*agent-pr-number">#123<\/span><\/button>/u,
  );
  assert.doesNotMatch(pullRequest, /aria-haspopup|agent-check-dot|data-checks/u);
  assert.match(
    chip({ ...PUBLISHED, pullRequest: null }),
    /agent-published-chip" data-menu-open="false" aria-label="luke\/teammate-invitations"[\s\S]*agent-branch-name">luke\/teammate-invitations</u,
  );
  assert.equal(chip({ ...PUBLISHED, branch: null, pullRequest: null }), "");
  assert.equal(chip(undefined), "");
});

test("a press of the chip opens the pull request on GitHub, or the branch compared where there is none, with no menu", () => {
  const opened: string[] = [];
  const doors = { openGitHub: (url: string) => opened.push(url), copy: ignore };
  for (const published of [PUBLISHED, { ...PUBLISHED, pullRequest: null }]) {
    const chip = chipOf(mountedChip(published, doors));
    assert.ok(chip);
    act(() => chip.click());
  }
  assert.deepEqual(opened, [
    "https://github.com/acme/relay/pull/123",
    "https://github.com/acme/relay/compare/luke/teammate-invitations?expand=1",
  ]);
  assert.deepEqual(menuItems(), [], "a press drops no menu");
});

test("a right-click on the chip offers copying the branch and its checkout command word for word, each with its toast, and no menu where there is no branch", () => {
  const opened: string[] = [];
  const copied: string[][] = [];
  const container = mountedChip(PUBLISHED, {
    openGitHub: (url) => opened.push(url),
    copy: (words, label) => copied.push([words, label]),
  });
  const chip = chipOf(container);
  assert.ok(chip);
  assert.equal(rightClick(chip), true, "the page's own menu stays shut");
  assert.deepEqual(
    menuItems().map((item) => item.textContent),
    ["Copy branch name", "Copy checkout command"],
  );
  choose(container, "Copy branch name");
  choose(container, "Copy checkout command");
  assert.deepEqual(copied, [
    ["luke/teammate-invitations", "Branch name copied"],
    [
      "git fetch origin luke/teammate-invitations && git switch luke/teammate-invitations",
      "Checkout command copied",
    ],
  ]);
  assert.deepEqual(opened, [], "a right-click opens nothing");
  assert.deepEqual(menuItems(), [], "the menu closes on a choice");

  const branchless = chipOf(mountedChip({ ...PUBLISHED, branch: null }, SHUT));
  assert.ok(branchless);
  assert.equal(rightClick(branchless), false);
  assert.deepEqual(menuItems(), []);
});

test("a finished transcript ends on the pull request's row: its number and title, the lines added in green and removed in red, where it stands only once it is no longer open, and no dot; a press opens it", () => {
  const row = (pullRequest: CodingAgentPullRequest) =>
    renderToStaticMarkup(
      createElement(AgentTranscriptView, {
        messages: [PLAN, TURN],
        reading: false,
        failed: false,
        working: false,
        onRetry: ignore,
        openGitHub: ignore,
        footer: createElement(PublishedRow, { pullRequest, openGitHub: ignore }),
      }),
    );
  const open = row(PULL_REQUEST);
  assert.match(
    open,
    /<\/div><button type="button" class="agent-published-row" data-published-row="" data-state="open">[\s\S]*agent-published-title" data-overflow="false">#123 · Teammate invitations<\/span><span class="agent-published-lines"><span class="agent-published-added">\+210<\/span> <span class="agent-published-removed">−14<\/span><\/span><\/button>/u,
  );
  assert.doesNotMatch(open, /agent-check-dot|data-checks|Pull request|Open<|files?</u);
  assert.match(
    row({ ...PULL_REQUEST, state: PULL_REQUEST_STATE.MERGED }),
    /Teammate invitations<\/span><span class="agent-published-state">Merged<\/span><span class="agent-published-lines">/u,
  );
  assert.match(
    row({ ...PULL_REQUEST, state: PULL_REQUEST_STATE.CLOSED }),
    /agent-published-state">Closed</u,
  );

  const opened: string[] = [];
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
  const pressed = container.querySelector<HTMLButtonElement>("[data-published-row]");
  assert.ok(pressed);
  act(() => pressed.click());
  assert.deepEqual(opened, ["https://github.com/acme/relay/pull/123"]);
});
