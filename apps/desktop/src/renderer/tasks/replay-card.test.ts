// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  firstMessageText,
  REPLAY_SENDER,
  REPLAY_STEP_KIND,
  type Replay,
} from "@luke/features/agent-replay";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace, type ReadLink } from "@luke/features/luke-link";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { markdownHtmlParserLanded } from "#testing/markdown";
import { codingAgentsControl } from "#testing/tasks-control";
import { AgentTab, type TranscriptCards } from "./agent-tab";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import { OpenLinkProvider } from "./use-open-link";

/**
 * replay-card.test.ts -- an agent started from another opens on the brief
 * as its source's did, then one folded card saying Continued or Forked from
 * the source's chip and how many of its steps, which opens onto the steps
 * one row each, every step onto its words exactly, and the way back to the
 * source's transcript, then the developer's note as their own line. No
 * marker its first message holds is drawn, and a message whose markers do
 * not add up is drawn whole as today. Synthetic throughout.
 */

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const DEAN = { userId: "user-dean", name: "Dean Stratakos" };
const CHARLES = { userId: "user-charles", name: "Charles Pan" };
/** When the new agent's first message was sent. */
const SENT_AT = Date.UTC(2026, 9, 14, 15, 42);
const FORKED_AT = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function summary(overrides: Partial<CodingAgentSummary> & { id: string }): CodingAgentSummary {
  return {
    planId: PLAN_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: 1_000,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    startedBy: DEAN,
    ...overrides,
  };
}

const SOURCE = summary({
  id: "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b",
  title: "Wire the start from field",
  status: CODING_AGENT_STATUS.FAILED,
});

const STEPS: Replay["steps"] = [
  {
    kind: REPLAY_STEP_KIND.LINE,
    summary: "Charles Pan: Use seven days.",
    words: "Use seven days.",
  },
  {
    kind: REPLAY_STEP_KIND.TOOL,
    summary: "Read: src/invite.ts",
    words: 'Input: {"filePath":"src/invite.ts"}\nResult: export const INVITE_DAYS = 7;',
  },
  { kind: REPLAY_STEP_KIND.SAID, summary: "Said: Seven days it is.", words: "Seven days it is." },
];

const PREAMBLE = "Below is the work of the agent you continue from.";

function replay(overrides: Partial<Replay> = {}): Replay {
  return { agentId: SOURCE.id, preamble: PREAMBLE, steps: STEPS, totalSteps: 3, ...overrides };
}

/** The source's tile as its tab wears it. */
const SOURCE_TILE: Actor = {
  kind: ACTOR_KIND.AGENT,
  agentId: SOURCE.id,
  name: "Wire the start from field",
  provider: undefined,
  state: ACTOR_STATE.REST,
};

let root: Root | undefined;

// The words are drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The new agent's tab drawn with its first message as given, sent when given, every tab and place it opens recorded. */
async function drawn(
  agent: CodingAgentSummary,
  first: string,
  source = SOURCE,
  listed = true,
  sentAt?: number,
) {
  const opened: ToolTarget[] = [];
  const places: LinkPlace[] = [];
  const messages: readonly CodingAgentMessage[] = [
    {
      id: "first",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: first }],
      ...(sentAt === undefined ? undefined : { sentAt }),
    },
    { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text: "On it." }] },
  ];
  // Note that only the first read answers, because a read past the cursor waits on the service.
  let reads = 0;
  const control = codingAgentsControl({
    agents: [agent],
    // An agent's own page lists that agent alone, and reads any other by its id.
    archived: listed ? [source] : [],
    readAgent: (agentId) => Promise.resolve(agentId === source.id ? source : undefined),
    me: DEAN.userId,
    readTranscript: (): Promise<CodingAgentMessagesAnswerView> => {
      reads += 1;
      if (reads > 1) return Promise.resolve({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      return Promise.resolve({
        messages: [...messages],
        cursor: "2:0",
        status: CODING_AGENT_STATUS.COMPLETED,
        title: null,
      });
    },
    readPullRequest: () =>
      Promise.resolve({
        repository: "acme/app",
        branch: "luke/start-from",
        pullRequest: null,
      }),
  });
  const cards: TranscriptCards = {
    target: () => undefined,
    worker: () => undefined,
    agent: (agentId) => (listed && agentId === SOURCE.id ? SOURCE_TILE : undefined),
  };
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(OpenLinkProvider, {
          value: (link: ReadLink) => places.push(link.place),
          children: createElement(AgentTab, {
            agent,
            control,
            shown: true,
            cards,
            onOpenTarget: (target) => opened.push(target),
            onOpenSubagent: () => undefined,
            onHeld: () => undefined,
          }),
        }),
      ),
    ),
  );
  await settle();
  return { container, opened, places };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function press(element: Element | null | undefined): void {
  assert.ok(element instanceof HTMLElement);
  act(() => element.click());
}

