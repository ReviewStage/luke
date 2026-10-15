// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { codingAgentsControl } from "#testing/plans-control";
import { planCards } from "../desktop/side-panel";
import { NOTHING_HELD } from "./agent-ref";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";
import { fixtureChat } from "./chat-fixture";
import { CHAT_PLACE, type ChatPlace, chatNames } from "./chat-model";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";

/**
 * agent-tab.test.ts -- a call about something the window draws in a tab of
 * its own is a row that opens that tab, and every other call a row that
 * folds open in place; a run of calls and a list of the agents each wear
 * their own icon. A row that opens an agent's or a worker's tab hangs that
 * tab's card. A line a chat notice wrote draws as a card from its sender.
 */

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** One stored tool part, answered where `output` is given and still running where not. */
function toolPart(tool: string, input: WireRecord, output?: WireRecord): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: `call-${tool}`,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

function assistant(parts: readonly WireRecord[]): CodingAgentMessage {
  return { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts };
}

/** The message drawn as an agent's turn is, every target its rows open recorded. */
function drawn(message: CodingAgentMessage, moving = false) {
  const opened: ToolTarget[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message,
        plan: false,
        lead: AGENT_LEAD,
        moving,
        delegation: { models: [], onOpenTarget: (target) => opened.push(target) },
      }),
    ),
  );
  return { container, opened };
}

const ACCEPTED = { status: "accepted" };

const OPENING_CALLS: readonly {
  readonly name: string;
  readonly tool: string;
  readonly input: WireRecord;
  readonly output?: WireRecord;
  readonly target: ToolTarget;
}[] = [
  {
    name: "a page shown opens its tab",
    tool: "show_page",
    input: { title: "Pricing explorer", path: "pricing.html" },
    output: { status: "accepted", page: { id: "page-1", version: 2 } },
    target: { kind: TOOL_TARGET.PAGE, page: "page-1" },
  },
  {
    name: "a drawing opens the Board",
    tool: "draw_on_board",
    input: { elements: [] },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.BOARD },
  },
  {
    name: "a look at the board opens the Board",
    tool: "look_at_board",
    input: {},
    output: { status: "looked", image: "data:image/png;base64,AA" },
    target: { kind: TOOL_TARGET.BOARD },
  },
  {
    name: "a read of an agent opens its tab",
    tool: "read_coding_agent",
    input: { agentId: "agent-7" },
    output: { status: "running" },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-7" },
  },
  {
    name: "a message to an agent opens its tab",
    tool: "message_coding_agent",
    input: { agentId: "agent-7", text: "Rebase on main" },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-7" },
  },
  {
    name: "a start opens the agent it began",
    tool: "start_coding_agent",
    input: { task: "Ship the invoice export" },
    output: { status: "accepted", agent: { id: "agent-9" } },
    target: { kind: TOOL_TARGET.AGENT, agent: "agent-9" },
  },
  {
    name: "a plan edit opens the plan",
    tool: "edit_plan",
    input: { notes: [{ kind: "add", section: "Goal", text: "Export invoices" }] },
    output: ACCEPTED,
    target: { kind: TOOL_TARGET.PLAN },
  },
  {
    name: "code shown opens its file at its lines",
    tool: "show_code",
    input: { path: "src/invoice.ts", startLine: 12, endLine: 40 },
    output: ACCEPTED,
    target: {
      kind: TOOL_TARGET.SHOWN_CODE,
      call: "call-show_code",
      ref: { path: "src/invoice.ts", startLine: 12, endLine: 40 },
    },
  },
  {
    name: "a post to the inbox, which lives in Chat, opens the plan's Chat",
    tool: "post_to_inbox",
    input: { title: "Which currency?", response: { type: "text" } },
    output: { items: [] },
    target: { kind: TOOL_TARGET.CHAT },
  },
  {
    name: "a close in the inbox opens the plan's Chat",
    tool: "close_inbox_item",
    input: { key: "currency", reason: "Settled in the plan" },
    output: { items: [] },
    target: { kind: TOOL_TARGET.CHAT },
  },
  {
    name: "a read of the inbox opens the plan's Chat",
    tool: "read_inbox",
    input: {},
    output: { items: [] },
    target: { kind: TOOL_TARGET.CHAT },
  },
];

for (const call of OPENING_CALLS) {
  test(`${call.name}: its row is one button that opens it`, () => {
    const { container, opened } = drawn(assistant([toolPart(call.tool, call.input, call.output)]));
    const row = container.querySelector<HTMLButtonElement>(
      `button[data-call-id="call-${call.tool}"]`,
    );
    assert.ok(row, "the row is a button");
    assert.equal(container.querySelector("details"), null, "the row folds nothing open in place");
    act(() => row.click());
    assert.deepEqual(opened, [call.target]);
  });
}

