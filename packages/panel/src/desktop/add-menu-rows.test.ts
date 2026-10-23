// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { shownFiles } from "@luke/voice/code-pane-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NOTHING_HELD } from "../tasks/agent-ref.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { codingAgentsControl, tasksControl } from "../testing/tasks-control.js";
import { agentEntries } from "./main-tabs.js";
import { type PanelCards, panelEntries } from "./side-panel.js";
import { type AddEntry, AddTabButton } from "./strip-tabs.js";

/**
 * add-menu-rows.test.ts -- the "+" menus of the column and the side panel
 * draw each row's end mark and hang its card, as ⌘K and the task's summary
 * do: a failed agent is marked failed, an agent's and a file's row hang
 * their cards while the pointer rests on them, and a Terminal row wears its
 * agent's failed mark. Synthetic throughout.
 */

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** An agent on the task, named by its title. */
function agent(id: string, title: string, status: CodingAgentSummary["status"]) {
  return {
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status,
    turnId: null,
  } satisfies CodingAgentSummary;
}

const BROKEN = agent("agent-1", "Billing export", CODING_AGENT_STATUS.FAILED);
const HEALTHY = agent("agent-2", "Invoice sweep", CODING_AGENT_STATUS.COMPLETED);

/** A "+" drawn offering `entries`, pressed open; the options it lists, by their names. */
async function opened(entries: readonly AddEntry[]): Promise<Map<string, HTMLElement>> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AddTabButton, {
          label: "Open a tab",
          placeholder: "Search tabs",
          noMatch: "No tabs",
          entries,
          onOpen: undefined,
          asked: false,
          answers: false,
          onAnswered: ignore,
        }),
      ),
    ),
  );
  const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Open a tab"]');
  assert.ok(plus, "the + stands");
  await act(async () => plus.click());
  const named = new Map<string, HTMLElement>();
  for (const option of container.querySelectorAll<HTMLElement>('[role="option"]')) {
    named.set(option.querySelector(".luke-combobox-option-label")?.textContent ?? "", option);
  }
  return named;
}

/** The labels of the marks a row wears at its end. */
function endMarks(option: HTMLElement | undefined): (string | null)[] {
  const end = option?.querySelector(".luke-combobox-option-hint");
  return [...(end?.querySelectorAll("[role='img']") ?? [])].map((mark) =>
    mark.getAttribute("aria-label"),
  );
}

test("a failed agent's row in the column's \"+\" wears the failed mark and a healthy one's wears none, and a row hangs its agent's card while the pointer rests on it", async () => {
  const base = tasksControl();
  const agents = codingAgentsControl({
    agents: [BROKEN, HEALTHY],
    agentIds: [BROKEN.id, HEALTHY.id],
  });
  const options = await opened(agentEntries(base.mainTabs, agents, NOTHING_HELD));

  assert.deepEqual(endMarks(options.get("Billing export")), ["Failed"]);
  assert.deepEqual(endMarks(options.get("Invoice sweep")), []);

  restOn(options.get("Invoice sweep") ?? assert.fail("the agent is listed"));
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Invoice sweep");
});

test("a file's row in the side panel's \"+\" hangs the file's card with Luke's note while the pointer rests on it", async () => {
  const path = "src/invites/accept.ts";
  const note = "A used invite is refused here.";
  const showing: TaskCodeShowing = {
    callId: "c",
    turnId: "t",
    shownAt: 1_000,
    code: {
      ref: { path, startLine: 3, endLine: 5 },
      repository: "acme/relay",
      firstLine: 1,
      lineCount: 9,
      lines: [],
      note,
    },
  };
  const base = tasksControl();
  const cards: PanelCards = {
    agents: codingAgentsControl(),
    held: NOTHING_HELD,
    shown: [showing],
    repository: "acme/relay",
    pagePlace: { taskId: "plan-1" },
    shownAgent: undefined,
    onOpenAgent: ignore,
  };
  const options = await opened(
    panelEntries({ panel: base.sidePanel, kinds: [], files: shownFiles([showing]), cards }),
  );

  restOn(options.get("accept.ts") ?? assert.fail("the file is listed"));
  const card = document.querySelector(".luke-tooltip-card [data-file-card]");
  assert.deepEqual(
    [
      card?.querySelector(".luke-hover-card-name")?.textContent,
      card?.querySelector(".luke-hover-card-note")?.textContent,
    ],
    [path, note],
  );
});

test("a Terminal row in the side panel's \"+\" wears its agent's failed mark, and hangs the agent's card", async () => {
  const base = tasksControl();
  const cards: PanelCards = {
    agents: codingAgentsControl({ agents: [BROKEN], agentIds: [BROKEN.id] }),
    held: NOTHING_HELD,
    shown: [],
    repository: null,
    pagePlace: { taskId: "plan-1" },
    shownAgent: undefined,
    onOpenAgent: ignore,
  };
  const options = await opened(
    panelEntries({
      panel: base.sidePanel,
      kinds: [],
      files: [],
      terminals: {
        offers: [{ agent: BROKEN, label: "Billing export", showsOnChord: false }],
        onNew: ignore,
      },
      cards,
    }),
  );

  const row = options.get("Billing export");
  assert.deepEqual(endMarks(row), ["Failed"]);
  restOn(row ?? assert.fail("the terminal is listed"));
  const card = document.querySelector(".luke-tooltip-card [data-tab-card]");
  assert.equal(card?.querySelector(".luke-hover-card-name")?.textContent, "Billing export");
});
