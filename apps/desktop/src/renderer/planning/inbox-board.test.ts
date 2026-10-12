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
  INBOX_BLOCK,
  INBOX_CURSOR_START,
  INBOX_FIELD,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
  type InboxItem,
  inboxItemSchema,
} from "@sidecar/hosted/inbox-wire";
import { PLAN_FILE_REFUSAL, type PlanFileRequest } from "@sidecar/hosted/plan-wire";
import type { PlanningFileAnswer } from "@sidecar/hosted/planning-view";
import { Effect, Schema } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { codingAgentsControl } from "#testing/plans-control";
import { InboxBoard, type InboxCodeDoors } from "./inbox-board";
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
function item(
  overrides: Partial<InboxItem> & Pick<InboxItem, "id" | "response" | "title">,
): InboxItem {
  return {
    agentId: AGENT.id,
    key: "item",
    revision: 1,
    version: INBOX_WIRE_VERSION,
    blocks: [],
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
  title: "Which queue sends the invitation emails?",
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "The repo already runs **Postgres**." }],
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
    recommended: "Postgres outbox",
  },
});

const SETTINGS = item({
  id: "a1b2c3d4-0000-4000-8000-000000000002",
  key: "branch-protection",
  title: "Require a review on `main`",
  blocks: [
    {
      type: INBOX_BLOCK.LINK,
      url: "https://github.com/acme/relay/settings/branches",
      label: "Branch rules",
    },
    { type: INBOX_BLOCK.LINK, url: "https://example.test/why", label: "Why" },
  ],
  response: { type: INBOX_RESPONSE.TASK },
  needsReply: false,
  postedAt: 2_000,
  updatedAt: 2_000,
});

const CHANNELS = item({
  id: "a1b2c3d4-0000-4000-8000-000000000004",
  key: "channels",
  title: "Which channels send the invitation?",
  response: {
    type: INBOX_RESPONSE.CHOICE,
    options: [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }],
    multiple: true,
  },
});

const SMTP = item({
  id: "a1b2c3d4-0000-4000-8000-000000000005",
  key: "smtp",
  title: "SMTP settings",
  response: {
    type: INBOX_RESPONSE.FORM,
    fields: [
      { type: INBOX_FIELD.TEXT, label: "Host", required: true },
      { type: INBOX_FIELD.NUMBER, label: "Port" },
      { type: INBOX_FIELD.SELECT, label: "Security", options: ["TLS", "STARTTLS"] },
      { type: INBOX_FIELD.BOOLEAN, label: "Verify certificate" },
    ],
  },
});

const RENAMED = item({
  id: "a1b2c3d4-0000-4000-8000-000000000006",
  key: "renamed",
  title: "The migration renamed the invites table",
  response: { type: INBOX_RESPONSE.NONE },
  needsReply: false,
});

/** An item a newer service wrote, with a block and a response this build does not know, as the window reads it. */
const NEWER = Schema.decodeUnknownSync(inboxItemSchema)({
  ...item({
    id: "a1b2c3d4-0000-4000-8000-000000000007",
    key: "newer",
    title: "Pick a time",
    response: { type: INBOX_RESPONSE.NONE },
  }),
  version: INBOX_WIRE_VERSION + 1,
  blocks: [{ type: INBOX_BLOCK.MARKDOWN, text: "Before Friday." }, { type: "image" }],
  response: { type: "schedule" },
});

/** The commit a code block's agent read its lines at. */
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A code block of the agent's repository, its name spelled in another case than the plan's. */
const RETRY_LINES = {
  type: INBOX_BLOCK.CODE,
  repo: "Acme/Relay",
  path: "src/invite/send.ts",
  startLine: 5,
  endLine: 6,
  sha: COMMIT,
} as const;

const RETRIES = item({
  id: "a1b2c3d4-0000-4000-8000-000000000008",
  key: "invite-retries",
  title: "Retry a failed invitation email?",
  blocks: [RETRY_LINES],
  response: { type: INBOX_RESPONSE.APPROVAL },
});