/** The card's summary row as a reader reads it, its spacing made one. */
function headOf(container: Element): string {
  const head = container.querySelector("[data-replay-card] > summary");
  return (head?.textContent ?? "").replace(/\s+/gu, " ").trim();
}

/** The line under the replay card as a reader reads it: whom it names, if anyone, and the moment its time stands for. */
function cardMeta(container: Element) {
  const meta = container.querySelector("[data-replay-card] ~ .message-meta");
  assert.ok(meta !== null);
  return {
    sender: meta.querySelector(".message-sender .luke-inline-ref-label")?.textContent ?? undefined,
    at: meta.querySelector("time")?.getAttribute("dateTime") ?? undefined,
  };
}

/** A replay of `count` steps, the agent's words each, numbered from the oldest. */
function longReplay(count: number, overrides: Partial<Replay> = {}): Replay {
  const steps: Replay["steps"] = Array.from({ length: count }, (_, at) => ({
    kind: REPLAY_STEP_KIND.SAID,
    summary: `Said: Step ${at + 1}.`,
    words: `Step ${at + 1}.`,
  }));
  return replay({ steps, totalSteps: count, ...overrides });
}

/** The button that draws the page of steps before the ones drawn, by its words, while one stands. */
function earlierRow(container: Element): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").endsWith("earlier steps"),
    ) ?? null
  );
}

/** The steps the opened card draws, by their words. */
function drawnSteps(container: Element): string[] {
  return [...container.querySelectorAll("[data-replay-step]")].map((step) =>
    (step.textContent ?? "").trim(),
  );
}

test("an agent continued from another opens on the plan's card, the folded Continued card under who started it, and the note as the developer's line, with no marker drawn", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
    from: { agentId: SOURCE.id, steps: 3, totalSteps: 3 },
  });
  const { container, opened } = await drawn(
    agent,
    firstMessageText("# Invite flow\n\nLet admins withdraw invites.", replay(), "Try five days."),
  );

  const cards = [...container.querySelectorAll(".agent-origin")];
  assert.equal(cards.length, 2);
  // The plan's card is titled by the brief's first line.
  assert.match(
    cards[0]?.querySelector("[data-task-card] > summary")?.textContent ?? "",
    /Invite flow/u,
  );
  assert.equal(headOf(container), "Continued from Wire the start from field · 3 steps");
  // The reader started it, and the message's time is unknown, so the card names nobody under it.
  assert.equal(cards[1]?.querySelector(":scope > .message-meta"), null);
  // The note is the developer's own bubble after the card.
  const bubbles = [...container.querySelectorAll(".is-user")].filter(
    (each) => !each.classList.contains("agent-origin"),
  );
  assert.equal(bubbles.length, 1);
  assert.match(bubbles[0]?.textContent ?? "", /Try five days\./u);
  // The note is a part of the first message, drawn under no id of the transcript's, so neither a link to the first message nor a Copy link under the note brings the wrong one into view.
  assert.equal(cards[0]?.getAttribute("data-message-id"), "first");
  assert.notEqual(bubbles[0]?.getAttribute("data-message-id"), "first");
  assert.ok(!container.textContent?.includes("<!--"));
  assert.ok(!container.textContent?.includes("The work you continue from"));
  assert.ok(!container.textContent?.includes("Note from the developer"));

  // The source's chip opens its tab, and leaves the card folded.
  press(container.querySelector("[data-replay-card] > summary [data-actor-ref]"));
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.AGENT, agent: SOURCE.id }]);
  assert.equal(container.querySelector("[data-replay-step]"), null);
});

