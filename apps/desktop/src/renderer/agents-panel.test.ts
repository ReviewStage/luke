// @vitest-environment jsdom

import assert from "node:assert/strict";
import { type AgentRead, CHILD_STATUS, type ChildRead } from "@sidecar/hosted/reads-wire";
import { ProviderMark } from "@sidecar/panel";
import { CONVERSATION_VIEW_SOURCE, type SessionIdentity } from "@sidecar/session";
import { TRANSCRIPT_KIND } from "@sidecar/wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import {
  AgentsPanel,
  AgentTranscriptPanel,
  CONVERSATION_PAGE,
  childTranscriptRow,
  conversationSearchable,
  ownTranscript,
  type TranscriptRow,
  transcriptListed,
} from "./agents-panel";
import { CONVERSATION_SEARCH_INPUT_ID, searchConversation } from "./conversation-search";
import { CONVERSATION_MESSAGE_ATTRIBUTE, conversationSearchEntries } from "./conversation-turns";
import {
  FIXTURE_NOW,
  FIXTURE_ROSTER,
  FIXTURE_SESSION,
  FIXTURE_TITLE,
  FIXTURE_TURN,
  fixtureConversationTurns,
} from "./conversation-turns.fixtures";

type PanelProps = Parameters<typeof AgentsPanel>[0];
type TranscriptProps = Parameters<typeof AgentTranscriptPanel>[0];

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
  QUEUED: "abababab-7777-4000-8000-000000000007",
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
  queuedAt: NOW - 6 * MINUTE_MS,
  startedAt: NOW - 5 * MINUTE_MS,
};

/** An agent whose session the roster has let go: named by the title the service kept, marked by its provider. */
const DEPARTED_AGENT: AgentRead = {
  id: AGENT_ID.DEPARTED,
  providerId: "conductor",
  providerSessionId: FIXTURE_SESSION.DEPARTED,
  title: "Retire the legacy roster",
  workspace: "legacy-roster",
  status: CHILD_STATUS.SETTLED,
  acceptedAt: NOW - 3 * 24 * 60 * MINUTE_MS,
  queuedAt: NOW - 3 * 24 * 60 * MINUTE_MS,
  startedAt: NOW - 3 * 24 * 60 * MINUTE_MS,
  settledAt: NOW - 3 * 60 * MINUTE_MS,
};

/** An agent followed for days whose latest turn was queued a moment ago and has not started: its age is the queuing's. */
const QUEUED_AGENT: AgentRead = {
  id: AGENT_ID.QUEUED,
  providerId: "conductor",
  providerSessionId: FIXTURE_SESSION.UNOPENABLE,
  status: CHILD_STATUS.ACCEPTED,
  acceptedAt: NOW - 5 * 24 * 60 * MINUTE_MS,
  queuedAt: NOW - 2 * MINUTE_MS,
};

/** The agent as a row the service opened before it kept a session's naming: without title or workspace. */
function unnamed({ title: _title, workspace: _workspace, ...agent }: AgentRead): AgentRead {
  return agent;
}

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
  return renderToStaticMarkup(createElement(AgentsPanel, panelProps(extra)));
}

function renderChildren(children: readonly ChildRead[], settled = true): string {
  return render({ subagents: { settled, children } });
}

function titles(container: ParentNode): string[] {
  return [...container.querySelectorAll(".agent-name")].map((node) => node.textContent ?? "");
}

function sections(markup: string): Element[] {
  const container = document.createElement("div");
  container.innerHTML = markup;
  return [...container.querySelectorAll(".agents-section")];
}