/** A file's window as the host answers it, coloured, from `firstLine`, of a file `lineCount` long. */
function fileWindow(path: string, firstLine: number, lineCount: number): PlanningFileAnswer {
  const lines = Array.from({ length: lineCount - firstLine + 1 }, (_, at) => [
    { text: `line ${firstLine + at}` },
  ]);
  return {
    file: { path, repository: "Acme/Relay", branch: COMMIT, firstLine, lineCount, lines },
  };
}

/**
 * The doors a code block reads and opens through, over the plan's
 * repository: each read answered by the next of the path's `answers`,
 * held past them, every window and every file opened recorded.
 */
function fileDoors(answers: Readonly<Record<string, PlanningFileAnswer[]>> = {}) {
  const reads: PlanFileRequest[] = [];
  const opened: { readonly ref: unknown; readonly commit: string }[] = [];
  const doors: InboxCodeDoors = {
    repository: "acme/relay",
    readFile: (window) => {
      reads.push(window);
      const next = answers[window.path]?.shift();
      return next === undefined ? new Promise(() => undefined) : Promise.resolve(next);
    },
    onOpenFile: (ref, commit) => opened.push({ ref, commit }),
  };
  return { doors, reads, opened };
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  opened.splice(0);
});

/** The pages a link block was pressed to open on GitHub, in order. */
const opened: string[] = [];

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
  code,
}: {
  agents: CodingAgentsControl;
  planId?: string;
  chosen?: boolean;
  code: InboxCodeDoors;
}) {
  const inbox = usePlanInbox({ planId, shown: true, agents });
  return chosen
    ? createElement(InboxBoard, {
        control: inbox,
        agents,
        onOpenAgent: () => undefined,
        openGitHub: (url) => opened.push(url),
        code,
      })
    : null;
}

/** The tab mounted on the plan given, answering the page, a way to open another plan in its place, and a way to choose another tab and come back. */
function mounted(
  agents: CodingAgentsControl,
  registry: Parameters<typeof onRegistry>[0],
  code: InboxCodeDoors = fileDoors().doors,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (planId: string, chosen: boolean) =>
    act(() =>
      root.render(onRegistry(registry, createElement(Tab, { agents, planId, chosen, code }))),
    );
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

/** Types into a field as the developer does, through React's own value setter. */
function typeInto(box: HTMLInputElement | undefined, words: string): void {
  assert.ok(box);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
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
        ...(sent.choices === undefined ? undefined : { choices: sent.choices }),
        ...(sent.values === undefined ? undefined : { values: sent.values }),
        ...(sent.note === undefined ? undefined : { note: sent.note }),
      },
      updatedAt: 9_000,
    },
    taken: true,
  });

