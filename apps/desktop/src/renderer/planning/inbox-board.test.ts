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
import { INBOX_CHANGED_NOTE, usePlanInbox } from "./use-plan-inbox";

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
  const agents = codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
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
  return { agents, sent, reads };
}

/** The tab as the plan's column draws it: the board over the plan's inbox. */
function Tab({ agents }: { agents: CodingAgentsControl }) {
  const inbox = usePlanInbox({ planId: PLAN, shown: true, agents });
  return createElement(InboxBoard, { control: inbox, agents, onOpenAgent: () => undefined });
}

function mount(agents: CodingAgentsControl, registry: Parameters<typeof onRegistry>[0]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(Tab, { agents }))));
  return container;
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
  const found = page.querySelector<HTMLElement>(`.inbox-card[data-item-id="${id}"]`);
  assert.ok(found, `no card for ${id}`);
  return found;
}

function buttonNamed(scope: HTMLElement, words: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll("button")].find(
    (each) => each.textContent?.trim() === words,
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
        [...page.querySelectorAll(".inbox-card .inbox-title")].map((title) => title.textContent),
        [
          "Which queue sends the invitation emails?",
          "Require a review on main",
          "Drop the legacy table?",
        ],
      );
      assert.deepEqual(reads, [INBOX_CURSOR_START, "2000.2", "3000.3"], "each read past the last");
      assert.equal(page.querySelector(".inbox-count")?.textContent, "3 waiting on you");
      assert.deepEqual(
        [...card(page, QUEUE.id).querySelectorAll(".inbox-option")].map((each) => each.textContent),
        ["Postgres outboxRecommendedNo new service.", "Redis"],
      );
      assert.equal(
        card(page, QUEUE.id).querySelector(".inbox-details")?.textContent,
        "The repo already runs Postgres.",
      );
      assert.ok(card(page, SETTINGS.id).querySelector(".inbox-quiet"));
      assert.equal(card(page, QUEUE.id).querySelector(".inbox-quiet"), null);
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
      assert.equal(page.querySelector(".inbox-count")?.textContent, "Nothing waiting");
      assert.equal(page.querySelector(".inbox-settled summary")?.textContent, "Settled · 1");
      assert.equal(
        page.querySelector(".inbox-answer")?.textContent,
        "Chose Redis · Keep it simple.",
      );
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
        card(page, SETTINGS.id).querySelector(".inbox-failure")?.textContent,
        "Luke didn't hear back. Retry sends it again, once.",
      );
      press(buttonNamed(card(page, SETTINGS.id), "Done"));
      yield* settle;
      assert.equal(sent.length, 2);
      assert.equal(sent[0]?.clientKey, sent[1]?.clientKey);
      assert.equal(
        card(page, SETTINGS.id).querySelector(".inbox-failure")?.textContent,
        INBOX_CHANGED_NOTE,
      );
      assert.equal(
        card(page, SETTINGS.id).querySelector(".inbox-title")?.textContent,
        "Require two reviews on main",
      );
      assert.equal(page.querySelector(".inbox-count")?.textContent, "1 waiting on you");
    }),
);

it.effect(
  "an inbox that could not be read says so and reads again on Try again; an empty one says where items will land",
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
      press(buttonNamed(page, "Try again"));
      yield* settle;
      assert.ok(
        page.querySelector(".side-panel-empty")?.textContent?.startsWith("Nothing waits on you."),
      );
    }),
);