const FOLDING_CALLS: readonly {
  readonly name: string;
  readonly part: WireRecord;
}[] = [
  {
    name: "a command on the Mac",
    part: toolPart(
      "run_on_mac",
      { command: "git status" },
      { stdout: "", stderr: "", exitCode: 0 },
    ),
  },
  {
    name: "a message its tool refused",
    part: toolPart(
      "message_coding_agent",
      { agentId: "agent-7", text: "Rebase on main" },
      { status: "rejected", reason: "The agent has ended." },
    ),
  },
  {
    name: "a call that failed",
    part: {
      type: "tool-read_coding_agent",
      toolCallId: "call-read_coding_agent",
      state: "output-error",
      input: { agentId: "agent-7" },
      errorText: "The service did not answer.",
    },
  },
  {
    name: "a page not yet written",
    part: toolPart("show_page", { title: "Pricing explorer" }),
  },
  {
    name: "a drawing the board refused",
    part: toolPart(
      "draw_on_board",
      { elements: [] },
      { status: "not-drawn", reason: "Not drawn: an arrow names an id the diagram does not hold." },
    ),
  },
  {
    name: "a plan edit still running",
    part: toolPart("edit_plan", { notes: [{ kind: "add", section: "Goal", text: "Export" }] }),
  },
  {
    name: "a file the agent read, which its checkout holds and GitHub may not",
    part: toolPart("read_file", { filePath: "src/new.ts" }, { content: "export {}" }),
  },
  {
    name: "a file the agent wrote, which its pull request may not hold yet",
    part: toolPart(
      "write_file",
      { filePath: "src/new.ts", content: "export {}" },
      { path: "src/new.ts" },
    ),
  },
];

for (const call of FOLDING_CALLS) {
  test(`${call.name} opens nothing: its row folds its input and answer open in place`, () => {
    const { container, opened } = drawn(assistant([call.part]));
    assert.equal(container.querySelector("button[data-opens]"), null);
    const row = container.querySelector("summary");
    assert.ok(row, "the row is a fold's line");
    act(() => row.click());
    assert.deepEqual(opened, []);
  });
}

test("a run of calls wears a stack, and a list of the agents a list's icon", () => {
  const { container } = drawn(
    assistant([
      toolPart("list_coding_agents", {}, { agents: [] }),
      toolPart("run_on_mac", { command: "git status" }),
    ]),
    true,
  );
  const group = container.querySelector("[data-turn-fold] > summary svg");
  assert.ok(group?.classList.contains("lucide-layers"), "the group's line wears Layers");
  const rows = [...container.querySelectorAll("[data-turn-fold] summary")];
  const listed = rows.find((row) => row.textContent?.includes("Listed the coding agents"));
  assert.ok(
    listed?.querySelector("svg")?.classList.contains("lucide-layout-list"),
    "the list's row wears LayoutList",
  );
});

/** An agent of the plan's, as its list holds it. */
function listedAgent(id: string, title: string, overrides: Partial<CodingAgentSummary> = {}) {
  return {
    id,
    planId: "plan-1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.RUNNING,
    turnId: null,
    ...overrides,
  } satisfies CodingAgentSummary;
}

/** The card standing in the window once `row` is reached from the keyboard: its name, then its corner. */
function cardOn(row: HTMLElement | null): readonly (string | null | undefined)[] {
  assert.ok(row, "the row is drawn");
  document.documentElement.dataset.keyboard = "true";
  act(() => row.focus());
  const card = document.querySelector(".tooltip-card [data-tab-card]");
  assert.ok(card, "the row hangs a tab's card");
  return [
    card.querySelector(".card-name")?.textContent,
    card.querySelector(".card-corner")?.textContent,
  ];
}