it.effect(
  "the plan's open items are drawn the oldest first with their blocks and controls, a choice's recommendation marked, a link opening on GitHub and one elsewhere inert with its address, and a task its agent need not hear back from saying so; a later read adds what landed",
  () =>
    Effect.gen(function* () {
      const later = item({
        id: "a1b2c3d4-0000-4000-8000-000000000003",
        response: { type: INBOX_RESPONSE.APPROVAL },
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
        card(page, QUEUE.id).querySelector("[data-inbox-markdown]")?.textContent,
        "The repo already runs Postgres.",
      );
      const links = card(page, SETTINGS.id).querySelectorAll("[data-inbox-link]");
      assert.equal(links.length, 2);
      press(links[0]?.querySelector("a"));
      assert.deepEqual(opened, ["https://github.com/acme/relay/settings/branches"]);
      assert.equal(links[1]?.querySelector("a"), null, "a page off GitHub is no press");
      assert.equal(links[1]?.textContent, "Why https://example.test/why");
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
          choices: ["Redis"],
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
  "an inbox that could not be read says so and reads again on Try again; an empty one says nothing waits under the Inbox's glyph, drawn large",
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
      assert.equal(page.querySelector(".empty-state-icon"), null, "a failure is not empty");
      press(buttonNamed(page, "Retry"));
      yield* settle;
      assert.equal(page.textContent, "Nothing is waiting on you.");
      const glyph = page.querySelector(".empty-state-icon");
      assert.equal(glyph?.getAttribute("aria-hidden"), "true");
      assert.ok(glyph?.querySelector("svg.lucide-inbox"), "the Inbox tab's own glyph");
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

it.effect(
  "a choice that allows several keeps every option pressed and sends them all; a form's fields are each the control of their type and send as the form's values; an item asking nothing is acknowledged by one press",
  () =>
    Effect.gen(function* () {
      const { agents, sent } = service(
        [{ items: [CHANNELS, SMTP, RENAMED], cursor: "a" }],
        [taking(CHANNELS), taking(SMTP), taking(RENAMED)],
      );
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;

      const channels = card(page, CHANNELS.id);
      assert.ok(channels.querySelector('[data-inbox-choice="multiple"]'));
      press(buttonNamed(channels, "Email"));
      press(buttonNamed(channels, "SMS"));
      assert.equal(buttonNamed(channels, "Email").getAttribute("aria-pressed"), "true");
      assert.equal(buttonNamed(channels, "SMS").getAttribute("aria-pressed"), "true");
      press(buttonNamed(channels, "Send to agent"));
      yield* settle;

      const smtp = card(page, SMTP.id);
      assert.equal(buttonNamed(smtp, "Send to agent").disabled, true, "Host is required");
      const inputs = smtp.querySelectorAll<HTMLInputElement>("input.settings-input");
      assert.deepEqual(
        [...inputs].map((input) => input.type),
        ["text", "number"],
      );
      typeInto(inputs[0], "smtp.acme.test");
      typeInto(inputs[1], "587");
      press(buttonNamed(smtp, "STARTTLS"));
      press(smtp.querySelector('[role="switch"]'));
      assert.equal(buttonNamed(smtp, "Send to agent").disabled, false);
      press(buttonNamed(smtp, "Send to agent"));
      yield* settle;

      const renamed = card(page, RENAMED.id);
      assert.equal(
        renamed.querySelectorAll("button.toolbar-button").length,
        0,
        "nothing to hold back",
      );
      press(buttonNamed(renamed, "Got it"));
      yield* settle;

      assert.deepEqual(
        sent.map(({ clientKey: _clientKey, ...answer }) => answer),
        [
          { itemId: CHANNELS.id, revision: 1, reply: INBOX_REPLY.CHOSE, choices: ["Email", "SMS"] },
          {
            itemId: SMTP.id,
            revision: 1,
            reply: INBOX_REPLY.SUBMITTED,
            values: [
              { label: "Host", value: "smtp.acme.test" },
              { label: "Port", value: 587 },
              { label: "Security", value: "STARTTLS" },
              { label: "Verify certificate", value: true },
            ],
          },
          { itemId: RENAMED.id, revision: 1, reply: INBOX_REPLY.ACKNOWLEDGED },
        ],
      );
      assert.equal(page.querySelectorAll("article[data-item-id]").length, 0);
    }),
);

it.effect(
  "an item a newer service wrote draws the blocks this build knows, a line naming a newer Luke for the one it does not, and no controls for a response it does not know, while the rest of the inbox reads",
  () =>
    Effect.gen(function* () {
      const { agents } = service([{ items: [NEWER, SETTINGS], cursor: "a" }], []);
      const page = mount(agents, yield* registryOnTestClock);
      yield* settle;
      const newer = card(page, NEWER.id);
      assert.equal(newer.querySelector("[data-inbox-markdown]")?.textContent, "Before Friday.");
      assert.deepEqual(
        [...newer.querySelectorAll("[data-inbox-unknown]")].map((line) => line.textContent),
        ["Open this in a newer Luke to see the rest.", "Answer this in a newer Luke."],
      );
      assert.equal(newer.querySelector("textarea"), null);
      assert.equal(newer.querySelectorAll("button.primary-button").length, 0);
      assert.ok(buttonNamed(card(page, SETTINGS.id), "Done"));
    }),
);

it.effect(
  "a code block is drawn as the Code tab draws a card, headed by its path and lines, the lines read at the agent's commit through the plan with a few of the file around them and its own lit, out of the recording; its path and its Open open the File tab there at that commit",
  () =>
    Effect.gen(function* () {
      const { agents } = service([{ items: [RETRIES], cursor: "a" }], []);
      const files = fileDoors({ [RETRY_LINES.path]: [fileWindow(RETRY_LINES.path, 2, 8)] });
      const page = mounted(agents, yield* registryOnTestClock, files.doors).page;
      yield* settle;

      assert.deepEqual(files.reads, [
        { path: RETRY_LINES.path, firstLine: 2, lastLine: 9, ref: COMMIT },
      ]);
      const code = card(page, RETRIES.id).querySelector<HTMLElement>("[data-inbox-code]");
      assert.ok(code, "no code block");
      assert.ok(code.classList.contains("ph-no-capture"), "the recording leaves the lines out");
      assert.equal(code.getAttribute("aria-label"), "src/invite/send.ts, Lines 5–6");
      assert.equal(code.querySelector(".code-card-range")?.textContent, "Lines 5–6");
      const numbers = (selector: string) =>
        [...code.querySelectorAll(selector)].map((line) => line.textContent);
      assert.deepEqual(numbers(".code-line-number"), ["2", "3", "4", "5", "6", "7", "8"]);
      assert.deepEqual(numbers("[data-pointed='true'] .code-line-number"), ["5", "6"]);
      assert.ok(buttonNamed(code, "Copy lines"));

      press(buttonNamed(code, "Open file"));
      press(buttonNamed(code, "Open src/invite/send.ts"));
      const at = { ref: { path: RETRY_LINES.path, startLine: 5, endLine: 6 }, commit: COMMIT };
      assert.deepEqual(files.opened, [at, at]);
    }),
);

it.effect(
  "a code block whose lines GitHub could not give just now says so and reads again on Retry; one at a commit GitHub lacks says so with no Retry; and one of another repository than the plan's is read from nowhere, says where it is, and opens nothing",
  () =>
    Effect.gen(function* () {
      const elsewhere = item({
        id: "a1b2c3d4-0000-4000-8000-000000000009",
        key: "other-repository",
        title: "Port this from the other service?",
        blocks: [{ ...RETRY_LINES, repo: "acme/billing", path: "src/charge.ts" }],
        response: { type: INBOX_RESPONSE.APPROVAL },
        postedAt: 2_000,
      });
      const unpushed = item({
        id: "a1b2c3d4-0000-4000-8000-00000000000a",
        key: "unpushed",
        title: "Keep this guard?",
        blocks: [{ ...RETRY_LINES, path: "src/guard.ts" }],
        response: { type: INBOX_RESPONSE.APPROVAL },
        postedAt: 3_000,
      });
      const { agents } = service([{ items: [RETRIES, elsewhere, unpushed], cursor: "a" }], []);
      const files = fileDoors({
        [RETRY_LINES.path]: [
          { refusal: PLAN_FILE_REFUSAL.UNAVAILABLE },
          fileWindow(RETRY_LINES.path, 2, 8),
        ],
        "src/guard.ts": [{ refusal: PLAN_FILE_REFUSAL.MISSING, branch: COMMIT }],
      });
      const page = mounted(agents, yield* registryOnTestClock, files.doors).page;
      yield* settle;
      const notice = (id: string) =>
        card(page, id).querySelector("[data-inbox-code] [role='alert']");

      assert.equal(
        notice(RETRIES.id)?.textContent?.includes("GitHub could not be read just now."),
        true,
      );
      assert.equal(
        notice(unpushed.id)?.textContent,
        "This file is not at commit 0123456 on GitHub, or the commit was never pushed.",
      );
      assert.equal(
        notice(elsewhere.id)?.textContent,
        "These lines are in acme/billing, which this plan no longer reads.",
      );
      assert.deepEqual(
        files.reads.map((read) => read.path),
        [RETRY_LINES.path, "src/guard.ts"],
        "nothing is read of another repository",
      );
      assert.equal(
        [...card(page, unpushed.id).querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Retry",
        ),
        false,
      );
      assert.equal(
        [...card(page, elsewhere.id).querySelectorAll("button")].some(
          (button) => button.getAttribute("aria-label")?.startsWith("Open") === true,
        ),
        false,
        "the File tab reads the plan's repository alone, so nothing opens",
      );

      press(buttonNamed(card(page, RETRIES.id), "Retry"));
      yield* settle;
      assert.equal(notice(RETRIES.id), null);
      assert.equal(card(page, RETRIES.id).querySelectorAll(".code-line").length, 7);
    }),
);