function mount(props: PanelProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(AgentsPanel, props));
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("the list is mounted under the thread's own root, ids and blocked class alike, in two headed sections under a settings page's head", () => {
  const markup = renderChildren([LABELLED]);
  assert.ok(markup.includes('class="conversation-view agents-page ph-no-capture"'));
  assert.ok(markup.includes('id="panel-view-conversation"'));
  assert.ok(markup.includes('aria-labelledby="panel-tab-conversation"'));
  // The way back is the settings pages' own square icon button, named for a reader rather than by a glyph in its text.
  assert.ok(
    markup.includes(
      '<button type="button" class="icon-button agents-back" aria-label="Back to Conversation" title="Back">',
    ),
  );
  assert.ok(markup.includes('<h2 class="agents-title">Agents</h2>'));
  const drawn = sections(markup);
  const headings = drawn.map(
    (section) => section.querySelector(".agents-section-title")?.textContent,
  );
  assert.deepEqual(headings, ["Per-workspace agents", "Sub-agents"]);
  // Each row is a session row standing on its own under the heading, as a chat's does one tab over.
  const [, subagents] = drawn;
  assert.ok(subagents);
  assert.equal(subagents.children[1]?.className, "session-row agent-row");
});

test("sub-agent rows are ordered by the instant they last moved, newest first, and each is named by its label, its task without the marker, or its id", () => {
  // The oldest-accepted child settled a minute ago, so it leads: order follows the age the row wears, not the acceptance.
  const revived = { ...OBSERVED, settledAt: NOW - MINUTE_MS };
  const [, subagents] = sections(renderChildren([TASKED, LABELLED, revived, BARE]));
  assert.ok(subagents);
  assert.deepEqual(titles(subagents), [
    "Summarise the failing test.",
    "Child cccccccc",
    "Audit the release notes",
    "Rename the roster helper.",
  ]);
  assert.deepEqual(
    [...subagents.querySelectorAll(".agent-age")].map((node) => node.textContent),
    ["1m", "10m", "25m", "2h"],
  );
  assert.ok(!subagents.textContent?.includes("[subagent task]"));
});

test("each sub-agent row wears its status word, its age, and where it was delegated from", () => {
  const [, subagents] = sections(renderChildren([LABELLED, TASKED, BARE, OBSERVED]));
  assert.ok(subagents);
  const rows = [...subagents.querySelectorAll(".agent-row")];
  const words = rows.map((row) => row.querySelector(".agent-status")?.textContent);
  assert.deepEqual(words, ["Waiting", "Running", "Done", "Failed"]);
  const ages = rows.map((row) => row.querySelector(".agent-age")?.textContent);
  assert.deepEqual(ages, ["10m", "25m", "2h", "2d"]);
  const origins = rows.map((row) => row.querySelector(".agent-origin")?.textContent);
  assert.deepEqual(origins, [undefined, undefined, undefined, "from an observed session"]);
  // Each row wears its state in the session rows' vocabulary: a running turn spins, a settled one checks off,
  // a failure takes the attention colour, and a waiting one wears no state.
  assert.deepEqual(
    rows.map((row) => row.getAttribute("data-state")),
    [null, "urgency-working", "urgency-complete", "urgency-attention"],
  );
  assert.deepEqual(
    rows.map((row) => row.querySelector(".row-spinner") !== null),
    [false, true, false, false],
  );
  assert.deepEqual(
    rows.map((row) => row.querySelector(".row-check") !== null),
    [false, false, true, false],
  );
  // No sub-agent row wears a provider mark: a child is the brain's own, not a session's, so its
  // slot holds the robot the thread's chips wear for Luke's agents.
  assert.equal(subagents.querySelector(".provider-mark"), null);
  assert.equal(subagents.querySelectorAll(".row-mark > .agent-robot").length, 4);
});

test("a cancelled child says so", () => {
  const markup = renderChildren([{ ...BARE, status: CHILD_STATUS.CANCELLED }]);
  assert.ok(markup.includes(">Cancelled<"));
});

