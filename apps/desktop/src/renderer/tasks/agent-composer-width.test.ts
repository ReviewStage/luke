// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentContext,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@luke/features/models-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { installEditorBundle, installEditorLayout, QUIET_COMPOSER } from "#testing/composer";
import { layContainersAt, shown } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { AgentComposer } from "./agent-composer";
import { useAgentComposer } from "./use-agent-composer";

/**
 * The agent's message box at the widths a column or the side panel leaves
 * its card: however narrow, the foot draws only what fits, the round Send
 * or Stop always among it; the chips naming what the agent published and
 * the model draw their marks alone, named still; and the ⋯ offers every
 * press the card had no room for, a popover it opens standing as its own
 * press would have opened it. jsdom lays nothing out, so each width is the
 * stylesheets' container queries resolved for a card that wide
 * (`#testing/container-width`). Synthetic throughout.
 */

/** The card's width under a column or a panel this wide, less the composer's inset either side. */
const CARD = {
  /** A 220px column, the side panel dragged wide. */
  NARROWEST: 178,
  /** A 320px column. */
  NARROW: 278,
  /** A 480px column. */
  MEDIUM: 438,
  /** A 720px column. */
  WIDE: 678,
} as const;

const MODELS: readonly CatalogModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "high"],
  },
];

const PUBLISHED: CodingAgentPullRequestAnswer = {
  repository: "acme/relay",
  branch: "fix/retry-backoff",
  pullRequest: {
    number: 2822,
    title: "Back off failed retries",
    url: "https://github.com/acme/relay/pull/2822",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 40,
    deletions: 6,
    changedFiles: 3,
  },
};

const CONTEXT: CodingAgentContext = {
  windowTokens: 1_000_000,
  compactionThresholdTokens: 900_000,
  inputTokens: 620_000,
  outputTokens: 2_400,
  cachedInputTokens: 600_000,
  cacheWriteTokens: 18_000,
  estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800, briefTokens: 600 },
  measuredAt: 1_800_000_000_000,
};

const ignore = () => undefined;

const roots: Root[] = [];

installEditorBundle();

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** An agent's box with everything its foot can carry: a pull request, its changes, a model, and a step's context. */
function Box({ status }: { status: CodingAgentStatus }): ReactNode {
  const composer = useAgentComposer({
    agentId: "agent-1",
    taskId: "plan-1",
    messages: [],
    send: () => new Promise(ignore),
    onStatus: ignore,
  });
  const [choice, choose] = useState({ model: "anthropic/claude-opus-5.5", effort: "high" });
  return createElement(AgentComposer, {
    ...QUIET_COMPOSER,
    status,
    composer,
    model: { choice, note: undefined, choose },
    models: MODELS,
    context: CONTEXT,
    published: PUBLISHED,
    doors: { openGitHub: ignore, copy: ignore, openChanges: ignore },
  });
}

/** The box drawn on a card `width` pixels wide. */
async function drawnAt(width: number, status: CodingAgentStatus = CODING_AGENT_STATUS.COMPLETED) {
  layContainersAt({ composer: width });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(Box, { status }))),
  );
  const foot =
    container.querySelector<HTMLElement>("form > :last-child") ?? assert.fail("the foot stands");
  return {
    container,
    foot,
    /** The names of the foot's presses as drawn, in order. */
    presses: () =>
      [...foot.querySelectorAll<HTMLButtonElement>("button")]
        .filter(shown)
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    press: (name: string) =>
      foot.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
      assert.fail(`${name} stands`),
  };
}

/** The words inside a press that are drawn. */
function drawnWords(button: HTMLElement, selector: string): boolean {
  const words = button.querySelector(selector) ?? assert.fail(`${selector} stands`);
  return shown(words);
}

test("a card a 720px column wide draws every press and each chip's words, and no ⋯", async () => {
  const box = await drawnAt(CARD.WIDE);
  assert.deepEqual(box.presses(), [
    "Attach files",
    "Pull request #2822, open",
    "Show changes",
    "Opus 5.5 High",
    "MCP servers",
    "Context usage",
    "Dictate",
    "Send",
  ]);
  assert.equal(drawnWords(box.press("Pull request #2822, open"), ".agent-pr-number"), true);
  assert.equal(drawnWords(box.press("Show changes"), ".chip-name"), true);
  assert.equal(drawnWords(box.press("Opus 5.5 High"), ".model-label"), true);
});