test("in an agent's transcript, a call about an agent hangs that agent's tab's card, archived or not found as well, and a delegation's row its worker's", () => {
  const agents = codingAgentsControl({
    agents: [listedAgent("agent-7", "Invoice export")],
    archived: [
      listedAgent("agent-8", "Retry audit", {
        status: CODING_AGENT_STATUS.CANCELLED,
        archivedAt: 2,
      }),
    ],
  });
  const cards = planCards({
    agents,
    workRows: [],
    held: NOTHING_HELD,
    chosen: () => false,
    shownCode: [],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const message = assistant([
    toolPart("message_coding_agent", { agentId: "agent-7", text: "Rebase on main" }, ACCEPTED),
    toolPart("read_coding_agent", { agentId: "agent-8" }, { status: "cancelled" }),
    toolPart(
      "start_coding_agent",
      { task: "Gone" },
      { status: "accepted", agent: { id: "agent-9" } },
    ),
    toolPart("delegate", { task: "Audit the retry paths" }),
  ]);
  act(() =>
    root.render(
      createElement(AgentMessage, {
        message,
        plan: false,
        lead: AGENT_LEAD,
        moving: false,
        delegation: {
          models: [],
          onOpen: () => undefined,
          onOpenTarget: () => undefined,
          cards: cards.agent("agent-1"),
        },
      }),
    ),
  );
  const row = (callId: string) =>
    container.querySelector<HTMLElement>(`button[data-call-id="call-${callId}"]`);
  // The calls run together fold under one line, which a press opens.
  const fold = container.querySelector<HTMLElement>("[data-turn-fold] > summary");
  act(() => fold?.click());
  assert.deepEqual(cardOn(row("message_coding_agent")), ["Invoice export", "Working…"]);
  const [archived, corner] = cardOn(row("read_coding_agent"));
  assert.equal(archived, "Retry audit");
  assert.match(corner ?? "", /^Archived · /u);
  assert.deepEqual(cardOn(row("start_coding_agent")), ["Coding agent", "Not found"]);
  assert.deepEqual(cardOn(row("delegate")), ["Audit the retry paths", "Working…"]);
});

/** A line a chat notice steered into the agent's turn, telling of message 43 from @agent-2. */
const NOTICE: CodingAgentMessage = {
  id: "notice",
  role: MESSAGE_ROLE.USER,
  parts: [
    { type: "text", text: "Chat: @agent-2 in #teammate-invitations asked about memberships." },
  ],
  metadata: { author: "agent", channel: "chat", chat_seq: 43, from: "agent-2" },
};

/** The notice drawn in an agent's transcript, beside the fixture's chat or none, every place it opens recorded. */
function noticeDrawn(withChat: boolean) {
  const opened: ChatPlace[] = [];
  const read = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(read);
  const chat = withChat
    ? {
        chat: read.answer,
        names: chatNames([], read.agents, undefined),
        onOpen: (place: ChatPlace) => opened.push(place),
      }
    : undefined;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentMessage, {
          message: NOTICE,
          plan: false,
          lead: AGENT_LEAD,
          moving: false,
          delegation: { models: [], chat },
        }),
      ),
    ),
  );
  return { container, opened };
}

test("a line a chat notice wrote draws as a card from its sender, naming the channel and the message's place, its words the message's own, and Open in Chat opens the channel", () => {
  const { container, opened } = noticeDrawn(true);
  const card = container.querySelector<HTMLElement>("[data-chat-notice]");
  assert.ok(card, "the notice draws as a card");
  assert.equal(container.querySelector(".is-user"), null);
  assert.equal(card.querySelector(".chat-notice-from")?.textContent, "@agent-2");
  assert.match(
    card.querySelector(".chat-notice-place")?.textContent ?? "",
    /^in #teammate-invitations · m 43 · /u,
  );
  assert.match(
    card.querySelector(".chat-notice-words")?.textContent ?? "",
    /^@agent-1 are you changing memberships columns\?/u,
  );
  const open = card.querySelector<HTMLButtonElement>(".chat-notice-open");
  act(() => open?.click());
  assert.deepEqual(opened, [{ kind: CHAT_PLACE.CHANNEL, channelId: read().channelOf(43) }]);
});

test("where the window holds no chat, a notice's card says its sender and place from the notice alone, its own words under them, with nothing to open", () => {
  const { container } = noticeDrawn(false);
  const card = container.querySelector<HTMLElement>("[data-chat-notice]");
  assert.equal(card?.querySelector(".chat-notice-from")?.textContent, "@agent-2");
  assert.equal(card?.querySelector(".chat-notice-place")?.textContent, "m 43");
  assert.equal(
    card?.querySelector(".chat-notice-words")?.textContent?.trim(),
    "Chat: @agent-2 in #teammate-invitations asked about memberships.",
  );
  assert.equal(card?.querySelector(".chat-notice-open"), null);
});

/** The fixture's chat, and the channel a message of it was posted in. */
function read() {
  const chat = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(chat);
  return {
    channelOf: (seq: number) =>
      chat.answer.messages.find((message) => message.seq === seq)?.channelId,
  };
}

test("a notice of a message holding no Markdown, a link alone, keeps the notice's own words under its head", () => {
  const read = fixtureChat({ fixtureMode: true }, 0);
  assert.ok(read);
  const answer = {
    ...read.answer,
    messages: read.answer.messages.map((message) =>
      message.seq === 43
        ? {
            ...message,
            blocks: [
              {
                type: "link" as const,
                url: "https://github.com/acme/relay/pull/214",
                label: "#214",
              },
            ],
          }
        : message,
    ),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AgentMessage, {
          message: NOTICE,
          plan: false,
          lead: AGENT_LEAD,
          moving: false,
          delegation: {
            models: [],
            chat: {
              chat: answer,
              names: chatNames([], read.agents, undefined),
              onOpen: () => undefined,
            },
          },
        }),
      ),
    ),
  );
  assert.equal(
    container.querySelector(".chat-notice-words")?.textContent?.trim(),
    "Chat: @agent-2 in #teammate-invitations asked about memberships.",
  );
});
