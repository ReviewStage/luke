// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentRead, CHILD_STATUS, type ChildRead } from "@sidecar/hosted/reads-wire";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { TRANSCRIPT_KIND } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import {
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  FIXTURE_SESSION,
  FIXTURE_TITLE,
  FIXTURE_TURN,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";
import {
  childTranscriptRow,
  SubagentsPanel,
  SubagentTranscriptPanel,
  type TranscriptRow,
  transcriptListed,
} from "./subagents-panel";

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

const AGENT_ID = {
  HELD: "eeeeeeee-5555-4000-8000-000000000005",
  DEPARTED: "ffffffff-6666-4000-8000-000000000006",
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

/** An agent whose session the fixture roster still holds: named by the roster's title, marked by its agent. */
const HELD_AGENT: AgentRead = {
  id: AGENT_ID.HELD,
  providerId: "conductor",
  providerSessionId: FIXTURE_SESSION.HELD,
  status: CHILD_STATUS.RUNNING,
  acceptedAt: NOW - 40 * MINUTE_MS,
  startedAt: NOW - 5 * MINUTE_MS,
};

/** An agent whose session the roster has let go: named by a slice of the session's id, marked by its provider. */
const DEPARTED_AGENT: AgentRead = {
  id: AGENT_ID.DEPARTED,
  providerId: "conductor",
  providerSessionId: FIXTURE_SESSION.DEPARTED,
  status: CHILD_STATUS.SETTLED,
  acceptedAt: NOW - 3 * 24 * 60 * MINUTE_MS,
  startedAt: NOW - 3 * 24 * 60 * MINUTE_MS,
  settledAt: NOW - 3 * 60 * MINUTE_MS,
};

function panelProps(extra: Partial<PanelProps> = {}): PanelProps {
  return {
    subagents: { settled: true, children: [] },
    agents: { settled: true, agents: [] },
    roster: FIXTURE_ROSTER,
    now: NOW,
    onOpenTranscript: () => undefined,
    onBack: () => undefined,
    ...extra,
  };
}

function render(extra: Partial<PanelProps> = {}): string {
  return renderToStaticMarkup(createElement(SubagentsPanel, panelProps(extra)));
}

function renderChildren(children: readonly ChildRead[], settled = true): string {
  return render({ subagents: { settled, children } });
}

function titles(container: ParentNode): string[] {
  return [...container.querySelectorAll(".subagent-name")].map((node) => node.textContent ?? "");
}

function sections(markup: string): Element[] {
  const container = document.createElement("div");
  container.innerHTML = markup;
  return [...container.querySelectorAll(".subagents-section")];
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

test("the list is mounted under the thread's own root, ids and blocked class alike, in two sections", () => {
  const markup = renderChildren([LABELLED]);
  assert.ok(markup.includes('class="conversation-view ph-no-capture"'));
  assert.ok(markup.includes('id="panel-view-conversation"'));
  assert.ok(markup.includes('aria-labelledby="panel-tab-conversation"'));
  assert.ok(markup.includes("‹ Conversation"));
  assert.ok(markup.includes('<h2 class="subagents-title">Sub-agents</h2>'));
  const headings = sections(markup).map(
    (section) => section.querySelector(".subagents-section-title")?.textContent,
  );
  assert.deepEqual(headings, ["Per-workspace agents", "Sub-agents"]);
});

test("sub-agent rows are newest first and each is named by its label, its task without the marker, or its id", () => {
  const [, subagents] = sections(renderChildren([TASKED, LABELLED, BARE]));
  assert.ok(subagents);
  assert.deepEqual(titles(subagents), [
    "Child cccccccc",
    "Audit the release notes",
    "Rename the roster helper.",
  ]);
  assert.ok(!subagents.textContent?.includes("[subagent task]"));
});

test("each sub-agent row wears its status word, its age, and where it was delegated from", () => {
  const [, subagents] = sections(renderChildren([LABELLED, TASKED, BARE, OBSERVED]));
  assert.ok(subagents);
  const rows = [...subagents.querySelectorAll(".subagent-row")];
  const words = rows.map((row) => row.querySelector(".subagent-status")?.textContent);
  assert.deepEqual(words, ["Waiting", "Running", "Done", "Failed"]);
  const ages = rows.map((row) => row.querySelector(".subagent-age")?.textContent);
  assert.deepEqual(ages, ["10m", "25m", "2h", "2d"]);
  const origins = rows.map((row) => row.querySelector(".subagent-origin")?.textContent);
  assert.deepEqual(origins, [undefined, undefined, undefined, "from an observed session"]);
  // No sub-agent row wears a provider mark: a child is the brain's own, not a session's.
  assert.equal(subagents.querySelector(".subagent-mark"), null);
});

test("a cancelled child says so", () => {
  const markup = renderChildren([{ ...BARE, status: CHILD_STATUS.CANCELLED }]);
  assert.ok(markup.includes(">Cancelled<"));
});

test("a per-workspace agent row is named from the roster by session identity, marked by its agent, and falls back to the session's id", () => {
  const [agents] = sections(
    render({ agents: { settled: true, agents: [HELD_AGENT, DEPARTED_AGENT] } }),
  );
  assert.ok(agents);
  // The service's order is kept: it lists the latest turn first.
  assert.deepEqual(titles(agents), [FIXTURE_TITLE.HELD, "Session 8e3b4c36"]);
  const rows = [...agents.querySelectorAll(".subagent-row")];
  assert.deepEqual(
    rows.map((row) => row.querySelector(".subagent-status")?.textContent),
    ["Running", "Done"],
  );
  assert.deepEqual(
    rows.map((row) => row.querySelector(".subagent-age")?.textContent),
    ["5m", "3h"],
  );
  // Every agent row leads with a mark: the roster's agent while it holds the session, the provider once it has let go.
  assert.equal(agents.querySelectorAll(".subagent-mark").length, 2);
  // A roster that never held the session names it the same way.
  const [alone] = sections(render({ roster: [], agents: { settled: true, agents: [HELD_AGENT] } }));
  assert.deepEqual(titles(alone ?? document.createElement("div")), ["Session 6c1f2f14"]);
});

test("each read section with nothing says so, and an unread one says nothing", () => {
  const both = render();
  assert.ok(both.includes("No per-workspace agents yet"));
  assert.ok(both.includes("No sub-agents yet"));
  const unread = render({
    subagents: { settled: false, children: [] },
    agents: { settled: false, agents: [] },
  });
  assert.ok(!unread.includes("No per-workspace agents yet"));
  assert.ok(!unread.includes("No sub-agents yet"));
  // The sections stand apart: one read and empty says so while the other holds rows.
  const mixed = render({ agents: { settled: true, agents: [HELD_AGENT] } });
  assert.ok(!mixed.includes("No per-workspace agents yet"));
  assert.ok(mixed.includes("No sub-agents yet"));
});

test("pressing a row of either kind opens its transcript, named as the row is", () => {
  const opened: TranscriptRow[] = [];
  const container = mount(
    panelProps({
      subagents: { settled: true, children: [LABELLED, BARE] },
      agents: { settled: true, agents: [DEPARTED_AGENT] },
      onOpenTranscript: (row) => opened.push(row),
    }),
  );
  // The agent leads the page; the sub-agents follow newest first, so the bare child comes before the labelled one.
  const rows = [...container.querySelectorAll(".subagent-row")];
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(row instanceof HTMLButtonElement);
    act(() => {
      row.click();
    });
  }
  assert.deepEqual(opened, [
    {
      conversationId: AGENT_ID.DEPARTED,
      kind: TRANSCRIPT_KIND.OBSERVED,
      title: "Session 8e3b4c36",
      status: CHILD_STATUS.SETTLED,
    },
    childTranscriptRow(BARE),
    childTranscriptRow(LABELLED),
  ]);
  assert.deepEqual(childTranscriptRow(LABELLED), {
    conversationId: CHILD_ID.LABELLED,
    kind: TRANSCRIPT_KIND.CHILD,
    title: "Audit the release notes",
    status: CHILD_STATUS.RUNNING,
  });
});

test("the back control returns to the thread", () => {
  let backs = 0;
  const container = mount(
    panelProps({
      onBack: () => {
        backs += 1;
      },
    }),
  );
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

const OPEN_CHILD = childTranscriptRow(LABELLED);

const OPEN_AGENT: TranscriptRow = {
  conversationId: AGENT_ID.HELD,
  kind: TRANSCRIPT_KIND.OBSERVED,
  title: FIXTURE_TITLE.HELD,
  status: CHILD_STATUS.RUNNING,
};

function renderTranscript(extra: Partial<TranscriptProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SubagentTranscriptPanel, {
      open: OPEN_CHILD,
      transcript: undefined,
      roster: FIXTURE_ROSTER,
      now: FIXTURE_NOW,
      onOpenChat: () => undefined,
      onBack: () => undefined,
      ...extra,
    }),
  );
}

test("the transcript page stands under the thread's own root and names the way back, the row's title, and its status", () => {
  const markup = renderTranscript();
  assert.ok(markup.includes('class="conversation-view ph-no-capture"'));
  assert.ok(markup.includes('id="panel-view-conversation"'));
  assert.ok(markup.includes("‹ Sub-agents"));
  assert.ok(markup.includes(">Audit the release notes</h2>"));
  assert.ok(markup.includes(">Running</span>"));
  // An agent's page wears the row's words the same way, looked up nowhere.
  const agent = renderTranscript({ open: { ...OPEN_AGENT, status: CHILD_STATUS.SETTLED } });
  assert.ok(agent.includes(`>${FIXTURE_TITLE.HELD}</h2>`));
  assert.ok(agent.includes(">Done</span>"));
});

test("the turns of either kind are drawn as the thread draws its own, under the same scroll scaffolding", () => {
  for (const [open, kind] of [
    [OPEN_CHILD, TRANSCRIPT_KIND.CHILD],
    [OPEN_AGENT, TRANSCRIPT_KIND.OBSERVED],
  ] as const) {
    const markup = renderTranscript({
      open,
      transcript: { conversationId: open.conversationId, kind, settled: true, groups: SINGLE_TURN },
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
  }
});

test("a transcript not yet read draws the empty scroller, and one read with nothing says so", () => {
  const child = { conversationId: OPEN_CHILD.conversationId, kind: TRANSCRIPT_KIND.CHILD };
  const unread = renderTranscript({ transcript: { ...child, settled: false, groups: [] } });
  assert.ok(unread.includes('class="conversation-scroll"'));
  assert.ok(!unread.includes("Nothing said yet"));
  assert.ok(!renderTranscript().includes("Nothing said yet"));
  // Another conversation's transcript still standing is not this page's, read
  // or not; nor is this conversation's under another kind.
  for (const transcript of [
    { conversationId: AGENT_ID.HELD, kind: TRANSCRIPT_KIND.OBSERVED },
    { conversationId: OPEN_CHILD.conversationId, kind: TRANSCRIPT_KIND.OBSERVED },
  ]) {
    const other = renderTranscript({
      transcript: { ...transcript, settled: true, groups: SINGLE_TURN },
    });
    assert.ok(other.includes('class="conversation-scroll"'));
    assert.ok(!other.includes('<ol class="conversation-list">'));
    assert.ok(!other.includes("Nothing said yet"));
  }
  const empty = renderTranscript({ transcript: { ...child, settled: true, groups: [] } });
  assert.ok(empty.includes("Nothing said yet"));
  assert.ok(!empty.includes('class="conversation-scroll"'));
});

test("a row the host could not read back is said under the transcript, as it is under the thread", () => {
  const child = { conversationId: OPEN_CHILD.conversationId, kind: TRANSCRIPT_KIND.CHILD };
  const unreadable = { conversationId: "3c000000-0000-4000-8000-000000000001", seq: 4 };
  const partial = renderTranscript({
    transcript: { ...child, settled: true, groups: SINGLE_TURN, unreadable },
  });
  assert.ok(partial.includes('<ol class="conversation-list">'));
  assert.ok(partial.includes("Part of the conversation could not be read."));
  // Read with nothing readable: the notice stands under the empty room, as it does under the thread's.
  const nothing = renderTranscript({
    transcript: { ...child, settled: true, groups: [], unreadable },
  });
  assert.ok(nothing.includes("Nothing said yet"));
  assert.ok(nothing.includes("Part of the conversation could not be read."));
  assert.ok(!renderTranscript().includes("Part of the conversation could not be read."));
});

test("a transcript page follows only the list of its own kind: unread says nothing, unlisted says gone, the other list has no say", () => {
  const children = { settled: true, children: [LABELLED] };
  const agents = { settled: true, agents: [HELD_AGENT] };
  const none = { settled: true, children: [] };
  const noAgents = { settled: true, agents: [] };
  assert.equal(transcriptListed(OPEN_CHILD, children, agents), true);
  assert.equal(transcriptListed(OPEN_AGENT, children, agents), true);
  // Each kind reads its own list, and the other list emptying changes nothing for it.
  assert.equal(transcriptListed(OPEN_CHILD, children, noAgents), true);
  assert.equal(transcriptListed(OPEN_AGENT, none, agents), true);
  assert.equal(transcriptListed(OPEN_CHILD, none, agents), false);
  assert.equal(transcriptListed(OPEN_AGENT, children, noAgents), false);
  // An unread list names nothing yet, so it neither keeps nor evicts.
  assert.equal(transcriptListed(OPEN_CHILD, { settled: false, children: [] }, agents), undefined);
  assert.equal(transcriptListed(OPEN_AGENT, children, { settled: false, agents: [] }), undefined);
  // The same id under another kind is looked for in that kind's list alone.
  const asAgent = { ...OPEN_CHILD, kind: TRANSCRIPT_KIND.OBSERVED };
  assert.equal(transcriptListed(asAgent, children, agents), false);
});

test("the transcript's back control returns to the list", () => {
  let backs = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(SubagentTranscriptPanel, {
        open: OPEN_CHILD,
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