test("opened, the card draws each step as a transcript does, a line as a sent message under its sender, the agent's words as words, and a call as a call's row opening onto its input and result, and a continuation's transcript opens on the source's tab", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const { container, opened, places } = await drawn(
    agent,
    firstMessageText("# Invite flow", replay(), undefined),
  );
  press(container.querySelector("[data-replay-card] > summary"));
  await settle();

  const body = container.querySelector("[data-replay-card] .luke-disclosure-body");
  assert.match(
    body?.textContent ?? "",
    /What this agent was handed of Wire the start from field's work/u,
  );
  assert.match(body?.textContent ?? "", /Builds on luke\/start-from/u);
  assert.doesNotMatch(body?.textContent ?? "", /left out/u);
  const steps = [...container.querySelectorAll("[data-replay-step]")];
  assert.deepEqual(
    steps.map((step) => step.getAttribute("data-replay-step")),
    ["line", "tool", "said"],
  );
  // A line is a sent message, named by whoever sent it, Charles here though Dean started the source.
  const [line, call, said] = steps;
  assert.ok(line?.classList.contains("is-user"));
  assert.match(line?.textContent ?? "", /Use seven days\./u);
  assert.equal(line?.querySelector(".message-sender")?.textContent, "Charles Pan");
  assert.match(said?.textContent ?? "", /Seven days it is\./u);
  // A call is a call's row, its verb and subject on the line, folded until opened.
  const head = call?.querySelector("summary");
  assert.match(head?.textContent ?? "", /Read/u);
  assert.match(head?.textContent ?? "", /src\/invite\.ts/u);
  assert.doesNotMatch(call?.textContent ?? "", /INVITE_DAYS/u);
  press(head);
  assert.match(call?.textContent ?? "", /"filePath":"src\/invite\.ts"/u);
  assert.match(call?.textContent ?? "", /export const INVITE_DAYS = 7;/u);

  press(container.querySelector("[data-replay-open]"));
  assert.deepEqual(opened, [{ kind: TOOL_TARGET.AGENT, agent: SOURCE.id }]);
  assert.deepEqual(places, []);
});

test("a fork trimmed of its earliest steps says Forked and its steps of how many, says how many were left out, and opens the source's transcript at the message it was cut at", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PROMPT,
  });
  const { container, places } = await drawn(
    agent,
    firstMessageText(
      "Find why the toast fires twice.",
      replay({ messageId: FORKED_AT, totalSteps: 212 }),
      undefined,
    ),
  );
  assert.equal(headOf(container), "Forked from Wire the start from field · 3 of 212 steps");
  // The prompt is the developer's bubble, as the source's was, holding the brief alone.
  const prompt = container.querySelector(".is-user:not(.agent-origin)");
  assert.equal(prompt?.textContent?.includes("Find why the toast fires twice."), true);
  assert.equal(prompt?.textContent?.includes(PREAMBLE), false);

  press(container.querySelector("[data-replay-card] > summary"));
  await settle();
  assert.match(
    container.querySelector("[data-replay-card] .luke-disclosure-body")?.textContent ?? "",
    /209 earlier steps were left out to keep the replay within its size limit\./u,
  );
  press(container.querySelector("[data-replay-open]"));
  assert.deepEqual(places, [
    { kind: LINK_PLACE.MESSAGE, planId: PLAN_ID, agentId: SOURCE.id, messageId: FORKED_AT },
  ]);
});

test("an agent continued from an automation's run opens on the run's Prompt card under the automation, though it is no run itself", async () => {
  const run: CodingAgentSummary = {
    ...SOURCE,
    automationId: "22222222-2222-4222-8222-222222222222",
    automationName: "Nightly triage",
  };
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PROMPT,
    from: { agentId: run.id, steps: 3, totalSteps: 3 },
  });
  const { container } = await drawn(
    agent,
    firstMessageText("Triage the failing check.", replay(), undefined),
    run,
  );
  const prompt = container.querySelector(".agent-origin [data-task-card]");
  assert.equal(prompt?.getAttribute("aria-label"), "Prompt");
  assert.match(
    container.querySelector(".agent-origin .message-sender")?.textContent ?? "",
    /Nightly triage/u,
  );
  assert.equal(headOf(container), "Continued from Wire the start from field · 3 steps");
});

test("a first message whose markers do not add up is drawn whole as the plan's card, with no replay card", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const text = firstMessageText("# Invite flow", replay(), undefined).replace(
    "steps=3 total-steps=3",
    "steps=4 total-steps=3",
  );
  const { container } = await drawn(agent, text);
  assert.equal(container.querySelector("[data-replay-card]"), null);
  assert.equal(container.querySelectorAll(".agent-origin").length, 1);
  press(container.querySelector("[data-task-card] > summary"));
  assert.match(container.querySelector("[data-task-card]")?.textContent ?? "", /Use seven days\./u);
});

