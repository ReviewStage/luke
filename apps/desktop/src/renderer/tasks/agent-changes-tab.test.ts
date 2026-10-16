// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHANGED_FILE_STATUS,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import { codingAgentsControl } from "#testing/tasks-control";
import type { DiffViewModule, DiffViewProps } from "../diff-view/contract";

/**
 * agent-changes-tab.test.ts -- a Files changed view hands the diff bundle
 * each file's patch, headed as git writes one, and how the File tabs'
 * settings draw it: unified with its changed words marked until told
 * otherwise, split once Split view is chosen in its ⋯, tinted whole once
 * Highlight changed words is turned off, each choice kept for the next
 * view; a diff too narrow to split is drawn unified, Split view dimmed, the
 * choice kept for a wider one. A kept setting that no longer reads costs
 * none of the others. The bundle, a script of its own the panel loads, is
 * stood in for at its global, which records what it was handed. Synthetic
 * files only.
 */

const AGENT: CodingAgentSummary = {
  id: "1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d2c",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Seat limit",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const PATCH = [
  "@@ -1,2 +1,3 @@",
  " const kept = true;",
  "-const seats = 3;",
  "+const seats = 42;",
  "+const extra = 1;",
].join("\n");

const control = codingAgentsControl({
  agents: [AGENT],
  agentIds: [AGENT.id],
  models: [],
  readChanges: () =>
    Promise.resolve({
      pullRequest: {
        url: "https://github.com/acme/relay/pull/7",
        truncated: false,
        files: [
          {
            path: "src/seats.ts",
            previousPath: null,
            status: CHANGED_FILE_STATUS.MODIFIED,
            additions: 2,
            deletions: 1,
            omitted: null,
            patch: PATCH,
          },
        ],
        reviewers: [],
        commitAuthors: [],
        comments: [],
      },
    }),
});

/** What the stand-in bundle was handed, mount first, each draw after it. */
let drawn: DiffViewProps[] = [];
/** How wide the box the diff is drawn in lays out, in pixels. */
let boxWidth = 900;
let root: Root | undefined;

const standIn: DiffViewModule = {
  mount: (_host, props) => {
    drawn.push(props);
    return { update: (next) => drawn.push(next), unmount: () => undefined };
  },
};

beforeEach(() => {
  // Note that the settings are held by their module for the window's life, so each test loads it afresh.
  vi.resetModules();
  window.localStorage.clear();
  drawn = [];
  boxWidth = 900;
  window.lukeDiffView = standIn;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains("diff-view") ? boxWidth : 0;
    return new DOMRect(0, 0, width, 0);
  });
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      recordSurfaceEvent: () => undefined,
      act: () =>
        Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not in this test." }),
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete window.lukeDiffView;
  vi.restoreAllMocks();
});

/** Draws the agent's Files changed view, its read landed, and answers what the diff was last drawn with. */
async function drawTab(): Promise<DiffViewProps> {
  const { AgentChangesTab } = await import("./agent-changes-tab");
  act(() => root?.unmount());
  document.body.innerHTML = "";
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentChangesTab, {
          agentId: AGENT.id,
          control,
          shown: true,
          repository: "acme/relay",
          tree: { open: false, onToggle: () => undefined },
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return lastDrawn();
}

function lastDrawn(): DiffViewProps {
  return drawn.at(-1) ?? assert.fail("the diff is drawn");
}

/** The ⋯'s item of a label, the menu opened. */
function menuItem(label: string): HTMLButtonElement {
  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
    (each) => each.textContent?.includes(label),
  );
  return item ?? assert.fail(`the ⋯ offers ${label}`);
}

/** Chooses a setting in the view's ⋯. */
function choose(label: string): void {
  const item = menuItem(label);
  act(() => item.click());
}

/** How a diff is drawn until told otherwise: today's File tab look, and stage-cli's for what is new. */
const DEFAULT_LOOK = {
  layout: "unified",
  indicators: "bars",
  inlineDiff: "word-alt",
  backgrounds: true,
  lineNumbers: true,
  wrap: true,
  themes: { dark: "github-dark-default", light: "github-light-default" },
  font: "sf-mono",
  fontSize: "11.5",
  lineHeight: "normal",
  ligatures: false,
};