test("a per-workspace agent row is named from the roster by session identity, then by the title the service kept, then by the session's id, and marked by its agent", () => {
  const [agents] = sections(
    render({ agents: { settled: true, agents: [DEPARTED_AGENT, HELD_AGENT, QUEUED_AGENT] } }),
  );
  assert.ok(agents);
  // Rows are ordered by the instant they last moved, whatever order the service listed them in, and a
  // queued turn's row wears the age of its queuing rather than of the days-old session it was opened for.
  assert.deepEqual(titles(agents), [
    FIXTURE_TITLE.UNOPENABLE,
    FIXTURE_TITLE.HELD,
    DEPARTED_AGENT.title,
  ]);
  const rows = [...agents.querySelectorAll(".agent-row")];
  assert.deepEqual(
    rows.map((row) => row.querySelector(".agent-status")?.textContent),
    ["Waiting", "Running", "Done"],
  );
  assert.deepEqual(
    rows.map((row) => row.querySelector(".agent-age")?.textContent),
    ["2m", "5m", "3h"],
  );
  // Every agent row leads with a mark in a session row's own slot: the roster's agent while it holds
  // the session, the provider once it has let go.
  assert.deepEqual(
    [...agents.querySelectorAll(".row-mark > .provider-mark")].map((mark) =>
      mark.getAttribute("data-mark"),
    ),
    ["claude-code", "claude-code", "conductor"],
  );
  assert.equal(agents.querySelector(".agent-robot"), null);
  // The roster's own title comes first while it holds the session; a row the service never named falls back to the session's id.
  const [alone] = sections(
    render({
      roster: [],
      agents: {
        settled: true,
        agents: [HELD_AGENT, unnamed(DEPARTED_AGENT)],
      },
    }),
  );
  assert.deepEqual(titles(alone ?? document.createElement("div")), [
    "Session 6c1f2f14",
    "Session 8e3b4c36",
  ]);
  const [named] = sections(
    render({
      agents: { settled: true, agents: [{ ...HELD_AGENT, title: "Kept by the service" }] },
    }),
  );
  assert.deepEqual(titles(named ?? document.createElement("div")), [FIXTURE_TITLE.HELD]);
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
  const rows = [...container.querySelectorAll(".agent-row")];
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
      title: DEPARTED_AGENT.title,
      status: CHILD_STATUS.SETTLED,
      session: { providerId: "conductor", providerSessionId: FIXTURE_SESSION.DEPARTED },
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
  const back = container.querySelector(".agents-back");
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
  session: { providerId: "conductor", providerSessionId: FIXTURE_SESSION.HELD },
};

/** The mark a chip wears, as the thread's chips wear theirs. */
function chipMark(providerId: string): string {
  return renderToStaticMarkup(
    createElement(ProviderMark, { providerId, className: "conversation-chip-mark" }),
  );
}

function renderTranscript(extra: Partial<TranscriptProps> = {}): string {
  return renderToStaticMarkup(
    createElement(AgentTranscriptPanel, {
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
  assert.ok(markup.includes('class="conversation-view agents-page ph-no-capture"'));
  assert.ok(markup.includes('id="panel-view-conversation"'));
  assert.ok(
    markup.includes(
      '<button type="button" class="icon-button agents-back" aria-label="Back to Agents" title="Back">',
    ),
  );
  assert.ok(markup.includes(">Audit the release notes</h2>"));
  assert.ok(markup.includes(">Running</span>"));
  // An agent's page wears the row's status the same way, and its session's
  // chip in the title's place: the roster's title under the agent's mark,
  // a press while the roster holds the session, inside a heading named by
  // the title so heading navigation hears the conversation and not the press.
  const agent = renderTranscript({ open: { ...OPEN_AGENT, status: CHILD_STATUS.SETTLED } });
  assert.ok(
    agent.includes(
      `<h2 class="agents-title agent-transcript-title" aria-label="${FIXTURE_TITLE.HELD}"><button type="button" class="conversation-action-chip" aria-label="Open ${FIXTURE_TITLE.HELD}">${chipMark("claude-code")}${FIXTURE_TITLE.HELD}</button></h2>`,
    ),
  );
  assert.ok(agent.includes(">Done</span>"));
  // A child's page wears no chip: a child has no session to open.
  assert.ok(!markup.includes("conversation-action-chip"));
});

test("the transcript header's chip is the session's own press while the roster holds it, and a name once it does not", () => {
  const chats: SessionIdentity[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (roster: TranscriptProps["roster"]) => {
    act(() => {
      root.render(
        createElement(AgentTranscriptPanel, {
          open: OPEN_AGENT,
          transcript: undefined,
          roster,
          now: FIXTURE_NOW,
          onOpenChat: (identity) => chats.push(identity),
          onBack: () => undefined,
        }),
      );
    });
    return container.querySelector(".agent-transcript-title > .conversation-action-chip");
  };
  const held = render(FIXTURE_ROSTER);
  assert.ok(held instanceof HTMLButtonElement);
  act(() => {
    held.click();
  });
  assert.deepEqual(chats, [{ providerId: "conductor", providerSessionId: FIXTURE_SESSION.HELD }]);
  // The roster lets the session go while the page is open: the chip stands, under the provider's
  // mark and the title the row wore, but is no longer a press.
  const departed = render([]);
  assert.ok(departed instanceof HTMLSpanElement);
  assert.equal(departed.textContent, FIXTURE_TITLE.HELD);
  assert.equal(departed.querySelector(".conversation-chip-mark")?.outerHTML, chipMark("conductor"));
  // The roster holds it again but its provider reports no address: a name still.
  const quiet = render(FIXTURE_ROSTER.map((session) => ({ ...session, openable: false })));
  assert.ok(quiet instanceof HTMLSpanElement);
  act(() => {
    quiet.click();
  });
  assert.equal(chats.length, 1);
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
    // Nothing of the thread's own is copied: no line still being said, no
    // place held, and no source chip heading a group, since the service pages
    // a transcript's own conversation as main and the page's header names it.
    assert.ok(!markup.includes("conversation-source-chip"));
    assert.ok(!markup.includes('data-streaming="true"'));
    assert.ok(!markup.includes("conversation-listening"));
    assert.ok(!markup.includes("Nothing said yet"));
  }
});

test("a transcript not yet read holds the shape of a thread inside the scroller, and one read with nothing says so", () => {
  const child = { conversationId: OPEN_CHILD.conversationId, kind: TRANSCRIPT_KIND.CHILD };
  const unread = renderTranscript({ transcript: { ...child, settled: false, groups: [] } });
  const scroll = unread.indexOf('class="conversation-scroll"');
  const loading = unread.indexOf('class="conversation-skeleton"');
  assert.ok(scroll >= 0 && loading > scroll);
  // The wait is the Sessions list's: placeholder bubbles hidden from a reader,
  // pulsing on the loop a capture holds, under one status line that says the
  // page is reading rather than that nothing was said or that a thread stands.
  assert.ok(
    unread.includes('<span class="visually-hidden" role="status">Reading the transcript</span>'),
  );
  const bubbles = unread.match(/class="conversation-skeleton-bubble"/g) ?? [];
  assert.equal(bubbles.length, 4);
  assert.ok(unread.includes('data-speaker="you" aria-hidden="true" style="--row-index:1"'));
  assert.ok(unread.includes('data-speaker="luke" aria-hidden="true" style="--row-index:2"'));
  assert.ok(!unread.includes("Loading…"));
  assert.ok(!unread.includes("Nothing said yet"));
  assert.ok(!unread.includes('<ol class="conversation-list">'));
  const none = renderTranscript();
  assert.ok(none.includes("Reading the transcript"));
  assert.ok(!none.includes("Nothing said yet"));
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
    assert.ok(other.includes("Reading the transcript"));
    assert.ok(!other.includes('<ol class="conversation-list">'));
    assert.ok(!other.includes("Nothing said yet"));
  }
  const empty = renderTranscript({ transcript: { ...child, settled: true, groups: [] } });
  assert.ok(empty.includes("Nothing said yet"));
  assert.ok(!empty.includes("Reading the transcript"));
  assert.ok(!empty.includes('class="conversation-skeleton"'));
  assert.ok(!empty.includes('class="conversation-scroll"'));
});

test("the transcript opens at its tail, jumps again only when it gains a turn or another row opens, and leaves a reader who scrolled up alone", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (extra: Partial<TranscriptProps>) => {
    act(() => {
      root.render(
        createElement(AgentTranscriptPanel, {
          open: OPEN_CHILD,
          transcript: undefined,
          roster: FIXTURE_ROSTER,
          now: FIXTURE_NOW,
          onOpenChat: () => undefined,
          onBack: () => undefined,
          ...extra,
        }),
      );
    });
  };
  render({});
  const scroller = container.querySelector(".conversation-scroll");
  assert.ok(scroller instanceof HTMLDivElement);
  // jsdom lays nothing out, so the scroller's height and position are stood in for.
  const metrics = { scrollTop: 0, scrollHeight: 400 };
  Object.defineProperties(scroller, {
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => {
        metrics.scrollTop = value;
      },
    },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
  });
  const child = { conversationId: OPEN_CHILD.conversationId, kind: TRANSCRIPT_KIND.CHILD };
  // Loading moves nothing; the first read lands at the tail.
  assert.equal(metrics.scrollTop, 0);
  render({ transcript: { ...child, settled: true, groups: SINGLE_TURN } });
  assert.equal(metrics.scrollTop, 400);
  // A re-read handing back the same turns leaves a reader who scrolled up where they are.
  metrics.scrollTop = 40;
  render({ transcript: { ...child, settled: true, groups: [...SINGLE_TURN] } });
  assert.equal(metrics.scrollTop, 40);
  // A turn gained jumps to the tail again; one lost does not.
  const turns = fixtureConversationTurns();
  metrics.scrollHeight = 900;
  render({ transcript: { ...child, settled: true, groups: turns } });
  assert.equal(metrics.scrollTop, 900);
  metrics.scrollTop = 40;
  render({ transcript: { ...child, settled: true, groups: SINGLE_TURN } });
  assert.equal(metrics.scrollTop, 40);
  // The same conversation opened under the other kind is another row, and
  // jumps anew with as many turns; so does another conversation, each once
  // its own read lands and not while the replaced transcript still stands.
  const asAgent = { ...OPEN_CHILD, kind: TRANSCRIPT_KIND.OBSERVED };
  render({ open: asAgent, transcript: { ...child, settled: true, groups: SINGLE_TURN } });
  assert.equal(metrics.scrollTop, 40);
  render({ open: asAgent, transcript: { ...asAgent, settled: true, groups: SINGLE_TURN } });
  assert.equal(metrics.scrollTop, 900);
  metrics.scrollTop = 40;
  const agent = { conversationId: OPEN_AGENT.conversationId, kind: TRANSCRIPT_KIND.OBSERVED };
  render({ open: OPEN_AGENT, transcript: { ...agent, settled: true, groups: SINGLE_TURN } });
  assert.equal(metrics.scrollTop, 900);
  act(() => {
    root.unmount();
  });
  container.remove();
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
      createElement(AgentTranscriptPanel, {
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
  const back = container.querySelector(".agents-back");
  assert.ok(back instanceof HTMLButtonElement);
  act(() => {
    back.click();
  });
  assert.equal(backs, 1);
});

/** The whole fixture thread as a child's transcript, with a query the tests type and the message its first shown result names. */
const TRANSCRIPT_TURNS = fixtureConversationTurns();

const QUERY = "session";

const FIRST_HIT = searchConversation(conversationSearchEntries(TRANSCRIPT_TURNS), QUERY)
  ?.groups[0]?.[0];

if (FIRST_HIT === undefined) throw new Error("The fixtures hold no match for the test's query.");

const CHILD_TRANSCRIPT = {
  conversationId: OPEN_CHILD.conversationId,
  kind: TRANSCRIPT_KIND.CHILD,
  settled: true,
  groups: TRANSCRIPT_TURNS,
} as const;

/**
 * The browser's frame schedule and layout, stood in for the way the thread
 * panel's search tests stand them in: nothing runs until a test says a frame
 * passed; an element is drawn visibly unless it stands in the transcript
 * behind the results; and each scroll into view is recorded rather than
 * performed, with whether the row still stood behind the results when asked.
 */
function stagedFrames() {
  const pending = new Map<number, () => void>();
  let next = 1;
  window.requestAnimationFrame = (callback) => {
    const handle = next++;
    pending.set(handle, () => callback(0));
    return handle;
  };
  window.cancelAnimationFrame = (handle) => {
    pending.delete(handle);
  };
  const scrolled: { element: Element; options: unknown; behind: boolean }[] = [];
  HTMLElement.prototype.checkVisibility = function checkVisibility(
    this: HTMLElement,
    options?: CheckVisibilityOptions,
  ) {
    return !(options?.visibilityProperty === true && this.closest("[data-behind-results]"));
  };
  Element.prototype.scrollIntoView = function scrollIntoView(
    this: Element,
    options?: boolean | ScrollIntoViewOptions,
  ) {
    scrolled.push({
      element: this,
      options,
      behind: this.closest("[data-behind-results]") !== null,
    });
  };
  return {
    scrolled,
    tick(): boolean {
      const entry = [...pending.entries()].at(-1);
      if (!entry) return false;
      pending.delete(entry[0]);
      entry[1]();
      return true;
    },
  };
}

function mountTranscript(props: Partial<TranscriptProps> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (next: Partial<TranscriptProps>) => {
    act(() => {
      root.render(
        createElement(AgentTranscriptPanel, {
          open: OPEN_CHILD,
          transcript: CHILD_TRANSCRIPT,
          roster: FIXTURE_ROSTER,
          now: FIXTURE_NOW,
          onOpenChat: () => undefined,
          onBack: () => undefined,
          searchOpen: true,
          ...next,
        }),
      );
    });
  };
  render(props);
  return { container, render };
}

function searchField(container: ParentNode): HTMLInputElement {
  const input = container.querySelector(`#${CONVERSATION_SEARCH_INPUT_ID}`);
  assert.ok(input instanceof HTMLInputElement, "the search field is drawn");
  return input;
}

/** Types past React's own value tracking, so the input event reads as a change. */
function type(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function resultPresses(container: ParentNode): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll(".conversation-search-results .conversation-words-press"),
  ].filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
}

/** The transcript's list while it stands forward; nothing while the results stand in its place. */
function transcriptList(container: ParentNode): Element | null {
  return container.querySelector(
    ".conversation-thread:not([data-behind-results]) ol.conversation-list:not(.conversation-search-results)",
  );
}

function transcriptScroller(container: ParentNode): HTMLDivElement {
  const element = container.querySelector(".conversation-scroll:not(.conversation-search-scroll)");
  assert.ok(element instanceof HTMLDivElement, "the transcript's scroller is drawn");
  return element;
}

/** jsdom lays nothing out: a fixed height of transcript in a fixed view, and a position each scroller keeps for itself. */
function laidOut(scrollHeight: number, clientHeight: number) {
  const positions = new WeakMap<Element, number>();
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: Element) {
        return positions.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        positions.set(this, value);
      },
    },
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
  });
}

