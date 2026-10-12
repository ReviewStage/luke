// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentInboxAnsweredView,
  type CodingAgentInboxAnswerParams,
  type CodingAgentInboxAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import {
  INBOX_CURSOR_START,
  INBOX_KIND,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
} from "@sidecar/hosted/inbox-wire";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/plans-control";
import { InboxBoard } from "./inbox-board";
import type { CodingAgentsControl } from "./use-coding-agents";
import { INBOX_NOT_TAKEN_NOTE, usePlanInbox } from "./use-plan-inbox";

const PLAN = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: PLAN,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invitations",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

/** An item of the agent's, open, as the service answers one. */
function item(overrides: Partial<InboxItem> & Pick<InboxItem, "id" | "kind" | "title">): InboxItem {
  return {
    agentId: AGENT.id,
    key: "item",
    revision: 1,
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

const QUEUE = item({
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  key: "invite-queue",
  kind: INBOX_KIND.CHOICE,
  title: "Which queue sends the invitation emails?",
  details: "The repo already runs **Postgres**.",
  options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
  recommended: "Postgres outbox",
});

const SETTINGS = item({
  id: "a1b2c3d4-0000-4000-8000-000000000002",
  key: "branch-protection",
  kind: INBOX_KIND.TASK,
  title: "Require a review on `main`",
  needsReply: false,
  postedAt: 2_000,
  updatedAt: 2_000,
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/**
 * The plan's agents over a service whose inbox answers each read with the
 * next of `pages`, holding every read past them, and answers each answer
 * with the next of `answers`, recording what was sent.
 */
function service(
  pages: CodingAgentInboxAnswerView[],
  answers: ((sent: CodingAgentInboxAnswerParams) => CodingAgentInboxAnsweredView)[],
) {
  const sent: CodingAgentInboxAnswerParams[] = [];
  const reads: string[] = [];
  const listReads: number[] = [];
  const agents = codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    onRetryList: () => listReads.push(listReads.length),
    readInbox: ({ after }) => {
      reads.push(after);
      const page = pages.shift();
      return page === undefined ? new Promise(() => undefined) : Promise.resolve(page);
    },
    answerInbox: (params) => {
      sent.push(params);
      const next = answers.shift();
      return Promise.resolve(
        next === undefined ? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } : next(params),
      );
    },
  });
  return { agents, sent, reads, listReads };
}

/**
 * The plan's column as it holds the inbox: the control over the open plan,
 * standing whichever tab is chosen, and the board drawn while the Inbox tab
 * is the chosen one.
 */
function Tab({
  agents,
  planId = PLAN,
  chosen = true,
}: {
  agents: CodingAgentsControl;
  planId?: string;
  chosen?: boolean;
}) {
  const inbox = usePlanInbox({ planId, shown: true, agents });
  return chosen
    ? createElement(InboxBoard, { control: inbox, agents, onOpenAgent: () => undefined })
    : null;
}

/** The tab mounted on the plan given, answering the page, a way to open another plan in its place, and a way to choose another tab and come back. */
function mounted(agents: CodingAgentsControl, registry: Parameters<typeof onRegistry>[0]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (planId: string, chosen: boolean) =>
    act(() => root.render(onRegistry(registry, createElement(Tab, { agents, planId, chosen }))));
  draw(PLAN, true);
  return {
    page: container,
    open: (planId: string) => draw(planId, true),
    choose: (chosen: boolean) => draw(PLAN, chosen),
  };
}

function mount(agents: CodingAgentsControl, registry: Parameters<typeof onRegistry>[0]) {
  return mounted(agents, registry).page;
}

/** Lets every promise settled so far run its continuations. */
const settle = Effect.promise(() =>
  act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  }),
);

function press(control: Element | null | undefined): void {
  assert.ok(control instanceof HTMLElement, "nothing to press");
  act(() => control.click());
}

function card(page: HTMLElement, id: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
  assert.ok(found, `no card for ${id}`);
  return found;
}

