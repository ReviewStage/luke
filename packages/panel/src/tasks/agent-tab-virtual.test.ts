// @vitest-environment jsdom

import assert from "node:assert/strict";
import type {
  CodingAgentMessagesAnswerView,
  CodingAgentTranscriptPage,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement, type ReactNode, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { taskCards } from "../desktop/side-panel.js";
import { useTabViews } from "../desktop/strip-tabs.js";
import { FindScope } from "../find-in-tab.js";
import { FAKE_ANSWER, fakeActs } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { focusRestOn } from "../testing/hint-rest.js";
import { codingAgentsControl, pushedPage } from "../testing/tasks-control.js";
import { AgentTab, type TranscriptCards } from "./agent-tab.js";
import type { TranscriptFollower } from "./use-agent-transcript.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";

/**
 * agent-tab-virtual.test.ts -- a long agent transcript draws only the rows
 * near its view: it opens on its newest rows, a find counts and reaches a
 * match in a row it has not drawn, a page that lands leaves every message it
 * did not touch undrawn again, and older messages put before the first leave
 * the reader where they were.
 *
 * jsdom lays nothing out, so a row is as tall as the log takes one to be
 * before it is measured, the window stands in for the log's view, and the
 * log's scroll position is a value each scroll writes and is heard from.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

beforeEach(() => {
  // jsdom paints no highlights; the find's are kept as a browser keeps them.
  vi.stubGlobal("CSS", { highlights: new Map(), escape: (words: string) => words });
  vi.stubGlobal("Highlight", Set);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  delete document.documentElement.dataset.keyboard;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AGENT_ID = "4b0f6d3e-2c1a-4f5e-9d8c-7a6b5c4d3e2f";

const AGENT: CodingAgentSummary = {
  id: AGENT_ID,
  planId: "plan-1",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Long run",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** The transcript's `index`th message: the developer's line on the even ones, the agent's reply on the odd. */
function message(index: number, words = `Line ${index} of the run.`): CodingAgentMessage {
  return index % 2 === 0
    ? { id: `m-${index}`, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: words }] }
    : {
        id: `m-${index}`,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: "step-start" }, { type: "text", text: words }],
        startedAt: index * 1_000,
        finishedAt: index * 1_000 + 500,
      };
}

/** Messages `from` up to but not including `to`. */
function messages(from: number, to: number): CodingAgentMessage[] {
  return Array.from({ length: to - from }, (_, at) => message(from + at));
}

function page(
  held: readonly CodingAgentMessage[],
  before?: string,
): CodingAgentMessagesAnswerView & { before?: string } {
  return {
    messages: held,
    cursor: "1:1",
    status: CODING_AGENT_STATUS.COMPLETED,
    title: null,
    ...(before === undefined ? {} : { before }),
  };
}

/** A follower whose first page is answered at once and each later one when the test hands it. */
function following(first: CodingAgentMessagesAnswerView) {
  let hear: ((page: CodingAgentTranscriptPage) => void) | undefined;
  const follower: TranscriptFollower = (_transcript, heard) => {
    hear = heard;
    heard({ ...pushedPage(first), newest: true });
    return () => {
      hear = undefined;
    };
  };
  return {
    follower,
    async push(next: CodingAgentMessagesAnswerView) {
      await act(async () => {
        hear?.(pushedPage(next));
        await settled();
      });
    },
  };
}

async function settled(): Promise<void> {
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
}

/** The log's box as the window would lay it out: the room it shows, and every scroll written to it heard as the browser hears one. */
function layOut(box: HTMLElement): { readonly writes: number[] } {
  let top = 0;
  const writes: number[] = [];
  Object.defineProperty(box, "clientHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 1_000_000 });
  Object.defineProperty(box, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (to: number) => {
      writes.push(to);
      top = to;
    },
  });
  box.scrollTo = ((options: ScrollToOptions) => {
    box.scrollTop = options.top ?? top;
    box.dispatchEvent(new Event("scroll"));
  }) as typeof box.scrollTo;
  return { writes };
}

/** Scrolls the log to `top` as a reader would, so the log and its rows hear it. */
async function scrollTo(box: HTMLElement, top: number): Promise<void> {
  await act(async () => {
    box.scrollTop = top;
    box.dispatchEvent(new Event("scroll"));
    await settled();
  });
}

/** Draws the agent's tab over `control`, inside `wrap` where one is handed, and waits for its first page. */
async function drawTab(
  control: CodingAgentsControl,
  wrap: (tab: ReactElement) => ReactElement = (tab) => tab,
  cards?: TranscriptCards,
) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const tab = createElement(AgentTab, {
    agent: AGENT,
    control,
    shown: true,
    onOpenSubagent: () => undefined,
    onHeld: () => undefined,
    ...(cards === undefined ? {} : { cards }),
  });
  act(() => root?.render(onRegistry(AtomRegistry.make(), wrap(tab))));
  await act(settled);
  return {
    container,
    get box(): HTMLElement {
      return container.querySelector<HTMLElement>("[role=log]") ?? assert.fail("the log");
    },
  };
}