function scrollTo(element: HTMLDivElement, scrollTop: number): void {
  act(() => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new Event("scroll"));
  });
}

test("a page has words to search exactly when it draws turns: the thread with turns, or a transcript whose own read has landed with turns", () => {
  const thread = { groups: TRANSCRIPT_TURNS, settled: true };
  const empty = { groups: [], settled: true };
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.THREAD, thread, undefined, undefined),
    true,
  );
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.THREAD, empty, undefined, undefined),
    false,
  );
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.THREAD, undefined, undefined, undefined),
    false,
  );
  // The Agents list has no words of its own, whatever the thread or a transcript holds.
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.AGENTS, thread, OPEN_CHILD, CHILD_TRANSCRIPT),
    false,
  );
  // A transcript page searches its own transcript once read with turns, and the thread has no say.
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.TRANSCRIPT, empty, OPEN_CHILD, CHILD_TRANSCRIPT),
    true,
  );
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.TRANSCRIPT, thread, OPEN_CHILD, undefined),
    false,
  );
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.TRANSCRIPT, thread, undefined, CHILD_TRANSCRIPT),
    false,
  );
  // Still loading, read with nothing, another conversation's, or this one's under another kind: nothing to search yet.
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.TRANSCRIPT, thread, OPEN_CHILD, {
      ...CHILD_TRANSCRIPT,
      settled: false,
      groups: [],
    }),
    false,
  );
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.TRANSCRIPT, thread, OPEN_CHILD, {
      ...CHILD_TRANSCRIPT,
      groups: [],
    }),
    false,
  );
  const other = { ...CHILD_TRANSCRIPT, conversationId: AGENT_ID.HELD };
  assert.equal(ownTranscript(OPEN_CHILD, other), undefined);
  assert.equal(
    conversationSearchable(CONVERSATION_PAGE.TRANSCRIPT, thread, OPEN_CHILD, other),
    false,
  );
  const asAgent = { ...CHILD_TRANSCRIPT, kind: TRANSCRIPT_KIND.OBSERVED };
  assert.equal(ownTranscript(OPEN_CHILD, asAgent), undefined);
  assert.equal(ownTranscript(OPEN_CHILD, CHILD_TRANSCRIPT), CHILD_TRANSCRIPT);
});