test("on an agent's own page, which lists no source, the card names the source as a read of it does, wearing its harness's mark, and opens it as a link to it would", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const { container, opened, places } = await drawn(
    agent,
    firstMessageText("# Invite flow", replay(), undefined),
    SOURCE,
    false,
  );
  assert.equal(headOf(container), "Continued from Wire the start from field · 3 steps");
  // The read named the source's model, so its chip wears its harness's mark rather than the empty box of none known.
  const mark = container.querySelector("[data-replay-card] > summary .actor-mark svg");
  assert.ok((mark?.childElementCount ?? 0) > 0);
  press(container.querySelector("[data-replay-card] > summary [data-actor-ref]"));
  assert.deepEqual(opened, []);
  assert.deepEqual(places, [{ kind: LINK_PLACE.AGENT, planId: PLAN_ID, agentId: SOURCE.id }]);
});

test("a replay holding Luke's summary of the oldest steps opens on one folded row naming it as his, which opens onto the summary", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const { container } = await drawn(
    agent,
    firstMessageText(
      "# Invite flow",
      replay({
        summary: { text: "Read the invite code and its tests.", steps: 174 },
        totalSteps: 177,
      }),
      undefined,
    ),
  );
  assert.equal(headOf(container), "Continued from Wire the start from field · 3 of 177 steps");
  press(container.querySelector("[data-replay-card] > summary"));
  await settle();
  const row = container.querySelector("[data-replay-summary]");
  assert.equal(row?.textContent, "Summary of 174 earlier steps (written by Luke)");
  // The summary stands for the steps it summarized, so none is said to be left out.
  assert.doesNotMatch(
    container.querySelector("[data-replay-card] .luke-disclosure-body")?.textContent ?? "",
    /left out/u,
  );
  // It stands ahead of the steps.
  const first = container.querySelector("[data-replay-step]");
  assert.ok(row !== null && first !== null);
  assert.ok(row.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  press(row.querySelector("summary"));
  assert.match(row.textContent ?? "", /Read the invite code and its tests\./u);
});

test("a replayed line is named under its sender as a transcript names one: Luke, an automation, GitHub, and a teammate by their own marks, the reader's own by nobody, and a line from before senders were marked by its name", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const line = (summary: string, sender?: NonNullable<Replay["steps"][number]["sender"]>) => ({
    kind: REPLAY_STEP_KIND.LINE,
    summary,
    words: "Go.",
    ...(sender === undefined ? undefined : { sender }),
  });
  const steps: Replay["steps"] = [
    line("Luke: Go.", { kind: REPLAY_SENDER.LUKE }),
    line("Nightly: deploy: Go.", { kind: REPLAY_SENDER.AUTOMATION }),
    line("octocat: Go.", { kind: REPLAY_SENDER.GITHUB }),
    line("The developer: Go.", { kind: REPLAY_SENDER.DEVELOPER }),
    // The reader's own line, sent as a member, names nobody either.
    line("Dean Stratakos: Go.", { kind: REPLAY_SENDER.MEMBER, memberId: DEAN.userId }),
    line("Ana Ruiz: Go.", { kind: REPLAY_SENDER.MEMBER, memberId: "user-ana" }),
    line("Charles Pan: Go."),
  ];
  const { container } = await drawn(
    agent,
    firstMessageText("# Invite flow", replay({ steps, totalSteps: steps.length }), undefined),
  );
  press(container.querySelector("[data-replay-card] > summary"));
  await settle();
  const senders = [...container.querySelectorAll("[data-replay-step]")].map((step) => {
    const sender = step.querySelector(".message-sender");
    if (sender === null) return null;
    const ref = sender.querySelector<HTMLElement>("[data-actor-ref]");
    const name = ref?.querySelector(".luke-inline-ref-label")?.textContent ?? sender.textContent;
    return [ref?.dataset.kind ?? "", name ?? ""];
  });
  assert.deepEqual(senders, [
    [ACTOR_KIND.LUKE, "Luke"],
    [ACTOR_KIND.AUTOMATION, "Nightly: deploy"],
    [ACTOR_KIND.GITHUB, "octocat"],
    null,
    null,
    [ACTOR_KIND.PERSON, "Ana Ruiz"],
    ["", "Charles Pan"],
  ]);
  assert.doesNotMatch(
    container.querySelector("[data-replay-card] .luke-disclosure-body")?.textContent ?? "",
    /\bYou\b/u,
  );
});