test("a card a 480px column wide draws the published chips' marks alone, named still, and keeps every press and the model's words", async () => {
  const box = await drawnAt(CARD.MEDIUM);
  assert.deepEqual(box.presses(), [
    "Attach files",
    "Pull request #2822, open",
    "Show changes",
    "Opus 5.5 High",
    "MCP servers",
    "Context usage",
    "Dictate",
    "Send",
  ]);
  assert.equal(drawnWords(box.press("Pull request #2822, open"), ".agent-pr-number"), false);
  assert.equal(drawnWords(box.press("Show changes"), ".chip-name"), false);
  assert.equal(drawnWords(box.press("Opus 5.5 High"), ".model-label"), true);
});

test("a card a 320px column wide hands the Changes chip, the servers, the ring, and the microphone to a ⋯, and draws the model as its harness's mark, named still", async () => {
  const box = await drawnAt(CARD.NARROW);
  assert.deepEqual(box.presses(), [
    "Attach files",
    "Pull request #2822, open",
    "Opus 5.5 High",
    "More",
    "Send",
  ]);
  const model = box.press("Opus 5.5 High");
  assert.equal(drawnWords(model, ".model-label"), false);
  assert.equal(drawnWords(model, ".harness-mark"), true);
});

test("a card a 220px column wide keeps what the agent published, the model, the ⋯, and Stop while a turn runs, and the ⋯ offers every press it hid", async () => {
  const box = await drawnAt(CARD.NARROWEST, CODING_AGENT_STATUS.RUNNING);
  assert.deepEqual(box.presses(), ["Pull request #2822, open", "Opus 5.5 High", "More", "Stop"]);

  act(() => box.press("More").click());
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  assert.deepEqual(offered, [
    "Attach files",
    "Show changes",
    "MCP servers",
    "62% of context used",
    "Dictate",
  ]);
});

test("the ⋯ offers only what it hid: at 320px the + still stands beside it, so the ⋯ offers no Attach files", async () => {
  const box = await drawnAt(CARD.NARROW);
  act(() => box.press("More").click());
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  assert.deepEqual(offered, ["Show changes", "MCP servers", "62% of context used", "Dictate"]);
});

test("MCP servers chosen from the ⋯ opens the servers popover its hidden press would have, and Escape hands the keyboard back to the ⋯", async () => {
  const box = await drawnAt(CARD.NARROWEST);
  act(() => box.press("More").click());
  const servers = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "MCP servers",
  );
  act(() => servers?.click());

  const popover =
    box.container.querySelector<HTMLElement>(".agent-servers [role='dialog']") ??
    assert.fail("the servers popover stands");
  assert.equal(shown(popover), true);
  const search = popover.querySelector<HTMLInputElement>("input") ?? assert.fail("it searches");
  act(() => search.focus());
  await act(async () => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(box.container.querySelector(".agent-servers [role='dialog']"), null);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "More");
});

test("the ⋯'s menu closes once the card changes width, as a panel dragged narrower would, so it never offers a stale set of presses", async () => {
  const box = await drawnAt(CARD.NARROW);
  const width = vi.spyOn(box.foot, "getBoundingClientRect");
  width.mockReturnValue(DOMRect.fromRect({ width: CARD.NARROW }));
  // What the standing menu offers; a closed one, held drawn while its exit plays, is inert.
  const offered = () =>
    [...document.querySelectorAll('[role="menuitem"]')]
      .filter((item) => item.closest("[inert]") === null)
      .map((item) => item.textContent);
  act(() => box.press("More").click());
  assert.deepEqual(offered(), ["Show changes", "MCP servers", "62% of context used", "Dictate"]);

  // Laid out again at the same width, as a scroll would, it stays.
  act(() => relayout());
  assert.equal(offered().length, 4);

  width.mockReturnValue(DOMRect.fromRect({ width: CARD.NARROWEST }));
  act(() => relayout());
  assert.deepEqual(offered(), []);
});