/** Opens the bar's diff settings, answering the popover. */
function openSettings(): HTMLElement {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Diff settings"]');
  act(() => button?.click());
  return (
    document.querySelector<HTMLElement>('[role="dialog"][aria-label="Diff settings"]') ??
    assert.fail("the diff settings open")
  );
}

/** The popover's control of a name: a segment by its words, or a switch by its label. */
function settingControl(popover: HTMLElement, selector: string, name: string): HTMLButtonElement {
  const found = [...popover.querySelectorAll<HTMLButtonElement>(selector)].find(
    (each) => each.textContent === name || each.getAttribute("aria-label") === name,
  );
  return found ?? assert.fail(`the settings offer ${name}`);
}

test("a diff is handed over whole as git writes it, drawn as today's File tab look until told otherwise", async () => {
  const props = await drawTab();

  assert.equal(
    props.patch,
    `diff --git a/src/seats.ts b/src/seats.ts\n--- a/src/seats.ts\n+++ b/src/seats.ts\n${PATCH}\n`,
  );
  assert.deepEqual(props.look, DEFAULT_LOOK);
});

test("the diff settings set the layout, the indicators, and a switch for every diff, kept for the next view", async () => {
  await drawTab();
  const popover = openSettings();

  act(() => settingControl(popover, '[role="radio"]', "Split").click());
  act(() => settingControl(popover, '[role="radio"]', "Classic (+/-)").click());
  act(() => settingControl(popover, '[role="switch"]', "Ligatures").click());
  act(() => settingControl(popover, '[role="switch"]', "Backgrounds").click());

  const expected = {
    ...DEFAULT_LOOK,
    layout: "split",
    indicators: "classic",
    ligatures: true,
    backgrounds: false,
  };
  assert.deepEqual(lastDrawn().look, expected);
  assert.deepEqual((await drawTab()).look, expected);
});

test("Split view draws the diff side by side, which the next view keeps", async () => {
  await drawTab();

  choose("Split view");
  assert.equal(lastDrawn().look.layout, "split");

  assert.equal((await drawTab()).look.layout, "split");
});

test("with Highlight changed words turned off a changed line is tinted whole, for this view and the next", async () => {
  await drawTab();

  choose("Highlight changed words");
  assert.equal(lastDrawn().look.inlineDiff, "none");

  assert.equal((await drawTab()).look.inlineDiff, "none");
});

test("a diff too narrow to split is drawn unified with Split view dimmed and its settings saying so, and split again once there is room", async () => {
  window.localStorage.setItem("luke.file-view", JSON.stringify({ diffLayout: "split" }));
  await drawTab();
  assert.equal(lastDrawn().look.layout, "split");

  boxWidth = 480;
  act(() => relayout());
  assert.equal(lastDrawn().look.layout, "unified");
  const item = menuItem("Split view");
  assert.equal(item.getAttribute("aria-disabled") ?? String(item.disabled), "true");
  assert.equal(item.getAttribute("aria-checked"), "false");
  act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  assert.match(openSettings().textContent ?? "", /Needs a wider panel/u);

  boxWidth = 900;
  act(() => relayout());
  assert.equal(lastDrawn().look.layout, "split");
});

test("a kept setting that no longer reads takes its default and leaves the others as they were kept", async () => {
  window.localStorage.setItem(
    "luke.file-view",
    JSON.stringify({
      lineNumbers: false,
      wordWrap: false,
      diffLayout: "sideways",
      darkTheme: "dracula",
      lightTheme: "dracula",
      diffFontSize: "11.5",
    }),
  );

  const { look } = await drawTab();

  assert.deepEqual(look, {
    ...DEFAULT_LOOK,
    lineNumbers: false,
    wrap: false,
    themes: { dark: "dracula", light: "github-light-default" },
  });
});