/** The keys of the rows the log draws now. */
function drawnRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-row-key]")].map(
    (row) => row.getAttribute("data-row-key") ?? "",
  );
}

test("a transcript of two thousand messages opens on its newest and draws a bounded number of rows", async () => {
  const { follower } = following(page(messages(0, 2_000)));
  const { container } = await drawTab(
    codingAgentsControl({ agents: [AGENT], transcripts: follower }),
  );
  const rows = drawnRows(container);
  assert.ok(rows.length > 0, "rows are drawn");
  assert.ok(rows.length <= 20, `${rows.length} rows are drawn`);
  assert.ok(rows.includes("m-1999"), "the newest message is drawn");
  assert.equal(container.querySelector('[data-message-id="m-0"]'), null, "the first is not");
});

/** Types into the find bar's field as the keyboard does, which React hears as an input. */
function typeFind(text: string): void {
  const field = document.querySelector<HTMLInputElement>(
    'search.find-bar input[aria-label="Find"]',
  );
  assert.ok(field, "the find bar stands open");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** What the find bar's tally says. */
function findTally(): string | null | undefined {
  return document.querySelector('search[aria-label="Find"] [aria-live="polite"]')?.textContent;
}

test("⌘F finds words in a row the log has not drawn, scrolls the log to it, and lights the match there", async () => {
  const held = messages(0, 400);
  held[7] = message(7, "The lantern is lit in the seventh reply.");
  const { follower } = following(page(held));
  const { container, box } = await drawTab(
    codingAgentsControl({ agents: [AGENT], transcripts: follower }),
    (tab) => createElement(FindScope, { active: true, subject: { agent: AGENT_ID } }, tab),
  );
  const { writes } = layOut(box);
  assert.ok(!drawnRows(container).includes("m-7"), "the seventh reply's row is not drawn");

  act(() => {
    runAppCommand(APP_COMMAND.FIND);
  });
  typeFind("lantern");
  await act(settled);

  assert.equal(findTally(), "1 of 1");
  assert.ok(writes.length > 0, "the log is scrolled");
  assert.ok(drawnRows(container).includes("m-7"), "the seventh reply's row is drawn");
  const lit = [...(CSS.highlights.get("find-current") ?? [])] as Range[];
  assert.equal(lit.length, 1, "one match is lit as the one the find is at");
  const litRange = lit[0] ?? assert.fail("the lit match");
  assert.equal(litRange.toString().toLowerCase(), "lantern");
  const litRow = litRange.startContainer.parentElement?.closest("[data-row-key]");
  assert.equal(litRow?.getAttribute("data-row-key"), "m-7");
});

/** The turn a running agent is still writing, as a page reads it. */
function writing(words: string): CodingAgentMessage {
  return {
    id: "newest",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, { type: "text", text: words }],
    startedAt: 9_000,
  };
}

function tool(name: string, callId: string, input: WireRecord, output: WireRecord): WireRecord {
  return { type: `tool-${name}`, toolCallId: callId, state: "output-available", input, output };
}

/** A finished turn that messaged another agent, whose row hangs that agent's card. */
const MESSAGED: CodingAgentMessage = {
  id: "messaged",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    { type: "step-start" },
    tool(
      "message_coding_agent",
      "call-message",
      { agentId: "agent-7", text: "Rebase" },
      {
        status: "accepted",
      },
    ),
    { type: "text", text: "Asked for a rebase." },
  ],
  startedAt: 1_000,
  finishedAt: 2_000,
};

test("a page that lands draws no message it did not touch again, the task's page holding what the tab drew without being drawn again", async () => {
  const running = { ...AGENT, status: CODING_AGENT_STATUS.RUNNING };
  const other: CodingAgentSummary = { ...AGENT, id: "agent-7", title: "Invoice export" };
  const { follower, push } = following({
    ...page([message(0), MESSAGED, writing("Reading.")]),
    status: CODING_AGENT_STATUS.RUNNING,
  });
  const control = codingAgentsControl({ agents: [running, other], transcripts: follower });
  // Each time the card the earlier turn's row hangs is drawn.
  let cardDraws = 0;
  function DrawnCard({ card }: { card: ReactNode }): ReactNode {
    cardDraws += 1;
    return card;
  }
  // The task's page as the window draws it: what the tabs hold, and the cards their rows hang, read from it.
  function TaskPage(): ReactNode {
    const views = useTabViews();
    const cards = useMemo(
      () =>
        taskCards({ agents: control, held: views.held, chosen: () => false, shownCode: [] }).agent(
          AGENT_ID,
        ),
      [views.held],
    );
    const counted = useMemo<TranscriptCards>(
      () => ({
        ...cards,
        target: (target) => createElement(DrawnCard, { card: cards.target(target) }),
      }),
      [cards],
    );
    return createElement(AgentTab, {
      agent: running,
      control,
      shown: true,
      cards: counted,
      onOpenSubagent: () => undefined,
      onOpenTarget: () => undefined,
      onHeld: views.onAgentHeld,
    });
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), createElement(TaskPage))));
  await act(settled);
  // The earlier turn's card stands open, as the pointer resting on its row hangs it.
  const chip = container.querySelector<HTMLElement>(
    '[data-call-id="call-message"] [data-tool-agent-ref]',
  );
  assert.ok(chip, "the earlier turn's row names the agent it messaged");
  document.documentElement.dataset.keyboard = "true";
  focusRestOn(chip);
  assert.ok(cardDraws > 0, "the card is drawn");

  cardDraws = 0;
  await push({ ...page([writing("Reading the audit.")]), status: CODING_AGENT_STATUS.RUNNING });
  assert.match(
    container.querySelector('[data-message-id="newest"]')?.textContent ?? "",
    /Reading the audit\./u,
  );
  assert.equal(cardDraws, 0, "the earlier turn is not drawn again");
});