test("the transcript's search field stands under the header while open and turns are drawn, worded for a transcript, and a query puts the results in the transcript's place", () => {
  // No field over a closed search, a transcript still loading, or one read with nothing.
  assert.equal(
    mountTranscript({ searchOpen: false }).container.querySelector(
      `#${CONVERSATION_SEARCH_INPUT_ID}`,
    ),
    null,
  );
  assert.equal(
    mountTranscript({ transcript: undefined }).container.querySelector(
      `#${CONVERSATION_SEARCH_INPUT_ID}`,
    ),
    null,
  );
  assert.equal(
    mountTranscript({ transcript: { ...CHILD_TRANSCRIPT, groups: [] } }).container.querySelector(
      `#${CONVERSATION_SEARCH_INPUT_ID}`,
    ),
    null,
  );
  const { container } = mountTranscript();
  const input = searchField(container);
  assert.equal(input.getAttribute("aria-label"), "Search transcript");
  assert.equal(input.placeholder, "Search transcript…");
  // Under the header, so the way back is never behind the pill, and inside the blocked root.
  const header = container.querySelector(".agents-header");
  const pill = input.closest(".conversation-search");
  assert.ok(header && pill);
  assert.ok(header.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING);
  const blocked = container.querySelector(".ph-no-capture");
  assert.ok(blocked?.contains(input));
  assert.ok(transcriptList(container));
  type(input, QUERY);
  const rows = resultPresses(container);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((row) => blocked?.contains(row)));
  assert.equal(transcriptList(container), null, "the results stand in the transcript's place");
  assert.equal(
    transcriptScroller(container)
      .closest(".conversation-thread")
      ?.getAttribute("data-behind-results"),
    "true",
  );
  assert.match(container.querySelector(".session-search-count")?.textContent ?? "", /^\d+ of \d+$/);
  // The results carry no rating offer the transcript's own rows would not: no composer is offered here.
  type(input, "zeta");
  assert.equal(resultPresses(container).length, 0);
  assert.equal(container.querySelector(".session-search-count")?.textContent, "No matches");
  assert.ok(container.querySelector(".empty-state")?.textContent?.includes("No messages match"));
});

