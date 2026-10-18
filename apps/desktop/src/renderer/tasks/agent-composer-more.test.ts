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
import {
  editorBundleLanded,
  installEditorLayout,
  QUIET_COMPOSER,
} from "@luke/panel/testing/composer";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { relayout } from "@luke/panel/testing/resize-observer";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { layContainersAt, shown } from "#testing/container-width";
import { AgentComposer } from "./agent-composer";
import { useAgentComposer } from "./use-agent-composer";

/**
 * The agent's message box on a card too narrow for every press: the ⋯
 * offers each press the card had no room for, a popover it opens standing
 * as its own press would have opened it, and it closes once the card changes
 * width. jsdom lays nothing out, so each width is the stylesheets' container
 * queries resolved for a card that wide (`#testing/container-width`).
 * Synthetic throughout.
 */

/** The card's width under a column or a panel this wide, less the composer's inset either side. */
const CARD = {
  /** A 220px column, the side panel dragged wide. */
  NARROWEST: 178,
  /** A 320px column. */
  NARROW: 278,
  /** The main column of a wide window. */
  WIDE: 720,
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

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

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

/** An agent's box with everything its foot can carry: a pull request, a model, and a step's context. */
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
    doors: { openGitHub: ignore, copy: ignore },
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
    press: (name: string) =>
      foot.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ??
      assert.fail(`${name} stands`),
  };
}

test("at 220px wide, while a turn runs, the ⋯ offers every press it hid", async () => {
  const box = await drawnAt(CARD.NARROWEST, CODING_AGENT_STATUS.RUNNING);
  act(() => box.press("More").click());
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  assert.deepEqual(offered, ["Attach files", "MCP servers", "62% of context used", "Dictate"]);
});

test("the ⋯ offers only what it hid: at 320px the + still stands beside it, so the ⋯ offers no Attach files", async () => {
  const box = await drawnAt(CARD.NARROW);
  act(() => box.press("More").click());
  const offered = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  assert.deepEqual(offered, ["MCP servers", "62% of context used", "Dictate"]);
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
  assert.deepEqual(offered(), ["MCP servers", "62% of context used", "Dictate"]);

  // Laid out again at the same width, as a scroll would, it stays.
  act(() => relayout());
  assert.equal(offered().length, 3);

  width.mockReturnValue(DOMRect.fromRect({ width: CARD.NARROWEST }));
  act(() => relayout());
  assert.deepEqual(offered(), []);
});

test("a card too narrow for the model's words has its chip draw the harness's mark in their place, and one widened draws the words alone again", async () => {
  // Note that the card's form is given a width as the window would lay it, since jsdom lays out nothing.
  const laid = vi.spyOn(HTMLFormElement.prototype, "clientWidth", "get");
  laid.mockReturnValue(CARD.NARROW);
  const box = await drawnAt(CARD.NARROW);
  const model = () =>
    box.container.querySelector<HTMLButtonElement>(".agent-model-chip button") ??
    assert.fail("the model chip stands");
  assert.equal(model().getAttribute("aria-label"), "Opus 5.5 High");
  assert.notEqual(model().querySelector(".harness-mark"), null);

  laid.mockReturnValue(CARD.WIDE);
  act(() => relayout());
  assert.equal(model().querySelector(".harness-mark"), null);
});