test("older messages put before the first under a long log leave the row the reader was on where it stood", async () => {
  const { follower } = following(page(messages(100, 160), "100"));
  // The older page is answered once the test hands it, after the reader has scrolled.
  let release: () => void = () => undefined;
  const handed = new Promise<void>((resolve) => {
    release = resolve;
  });
  fakeActs({
    act: (request) =>
      request.kind === ACT_KIND.CODING_AGENTS_TRANSCRIPT_OLDER
        ? handed.then(() => ({ status: FAKE_ANSWER.DONE, value: { messages: messages(90, 100) } }))
        : Promise.resolve({ status: FAKE_ANSWER.REFUSED, reason: "Not here." }),
  });
  const { container, box } = await drawTab(
    codingAgentsControl({ agents: [AGENT], transcripts: follower }),
  );
  layOut(box);
  // The log stands at its newest line, and the reader scrolls up near its top, onto the second message.
  await scrollTo(box, 1_000_000 - 600);
  await scrollTo(box, 300);
  assert.ok(drawnRows(container).includes("m-101"), "the row the reader is on is drawn");
  await act(async () => {
    release();
    await settled();
  });
  assert.ok(drawnRows(container).includes("m-99"), "the older messages landed");
  // Ten rows landed above, each a row and the step between two.
  assert.equal(box.scrollTop, 300 + 10 * (160 + 12));
  assert.ok(drawnRows(container).includes("m-101"), "the row the reader was on is still drawn");
});

/** A read the test answers when it hands the answer. */
function handed<T>(): {
  readonly read: () => Promise<T>;
  readonly hand: (answer: T) => Promise<void>;
} {
  let answer: (value: T) => void = () => undefined;
  const pending = new Promise<T>((resolve) => {
    answer = resolve;
  });
  return {
    read: () => pending,
    hand: async (value) => {
      await act(async () => {
        answer(value);
        await settled();
      });
    },
  };
}

test("the log first draws once the agent's pull request is read, so its dock never lands under lines already drawn", async () => {
  const { follower } = following(page(messages(0, 6)));
  const published = handed<{
    repository: string | null;
    branch: string | null;
    pullRequest: {
      number: number;
      title: string;
      url: string;
      state: "open";
      checks: "passing";
      additions: number;
      deletions: number;
      changedFiles: number;
    } | null;
  }>();
  const { container } = await drawTab(
    codingAgentsControl({
      agents: [AGENT],
      transcripts: follower,
      readPullRequest: published.read,
    }),
  );
  assert.equal(drawnRows(container).length, 0, "no line is drawn while the pull request is read");
  assert.ok(
    container.querySelector(".agent-tab > .agent-log-wait > [aria-busy]"),
    "the tab stands as loading",
  );

  await published.hand({
    repository: "acme/app",
    branch: "luke/invites",
    pullRequest: {
      number: 12,
      title: "Invite emails",
      url: "https://github.com/acme/app/pull/12",
      state: "open",
      checks: "passing",
      additions: 1,
      deletions: 1,
      changedFiles: 1,
    },
  });
  assert.ok(drawnRows(container).length > 0, "the lines are drawn");
  assert.ok(container.querySelector(".agent-published-dock"), "with the dock already over the box");
});

test("the log first draws once the calls its lines were said on are read, so no call's divider lands between rows already drawn", async () => {
  const CALL = "call-session-1";
  const said: CodingAgentMessage = {
    id: "m-said",
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text: "Ship it." }],
    metadata: { author: "developer", channel: "typed", voice_session_id: CALL, from_ms: 20_000 },
  };
  const { follower } = following(page([message(0), message(1), said, message(3)]));
  const calls = handed<Awaited<ReturnType<CodingAgentsControl["readCalls"]>>>();
  const { container } = await drawTab(
    codingAgentsControl({ agents: [AGENT], transcripts: follower, readCalls: calls.read }),
  );
  assert.equal(drawnRows(container).length, 0, "no line is drawn while the calls are read");

  await calls.hand({ failure: "unanswered" } as Awaited<
    ReturnType<CodingAgentsControl["readCalls"]>
  >);
  assert.ok(drawnRows(container).length > 0, "a read that did not answer lets the lines draw");
});