test("pressing a transcript result brings the transcript back marked, lands on the message, and the caret back in the field brings the results back", () => {
  const stage = stagedFrames();
  const engaged: boolean[] = [];
  const { container } = mountTranscript({ onSearchEngaged: (value) => engaged.push(value) });
  const input = searchField(container);
  type(input, QUERY);
  const [first] = resultPresses(container);
  assert.ok(first);
  act(() => {
    first.click();
  });
  assert.ok(transcriptList(container));
  assert.equal(resultPresses(container).length, 0);
  assert.ok(container.querySelectorAll("mark.row-match").length >= 1);
  const landed = [...container.querySelectorAll('[data-search-landed="true"]')];
  assert.ok(landed.length >= 1);
  assert.ok(
    landed.every((row) => row.getAttribute(CONVERSATION_MESSAGE_ATTRIBUTE) === FIRST_HIT.messageId),
  );
  assert.equal(input.value, QUERY);
  // The seek waits out the swap, then centres the message's first row in the transcript that came forward.
  assert.equal(stage.scrolled.length, 0);
  for (let frame = 0; frame < 60 && stage.scrolled.length === 0; frame += 1) stage.tick();
  assert.equal(stage.scrolled.length, 1);
  assert.equal(stage.scrolled[0]?.behind, false);
  assert.deepEqual(stage.scrolled[0]?.options, { block: "center", inline: "nearest" });
  assert.equal(
    stage.scrolled[0]?.element.getAttribute(CONVERSATION_MESSAGE_ATTRIBUTE),
    FIRST_HIT.messageId,
  );
  act(() => {
    input.focus();
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  assert.ok(engaged.includes(true));
  assert.ok(resultPresses(container).length >= 2);
  assert.equal(transcriptList(container), null);
});

test("Enter in the transcript's field lands on the first result and leaves the field; Escape clears, then closes; a closed field drops its query", () => {
  stagedFrames();
  const closes: number[] = [];
  const { container, render } = mountTranscript({ onSearchClose: () => closes.push(1) });
  const input = searchField(container);
  press(input, "Enter");
  assert.ok(transcriptList(container), "Enter over no search changes nothing");
  type(input, QUERY);
  act(() => {
    input.focus();
  });
  press(input, "Enter");
  assert.ok(transcriptList(container));
  assert.equal(
    container
      .querySelector('[data-search-landed="true"]')
      ?.getAttribute(CONVERSATION_MESSAGE_ATTRIBUTE),
    FIRST_HIT.messageId,
  );
  assert.notEqual(document.activeElement, input);
  // Escape clears the held query first, and only an empty field asks to close.
  press(input, "Escape");
  assert.equal(input.value, "");
  assert.equal(container.querySelectorAll("mark.row-match").length, 0);
  assert.equal(closes.length, 0);
  press(input, "Escape");
  assert.equal(closes.length, 1);
  // A query does not outlive the field it was typed in.
  type(input, QUERY);
  assert.ok(resultPresses(container).length >= 1);
  render({ searchOpen: false, onSearchClose: () => closes.push(1) });
  assert.equal(container.querySelector(`#${CONVERSATION_SEARCH_INPUT_ID}`), null);
  assert.ok(transcriptList(container));
  assert.equal(container.querySelectorAll("mark.row-match").length, 0);
  render({ searchOpen: true, onSearchClose: () => closes.push(1) });
  assert.equal(searchField(container).value, "");
});

test("the transcript keeps the reader's place behind the results: a reader on the tail is seated there again, one who scrolled up is left where they stood", () => {
  stagedFrames();
  laidOut(1000, 300);
  const { container, render } = mountTranscript({ searchOpen: false });
  const box = transcriptScroller(container);
  // The page opened at its tail; the pill opening seats a reader there again.
  assert.equal(box.scrollTop, 1000);
  box.scrollTop = 700;
  render({ searchOpen: true });
  assert.equal(box.scrollTop, 1000);
  const input = searchField(container);
  // The results come and go with the reader still on the tail.
  box.scrollTop = 700;
  type(input, QUERY);
  assert.equal(
    transcriptScroller(container),
    box,
    "the transcript stands behind, its scroller the same",
  );
  press(input, "Escape");
  assert.ok(transcriptList(container));
  assert.equal(box.scrollTop, 1000);
  // A reader who scrolled up is where they were.
  scrollTo(box, 120);
  type(input, QUERY);
  press(input, "Escape");
  assert.equal(box.scrollTop, 120);
  render({ searchOpen: false });
  assert.equal(box.scrollTop, 120);
  // A landing is the reader's own place: nothing but the seek moves the scroller.
  render({ searchOpen: true });
  scrollTo(box, 1000);
  type(searchField(container), QUERY);
  box.scrollTop = 700;
  const [result] = resultPresses(container);
  assert.ok(result);
  act(() => {
    result.click();
  });
  assert.equal(transcriptScroller(container), box);
  assert.equal(box.scrollTop, 700);
});