/** The button a reader hears by these words: its own, or its label where it is a glyph. */
function buttonNamed(scope: HTMLElement, words: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll("button")].find(
    (each) => each.textContent?.trim() === words || each.getAttribute("aria-label") === words,
  );
  assert.ok(button, `no ${words} button`);
  return button;
}

/** Types into a box as the developer does, through React's own value setter. */
function type(box: HTMLTextAreaElement | null, words: string): void {
  assert.ok(box);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(box, words);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The service's answer taking what was sent: the item answered as sent. */
const taking =
  (standing: InboxItem) =>
  (sent: CodingAgentInboxAnswerParams): CodingAgentInboxAnsweredView => ({
    item: {
      ...standing,
      status: INBOX_STATUS.ANSWERED,
      answer: {
        reply: sent.reply,
        ...(sent.choice === undefined ? undefined : { choice: sent.choice }),
        ...(sent.note === undefined ? undefined : { note: sent.note }),
      },
      updatedAt: 9_000,
    },
    taken: true,
  });

it.effect(
  "the plan's open items are drawn the oldest first with their context and controls, a choice's recommendation marked and a task its agent need not hear back from saying so; a later read adds what landed",
  () =>
    Effect.gen(function* () {
      const later = item({
        id: "a1b2c3d4-0000-4000-8000-000000000003",
        kind: INBOX_KIND.APPROVAL,
        title: "Drop the legacy table?",
        postedAt: 3_000,
        updatedAt: 3_000,
      });
      const { agents, reads } = service(
        [
          { items: [SETTINGS, QUEUE], cursor: "2000.2" },
          { items: [later, SETTINGS, QUEUE], cursor: "3000.3" },
        ],
        [],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;

      assert.ok(page.querySelector(".inbox-board.ph-no-capture"), "the recording leaves it out");
      assert.deepEqual(
        [...page.querySelectorAll("article [data-inbox-title]")].map((title) => title.textContent),
        [
          "Which queue sends the invitation emails?",
          "Require a review on main",
          "Drop the legacy table?",
        ],
      );
      assert.deepEqual(reads, [INBOX_CURSOR_START, "2000.2", "3000.3"], "each read past the last");
      assert.equal(page.querySelectorAll("article[data-item-id]").length, 3);
      assert.deepEqual(
        [...card(page, QUEUE.id).querySelectorAll(".inbox-option")].map((each) => each.textContent),
        ["Postgres outbox · RecommendedNo new service.", "Redis"],
      );
      assert.equal(
        card(page, QUEUE.id).querySelector("[data-inbox-details]")?.textContent,
        "The repo already runs Postgres.",
      );
      assert.ok(card(page, SETTINGS.id).querySelector("[data-inbox-quiet]"));
      assert.equal(card(page, QUEUE.id).querySelector("[data-inbox-quiet]"), null);
      assert.ok(buttonNamed(card(page, later.id), "Approve"));
    }),
);

it.effect(
  "a pick sent answers the item with the option and the note under a key of its own, and the card settles saying what was said",
  () =>
    Effect.gen(function* () {
      const { agents, sent } = service([{ items: [QUEUE], cursor: "1000.1" }], [taking(QUEUE)]);
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;
      const queue = card(page, QUEUE.id);
      assert.equal(buttonNamed(queue, "Send to agent").disabled, true, "nothing picked yet");
      press(buttonNamed(queue, "Redis"));
      type(queue.querySelector("textarea"), "Keep it simple.");
      press(buttonNamed(queue, "Send to agent"));
      yield* settle;

      assert.equal(sent.length, 1);
      const [answer] = sent;
      assert.deepEqual(
        { ...answer, clientKey: undefined },
        {
          itemId: QUEUE.id,
          revision: 1,
          reply: INBOX_REPLY.CHOSE,
          choice: "Redis",
          note: "Keep it simple.",
          clientKey: undefined,
        },
      );
      assert.ok((answer?.clientKey ?? "").length > 0);
      assert.equal(page.querySelectorAll("article[data-item-id]").length, 0);
      const settledFold = page.querySelector<HTMLElement>("[data-inbox-settled] > summary");
      assert.equal(settledFold?.textContent, "Settled · 1");
      press(settledFold);
      const settled = card(page, QUEUE.id);
      assert.equal(
        settled.querySelector("summary")?.textContent,
        "Chose Redis · Which queue sends the invitation emails?",
      );
      press(settled.querySelector("summary"));
      assert.ok(settled.textContent?.includes("Keep it simple."), "the note inside");
    }),
);

it.effect(
  "an answer that did not go says why on its card and leaves it waiting, and the same answer again goes under the same key; one the agent changed first is not taken, and the card says so over the item as it now stands",
  () =>
    Effect.gen(function* () {
      const changed = { ...SETTINGS, revision: 2, title: "Require two reviews on `main`" };
      const { agents, sent } = service(
        [{ items: [SETTINGS], cursor: "2000.1" }],
        [
          () => ({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }),
          () => ({ item: changed, taken: false }),
        ],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;

      press(buttonNamed(card(page, SETTINGS.id), "Done"));
      yield* settle;
      assert.equal(
        card(page, SETTINGS.id).querySelector(".agent-note")?.textContent,
        "Luke didn't hear back. Retry sends it again, once.",
      );
      press(buttonNamed(card(page, SETTINGS.id), "Done"));
      yield* settle;
      assert.equal(sent.length, 2);
      assert.equal(sent[0]?.clientKey, sent[1]?.clientKey);
      assert.equal(
        card(page, SETTINGS.id).querySelector(".agent-note")?.textContent,
        INBOX_NOT_TAKEN_NOTE.CHANGED,
      );
      assert.equal(
        card(page, SETTINGS.id).querySelector("[data-inbox-title]")?.textContent,
        "Require two reviews on main",
      );
      assert.equal(page.querySelectorAll("article[data-item-id]").length, 1);
    }),
);

it.effect(
  "an inbox that could not be read says so and reads again on Try again; an empty one says nothing waits",
  () =>
    Effect.gen(function* () {
      const { agents } = service(
        [{ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED }, { items: [], cursor: "0.0" }],
        [],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;
      const failed = page.querySelector('[role="alert"]');
      assert.ok(failed?.textContent?.startsWith("The inbox could not be read."));
      press(buttonNamed(page, "Retry"));
      yield* settle;
      assert.equal(page.textContent, "Nothing is waiting on you.");
    }),
);

it.effect(
  "an item of an agent the window has not listed yet, one started elsewhere, is drawn all the same, and the plan's agents are read again once for it",
  () =>
    Effect.gen(function* () {
      const elsewhere = { ...SETTINGS, agentId: "3b8f4e5d-7c6a-4b9f-9eaf-4a5b6c7d8e9f" };
      const { agents, listReads } = service(
        [
          { items: [elsewhere], cursor: "a" },
          { items: [elsewhere], cursor: "b" },
        ],
        [],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;
      assert.ok(card(page, SETTINGS.id));
      assert.equal(listReads.length, 1);
    }),
);

it.effect(
  "an approval its agent need not hear back from still has the plan read again once answered, since what it decided was written into the plan; a task decides nothing and asks no read",
  () =>
    Effect.gen(function* () {
      const quietApproval = item({
        id: "a1b2c3d4-0000-4000-8000-000000000004",
        key: "drop-legacy",
        kind: INBOX_KIND.APPROVAL,
        title: "Drop the legacy table?",
        needsReply: false,
        postedAt: 3_000,
        updatedAt: 3_000,
      });
      const { agents, listReads } = service(
        [{ items: [quietApproval, SETTINGS], cursor: "3000.4" }],
        [taking(SETTINGS), taking(quietApproval)],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;
      press(buttonNamed(card(page, SETTINGS.id), "Done"));
      yield* settle;
      assert.equal(listReads.length, 0, "a task done changes nothing the plan holds");
      press(buttonNamed(card(page, quietApproval.id), "Approve"));
      yield* settle;
      assert.equal(listReads.length, 1, "the decision was written into the plan");
    }),
);

it.effect(
  "a plan with no coding agent holds no read of its inbox open, since it has no Inbox tab",
  () =>
    Effect.gen(function* () {
      const reads: string[] = [];
      const agents = codingAgentsControl({
        agents: [],
        agentIds: [],
        readInbox: ({ after }) => {
          reads.push(after);
          return Promise.resolve({ items: [], cursor: "0.0" });
        },
      });
      mount(agents, yield* registryOnTestClock);
      yield* settle;
      assert.deepEqual(reads, []);
    }),
);

it.effect(
  "an answer that lands after the window opened another plan is drawn on neither, so the plan now open shows only its own items",
  () =>
    Effect.gen(function* () {
      const OTHER_PLAN = "6a8c0e2a-4c6e-4a8c-9e0a-2c4e6a8c0e2a";
      let land: (answered: CodingAgentInboxAnsweredView) => void = () => undefined;
      const agents = codingAgentsControl({
        agents: [AGENT],
        agentIds: [AGENT.id],
        readInbox: ({ planId, after }) =>
          after === INBOX_CURSOR_START
            ? Promise.resolve(
                planId === PLAN ? { items: [SETTINGS], cursor: "a" } : { items: [], cursor: "b" },
              )
            : new Promise(() => undefined),
        answerInbox: () =>
          new Promise((resolve) => {
            land = resolve;
          }),
      });
      const { page, open } = mounted(agents, yield* registryOnTestClock);
      yield* settle;
      press(buttonNamed(card(page, SETTINGS.id), "Done"));
      open(OTHER_PLAN);
      yield* settle;
      land({ item: { ...SETTINGS, status: INBOX_STATUS.OPEN, revision: 2 }, taken: false });
      yield* settle;
      assert.equal(page.querySelector(`[data-item-id="${SETTINGS.id}"]`), null);
      assert.equal(page.textContent, "Nothing is waiting on you.");
    }),
);

it.effect(
  "an answer not taken because the item was answered first, from another window, settles the card with that answer and says nothing of the agent changing it",
  () =>
    Effect.gen(function* () {
      const answeredElsewhere = {
        ...SETTINGS,
        status: INBOX_STATUS.ANSWERED,
        answer: { reply: INBOX_REPLY.DONE },
      };
      const { agents } = service(
        [{ items: [SETTINGS], cursor: "a" }],
        [() => ({ item: answeredElsewhere, taken: false })],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;
      press(buttonNamed(card(page, SETTINGS.id), "Done"));
      yield* settle;
      assert.equal(page.querySelectorAll("article[data-item-id]").length, 0);
      assert.equal(
        page.querySelector("[data-inbox-settled] > summary")?.textContent,
        "Settled · 1",
      );
      assert.ok(!page.textContent?.includes(INBOX_NOT_TAKEN_NOTE.CHANGED));
    }),
);

it.effect(
  "what the developer has put on a card outlasts a look at another tab, and starts afresh once the agent changes the item",
  () =>
    Effect.gen(function* () {
      let change: (page: CodingAgentInboxAnswerView) => void = () => undefined;
      const agents = codingAgentsControl({
        agents: [AGENT],
        agentIds: [AGENT.id],
        readInbox: ({ after }) =>
          after === INBOX_CURSOR_START
            ? Promise.resolve({ items: [QUEUE], cursor: "a" })
            : new Promise((resolve) => {
                change = resolve;
              }),
      });
      const { page, choose } = mounted(agents, yield* registryOnTestClock);
      yield* settle;
      press(buttonNamed(card(page, QUEUE.id), "Redis"));
      type(card(page, QUEUE.id).querySelector("textarea"), "Keep it simple.");
      choose(false);
      choose(true);
      const kept = card(page, QUEUE.id);
      assert.equal(kept.querySelector("textarea")?.value, "Keep it simple.");
      assert.equal(buttonNamed(kept, "Redis").getAttribute("aria-pressed"), "true");

      change({ items: [{ ...QUEUE, revision: 2, updatedAt: 2_000 }], cursor: "b" });
      yield* settle;
      assert.equal(card(page, QUEUE.id).querySelector("textarea")?.value, "");
    }),
);
