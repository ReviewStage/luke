// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHILD_STATUS, type ChildRead } from "@sidecar/hosted/reads-wire";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import {
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  FIXTURE_TURN,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";
import { SubagentsPanel, SubagentTranscriptPanel } from "./subagents-panel";

type PanelProps = Parameters<typeof SubagentsPanel>[0];
type TranscriptProps = Parameters<typeof SubagentTranscriptPanel>[0];

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

test("pressing a row opens the child's transcript", () => {
  const opened: string[] = [];
  const container = mount({
    subagents: { settled: true, children: [LABELLED, BARE] },
    now: NOW,
    onOpenChild: (childId) => opened.push(childId),
    onBack: () => undefined,
  });
  // Newest first, so the bare child leads.
  const bare = container.querySelector(".subagent-row");
  assert.ok(bare instanceof HTMLButtonElement);
  act(() => {
    bare.click();
  });
  assert.deepEqual(opened, [CHILD_ID.BARE]);
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

const SINGLE_TURN = fixtureConversationTurns().filter(
  (group) => group.turnId === FIXTURE_TURN.SINGLE,
);

function renderTranscript(extra: Partial<TranscriptProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SubagentTranscriptPanel, {
      childId: CHILD_ID.LABELLED,
      subagents: { settled: true, children: [LABELLED, BARE] },
      transcript: undefined,
      roster: FIXTURE_ROSTER,
      now: FIXTURE_NOW,
      onOpenChat: () => undefined,
      onBack: () => undefined,
      ...extra,
    }),
  );
}

test("the transcript page stands under the thread's own root and names the way back, the child, and its status", () => {
  const markup = renderTranscript();
  assert.ok(markup.includes('class="conversation-view ph-no-capture"'));
  assert.ok(markup.includes('id="panel-view-conversation"'));
  assert.ok(markup.includes("‹ Sub-agents"));
  assert.ok(markup.includes(">Audit the release notes</h2>"));
  assert.ok(markup.includes(">Running</span>"));
  // A child the list no longer names is still named, by its id, and stands nowhere.
  const gone = renderTranscript({ childId: CHILD_ID.TASKED });
  assert.ok(gone.includes(">Child bbbbbbbb</h2>"));
  assert.ok(!gone.includes('class="subagent-status"'));
});

test("the child's turns are drawn as the thread draws its own, under the same scroll scaffolding", () => {
  const markup = renderTranscript({
    transcript: { childId: CHILD_ID.LABELLED, settled: true, groups: SINGLE_TURN },
  });
  const scroll = markup.indexOf('class="conversation-scroll"');
  const pull = markup.indexOf('class="conversation-pull"');
  const list = markup.indexOf('<ol class="conversation-list">');
  assert.ok(scroll >= 0 && pull > scroll && list > pull);
  assert.ok(markup.includes("conversation-action-chip"));
  // Nothing of the thread's own is copied: no line still being said, no place held.
  assert.ok(!markup.includes('data-streaming="true"'));
  assert.ok(!markup.includes("conversation-listening"));
  assert.ok(!markup.includes("Nothing said yet"));
});

test("a transcript not yet read draws the empty scroller, and one read with nothing says so", () => {
  const unread = renderTranscript({
    transcript: { childId: CHILD_ID.LABELLED, settled: false, groups: [] },
  });
  assert.ok(unread.includes('class="conversation-scroll"'));
  assert.ok(!unread.includes("Nothing said yet"));
  assert.ok(!renderTranscript().includes("Nothing said yet"));
  // Another child's transcript still standing is not this page's, read or not.
  const other = renderTranscript({
    transcript: { childId: CHILD_ID.BARE, settled: true, groups: SINGLE_TURN },
  });
  assert.ok(other.includes('class="conversation-scroll"'));
  assert.ok(!other.includes('<ol class="conversation-list">'));
  assert.ok(!other.includes("Nothing said yet"));
  const empty = renderTranscript({
    transcript: { childId: CHILD_ID.LABELLED, settled: true, groups: [] },
  });
  assert.ok(empty.includes("Nothing said yet"));
  assert.ok(!empty.includes('class="conversation-scroll"'));
});

test("a row the host could not read back is said under the transcript, as it is under the thread", () => {
  const unreadable = { conversationId: "3c000000-0000-4000-8000-000000000001", seq: 4 };
  const partial = renderTranscript({
    transcript: { childId: CHILD_ID.LABELLED, settled: true, groups: SINGLE_TURN, unreadable },
  });
  assert.ok(partial.includes('<ol class="conversation-list">'));
  assert.ok(partial.includes("Part of the conversation could not be read."));
  // Read with nothing readable: the notice stands under the empty room, as it does under the thread's.
  const nothing = renderTranscript({
    transcript: { childId: CHILD_ID.LABELLED, settled: true, groups: [], unreadable },
  });
  assert.ok(nothing.includes("Nothing said yet"));
  assert.ok(nothing.includes("Part of the conversation could not be read."));
  assert.ok(!renderTranscript().includes("Part of the conversation could not be read."));
});

test("the transcript's back control returns to the list", () => {
  let backs = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(SubagentTranscriptPanel, {
        childId: CHILD_ID.LABELLED,
        subagents: { settled: true, children: [LABELLED] },
        transcript: undefined,
        roster: [],
        now: NOW,
        onOpenChat: () => undefined,
        onBack: () => {
          backs += 1;
        },
      }),
    );
  });
  const back = container.querySelector(".subagents-back");
  assert.ok(back instanceof HTMLButtonElement);
  act(() => {
    back.click();
  });
  assert.equal(backs, 1);
});