test("the line under the card says when the reader's own agent was started, naming nobody, as the reader's own lines are", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const { container } = await drawn(
    agent,
    firstMessageText("# Invite flow", replay(), undefined),
    SOURCE,
    true,
    SENT_AT,
  );
  assert.deepEqual(cardMeta(container), {
    sender: undefined,
    at: new Date(SENT_AT).toISOString(),
  });
  assert.doesNotMatch(
    container.querySelector("[data-replay-card] ~ .message-meta")?.textContent ?? "",
    /You|·/u,
  );
});

test("the line under the card names a teammate who started the agent by their face and name, then when, as a teammate's line is", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
    startedBy: CHARLES,
  });
  const { container } = await drawn(
    agent,
    firstMessageText("# Invite flow", replay(), undefined),
    SOURCE,
    true,
    SENT_AT,
  );
  assert.deepEqual(cardMeta(container), {
    sender: "Charles Pan",
    at: new Date(SENT_AT).toISOString(),
  });
  assert.match(
    container.querySelector("[data-replay-card] ~ .message-meta .message-sent-at")?.textContent ??
      "",
    /^·/u,
  );
});

test("opened, a long replay draws its newest twenty steps under a row that draws twenty more a press, until every step is drawn and the keys land on them", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const { container } = await drawn(
    agent,
    firstMessageText("# Invite flow", longReplay(45), undefined),
  );
  press(container.querySelector("[data-replay-card] > summary"));
  await settle();
  const numbered = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, at) => `Step ${from + at}.`);
  assert.deepEqual(drawnSteps(container), numbered(26, 45));
  const row = () => earlierRow(container);
  assert.equal(row()?.textContent, "Show 20 of 25 earlier steps");
  // The row stands over the steps it draws more of.
  const first = container.querySelector("[data-replay-step]");
  assert.ok(first !== null && row() !== null);
  assert.ok((row()?.compareDocumentPosition(first) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING);

  press(row());
  assert.deepEqual(drawnSteps(container), numbered(6, 45));
  assert.equal(row()?.textContent, "Show 5 earlier steps");

  press(row());
  assert.deepEqual(drawnSteps(container), numbered(1, 45));
  assert.equal(row(), null);
  // The row went with the last page, and the keys stand on the steps it drew rather than on nothing.
  assert.equal(document.activeElement, container.querySelector("[data-replay-steps]"));
  // The replay kept every step, so none is said to be left out.
  assert.doesNotMatch(
    container.querySelector("[data-replay-card] .luke-disclosure-body")?.textContent ?? "",
    /left out/u,
  );
});

test("Luke's summary and the steps left out stand over the earlier-steps row, which pages only the steps the replay kept", async () => {
  const agent = summary({
    id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
    brief: CODING_AGENT_BRIEF.PLAN,
  });
  const { container } = await drawn(
    agent,
    firstMessageText(
      "# Invite flow",
      longReplay(30, {
        summary: { text: "Read the invite code and its tests.", steps: 100 },
        totalSteps: 140,
      }),
      undefined,
    ),
  );
  assert.equal(headOf(container), "Continued from Wire the start from field · 30 of 140 steps");
  press(container.querySelector("[data-replay-card] > summary"));
  await settle();
  const body = container.querySelector("[data-replay-card] .luke-disclosure-body");
  const summaryRow = body?.querySelector("[data-replay-summary]");
  const left = [...(body?.querySelectorAll("p") ?? [])].find((each) =>
    /left out/u.test(each.textContent ?? ""),
  );
  const row = body === null || body === undefined ? undefined : earlierRow(body);
  const step = body?.querySelector("[data-replay-step]");
  assert.equal(
    left?.textContent,
    "10 earlier steps were left out to keep the replay within its size limit.",
  );
  assert.equal(row?.textContent, "Show 10 earlier steps");
  const order = [summaryRow, left, row, step];
  for (const [at, element] of order.entries()) {
    const next = order[at + 1];
    if (next === undefined) continue;
    assert.ok(element instanceof Element && next instanceof Element);
    assert.ok(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  press(row);
  assert.equal(body?.querySelectorAll("[data-replay-step]").length, 30);
  // Every kept step drawn, the summary and the line saying what was left out still stand as they did.
  assert.equal(
    body?.querySelector("[data-replay-summary]")?.textContent,
    "Summary of 100 earlier steps (written by Luke)",
  );
  assert.match(body?.textContent ?? "", /10 earlier steps were left out/u);
});
