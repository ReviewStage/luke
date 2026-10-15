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
import { codingAgentsControl } from "#testing/plans-control";

/**
 * agent-changes-tab.test.ts -- a Changes tab draws its diff as the File
 * tabs' settings say: unified with the words a changed line changed marked
 * until told otherwise, side by side once Split view is chosen in its ⋯, a
 * changed line tinted whole once Highlight changed words is turned off, and
 * each choice kept for the next tab. A choice kept before the diff's own
 * settings were offered keeps its numbers and wrap. Synthetic files only.
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
      },
    }),
});

let root: Root | undefined;

beforeEach(() => {
  // Note that the settings are held by their module for the window's life, so each test loads it afresh.
  vi.resetModules();
  window.localStorage.clear();
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
});

/** Draws the agent's Changes tab, its read landed, and answers the diff's lines. */
async function drawTab(): Promise<HTMLElement> {
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
  return (
    container.querySelector<HTMLElement>(".file-tab-lines") ?? assert.fail("the diff is drawn")
  );
}

/** Chooses a setting in the tab's ⋯. */
function choose(label: string): void {
  const options = document.querySelector<HTMLButtonElement>('button[aria-label="Changes actions"]');
  act(() => options?.click());
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find(
    (each) => each.textContent?.includes(label),
  );
  assert.ok(item, `the ⋯ offers ${label}`);
  act(() => item.click());
}

/** The words marked as changed, in the order drawn. */
function marked(lines: HTMLElement): readonly (string | null)[] {
  return [...lines.querySelectorAll("mark.code-diff-word")].map((mark) => mark.textContent);
}

test("a diff is drawn unified with its changed words marked, then side by side once Split view is chosen, which the next tab keeps", async () => {
  const unified = await drawTab();
  assert.equal(unified.getAttribute("data-diff-layout"), "unified");
  assert.deepEqual(marked(unified), ["3", "42"]);

  choose("Split view");
  const split =
    document.querySelector<HTMLElement>(".file-tab-lines") ?? assert.fail("the diff stands");
  assert.equal(split.getAttribute("data-diff-layout"), "split");
  assert.deepEqual(
    [...split.querySelectorAll(".diff-split-row")].map((row) =>
      [...row.querySelectorAll(".diff-split-side")].map((side) => [
        side.getAttribute("data-diff"),
        side.querySelector(".code-line-number")?.textContent,
        side.querySelector(".code-line-text")?.textContent,
      ]),
    ),
    [
      [
        ["context", "1", "const kept = true;"],
        ["context", "1", "const kept = true;"],
      ],
      [
        ["removed", "2", "const seats = 3;"],
        ["added", "2", "const seats = 42;"],
      ],
      [
        ["empty", "", ""],
        ["added", "3", "const extra = 1;"],
      ],
    ],
  );
  assert.deepEqual(marked(split), ["3", "42"]);

  const again = await drawTab();
  assert.equal(again.getAttribute("data-diff-layout"), "split");
});

test("with Highlight changed words turned off a changed line is tinted whole, for this tab and the next", async () => {
  await drawTab();
  choose("Highlight changed words");
  const whole =
    document.querySelector<HTMLElement>(".file-tab-lines") ?? assert.fail("the diff stands");
  assert.deepEqual(marked(whole), []);
  assert.match(whole.textContent ?? "", /const seats = 3;.*const seats = 42;/u);

  assert.deepEqual(marked(await drawTab()), []);
});

test("a choice kept before the diff's own settings were offered keeps its numbers and wrap, the diff unified", async () => {
  window.localStorage.setItem(
    "luke.file-view",
    JSON.stringify({ lineNumbers: false, wordWrap: false }),
  );

  const lines = await drawTab();

  assert.equal(lines.getAttribute("data-line-numbers"), "false");
  assert.equal(lines.getAttribute("data-wrap"), "false");
  assert.equal(lines.getAttribute("data-diff-layout"), "unified");
});
