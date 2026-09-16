// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHILD_STATUS, type ChildRead } from "@sidecar/hosted/reads-wire";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import { SubagentsPanel } from "./subagents-panel";

type PanelProps = Parameters<typeof SubagentsPanel>[0];

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const MINUTE_MS = 60_000;
const PARENT = "7a1b2c3d-0000-4000-8000-000000000001";

const CHILD_ID = {
  LABELLED: "aaaaaaaa-1111-4000-8000-000000000001",
  TASKED: "bbbbbbbb-2222-4000-8000-000000000002",
  BARE: "cccccccc-3333-4000-8000-000000000003",
  OBSERVED: "dddddddd-4444-4000-8000-000000000004",
} as const;

const LABELLED: ChildRead = {
  id: CHILD_ID.LABELLED,
  parentConversationId: PARENT,
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  label: "Audit the release notes",
  task: "[subagent task] Read every note and flag the stale ones.",
  status: CHILD_STATUS.RUNNING,
  acceptedAt: NOW - 30 * MINUTE_MS,
  startedAt: NOW - 25 * MINUTE_MS,
};

const TASKED: ChildRead = {
  id: CHILD_ID.TASKED,
  parentConversationId: PARENT,
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  task: "[subagent task] Rename the roster helper.",
  status: CHILD_STATUS.SETTLED,
  acceptedAt: NOW - 3 * 60 * MINUTE_MS,
  startedAt: NOW - 3 * 60 * MINUTE_MS,
  settledAt: NOW - 2 * 60 * MINUTE_MS,
};

const BARE: ChildRead = {
  id: CHILD_ID.BARE,
  parentConversationId: PARENT,
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  status: CHILD_STATUS.ACCEPTED,
  acceptedAt: NOW - 10 * MINUTE_MS,
};

const OBSERVED: ChildRead = {
  id: CHILD_ID.OBSERVED,
  parentConversationId: PARENT,
  parentKind: CONVERSATION_VIEW_SOURCE.OBSERVED,
  task: "Summarise the failing test.",
  status: CHILD_STATUS.FAILED,
  acceptedAt: NOW - 2 * 24 * 60 * MINUTE_MS,
  settledAt: NOW - 2 * 24 * 60 * MINUTE_MS,
  failure: "The provider refused the read.",
};

function render(children: readonly ChildRead[], settled = true): string {
  return renderToStaticMarkup(
    createElement(SubagentsPanel, {
      subagents: { settled, children },
      now: NOW,
      onOpenChild: () => undefined,
      onBack: () => undefined,
    }),
  );
}

function titles(container: ParentNode): string[] {
  return [...container.querySelectorAll(".subagent-title")].map((node) => node.textContent ?? "");
}

function mount(props: PanelProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(SubagentsPanel, props));
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the list is mounted under the thread's own root, ids and blocked class alike", () => {
  const markup = render([LABELLED]);
  assert.ok(markup.includes('class="conversation-view ph-no-capture"'));
  assert.ok(markup.includes('id="panel-view-conversation"'));
  assert.ok(markup.includes('aria-labelledby="panel-tab-conversation"'));
  assert.ok(markup.includes("‹ Conversation"));
  assert.ok(markup.includes('<h2 class="subagents-title">Sub-agents</h2>'));
});

test("rows are newest first and each is named by its label, its task without the marker, or its id", () => {
  const container = document.createElement("div");
  container.innerHTML = render([TASKED, LABELLED, BARE]);
  assert.deepEqual(titles(container), [
    "Child cccccccc",
    "Audit the release notes",
    "Rename the roster helper.",
  ]);
  assert.ok(!container.textContent?.includes("[subagent task]"));
});

test("each row wears its status word, its age, and where it was delegated from", () => {
  const container = document.createElement("div");
  container.innerHTML = render([LABELLED, TASKED, BARE, OBSERVED]);
  const rows = [...container.querySelectorAll(".subagent-row")];
  const words = rows.map((row) => row.querySelector(".subagent-status")?.textContent);
  assert.deepEqual(words, ["Waiting", "Running", "Done", "Failed"]);
  const ages = rows.map((row) => row.querySelector(".subagent-age")?.textContent);
  assert.deepEqual(ages, ["10m", "25m", "2h", "2d"]);
  const origins = rows.map((row) => row.querySelector(".subagent-origin")?.textContent);
  assert.deepEqual(origins, [undefined, undefined, undefined, "from an observed session"]);
});

test("a cancelled child says so", () => {
  const markup = render([{ ...BARE, status: CHILD_STATUS.CANCELLED }]);
  assert.ok(markup.includes(">Cancelled<"));
});

test("a read list with no children says so, and an unread one says nothing", () => {
  assert.ok(render([]).includes("No sub-agents yet"));
  assert.ok(!render([], false).includes("No sub-agents yet"));
});

test("pressing a row opens the child's transcript and marks the row pressed", () => {
  const opened: string[] = [];
  const container = mount({
    subagents: { settled: true, children: [LABELLED, BARE] },
    now: NOW,
    onOpenChild: (childId) => opened.push(childId),
    onBack: () => undefined,
  });
  const rows = [...container.querySelectorAll(".subagent-row")];
  assert.deepEqual(
    rows.map((row) => row.getAttribute("aria-pressed")),
    ["false", "false"],
  );
  // Newest first, so the bare child leads.
  const bare = rows[0];
  assert.ok(bare instanceof HTMLButtonElement);
  act(() => {
    bare.click();
  });
  assert.deepEqual(opened, [CHILD_ID.BARE]);
  assert.deepEqual(
    [...container.querySelectorAll(".subagent-row")].map((row) => row.getAttribute("aria-pressed")),
    ["true", "false"],
  );
});

test("the back control returns to the thread", () => {
  let backs = 0;
  const container = mount({
    subagents: { settled: true, children: [] },
    now: NOW,
    onOpenChild: () => undefined,
    onBack: () => {
      backs += 1;
    },
  });
  const back = container.querySelector(".subagents-back");
  assert.ok(back instanceof HTMLButtonElement);
  act(() => {
    back.click();
  });
  assert.equal(backs, 1);
});
