// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentActionRequest,
  type PlanCommentStartRequest,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import type { Task } from "@luke/features/task-wire";
import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { DOCUMENT_TASK } from "@luke/panel/testing/document-task";
import { type PlanCommentsControl, PlanCommentsProvider } from "@luke/ui/plan-comments";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { PlanBody } from "./plan-body";
import { CommentFocusScope, PlanCommentsTab } from "./plan-comments";

/**
 * A plan's comments on its own page: each open thread's words marked where
 * the plan holds them, a press on them opening the thread beside them, its
 * ✓ resolving it and its reply posting the words typed, a thread whose
 * words were deleted saying so over its quote, a resolved thread marking
 * nothing and listed under Resolved in the Comments tab, where Reopen
 * brings it back, and no mark on a page that is not the plan's own.
 * Synthetic plan and threads.
 */

const TEXT = [
  "## Goal",
  "An admin invites a teammate by email, and the invite lands as a **single-use link** that expires.",
  "## Approach",
  "Admins can withdraw an invite. A withdrawn link never grants access again.",
  "",
].join("\n\n");

const PLAN: Task = { ...DOCUMENT_TASK, document: { body: TEXT, assumptions: [] } };

const ID = {
  OPEN: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
  GONE: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  RESOLVED: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
} as const;

/** A thread on the first place `words` stands in the text, its words and quote as the plan holds them. */
function threadOn(
  id: string,
  words: string,
  comment: string,
  overrides: Partial<PlanCommentThread> = {},
): PlanCommentThread {
  const from = TEXT.indexOf(words);
  assert.ok(from >= 0);
  return {
    id,
    scope: PLAN_COMMENT_SCOPE.WORDS,
    quote: words.replaceAll("**", ""),
    anchor: { from, to: from + words.length },
    section: "Goal",
    status: PLAN_COMMENT_STATUS.OPEN,
    entries: [
      {
        id: `${id.slice(0, -4)}aaaa`,
        kind: PLAN_COMMENT_ENTRY.COMMENT,
        writer: {
          actor: PLAN_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-charles", name: "Charles Pan" },
        },
        words: comment,
        at: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    ...overrides,
  };
}

const THREADS: readonly PlanCommentThread[] = [
  threadOn(ID.OPEN, "**single-use link** that expires", "Should this be a setting?"),
  (() => {
    const { anchor: _anchor, ...gone } = threadOn(ID.GONE, "Admins can", "Is withdrawing in v1?", {
      section: "Approach",
      quote: "Admins can revoke an invite from the members page.",
    });
    return gone;
  })(),
  threadOn(ID.RESOLVED, "teammate", "A guest, too?", { status: PLAN_COMMENT_STATUS.RESOLVED }),
];

/** The plan's own page's links, which say the page is the plan's own. */
const PAGE_LINKS = { workspace: "acme", onOpen: () => undefined, reveal: undefined };

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (_request: Act): Promise<ActOutcome> =>
        Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The plan's page, or its Comments tab, drawn over the threads, with every write asked kept. */
function drawn(
  view: "page" | "tab" | "other",
  threads: readonly PlanCommentThread[] = THREADS,
  landing: () => boolean = () => true,
  plan: Task = PLAN,
) {
  const asked: { thread: string; action: PlanCommentActionRequest }[] = [];
  const started: PlanCommentStartRequest[] = [];
  const control: PlanCommentsControl = {
    planId: PLAN.id,
    threads,
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async (start) => {
      started.push(start);
      return { note: "not in this test" };
    },
    act: async (thread, action) => {
      asked.push({ thread, action });
      return landing();
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const page =
    view === "tab"
      ? createElement(PlanCommentsTab, {
          doors: { agents: undefined, me: "u-dean" },
          onShowDocument: () => undefined,
        })
      : createElement(PlanBody, {
          task: plan,
          live: false,
          ...(view === "page" ? { sectionLinks: PAGE_LINKS } : undefined),
        });
  act(() =>
    root.render(
      createElement(
        PlanCommentsProvider,
        { value: control },
        createElement(CommentFocusScope, null, page),
      ),
    ),
  );
  return { container, asked, started };
}

/** What `draw` drew with the column stood wide enough for its margin, since jsdom lays nothing out. */
function wide<Drawn>(draw: () => Drawn): Drawn {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1400,
  });
  try {
    return draw();
  } finally {
    // Note that jsdom holds the width on `Element.prototype`, so the stand-in is taken away rather than put back.
    if (width !== undefined) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  }
}

/** The words marked for a thread, joined as drawn. */
function markedWords(container: HTMLElement, thread: string): string {
  return [...container.querySelectorAll(`mark.plan-comment-mark[data-threads~="${thread}"]`)]
    .map((mark) => mark.textContent)
    .join("");
}

test("an open thread's words are marked where the plan holds them, a resolved thread's not at all", () => {
  const { container } = drawn("page");

  assert.equal(markedWords(container, ID.OPEN), "single-use link that expires");
  assert.equal(markedWords(container, ID.RESOLVED), "");
});

test("a press on a thread's words opens it beside them, its ✓ resolving it and its reply posting what was typed", async () => {
  const { container, asked } = drawn("page");

  const mark = container.querySelector<HTMLElement>(
    `mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`,
  );
  act(() => mark?.click());
  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.equal(card?.dataset.open, "true");

  const field = card?.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(field);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, "Not for v1.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => {
    card?.querySelector<HTMLButtonElement>('button[aria-label="Resolve"]')?.click();
  });

  assert.deepEqual(
    asked.map(({ thread, action }) => [
      thread,
      action.action,
      "words" in action ? action.words : undefined,
    ]),
    [
      [ID.OPEN, PLAN_COMMENT_ACTION.REPLY, "Not for v1."],
      [ID.OPEN, PLAN_COMMENT_ACTION.RESOLVE, undefined],
    ],
  );
});

test("a thread whose words were deleted stays in the margin, saying so over its quote", () => {
  const { container } = wide(() => drawn("page"));

  const card = container.querySelector(`.comment-card[data-thread="${ID.GONE}"]`);

  assert.ok(card?.textContent?.includes("Original content deleted"));
  assert.equal(
    card?.querySelector(".comment-quote")?.textContent,
    "Admins can revoke an invite from the members page.",
  );
});

test("the Comments tab lists the resolved thread under Resolved, where Reopen brings it back", async () => {
  const { container, asked } = drawn("tab");

  const filter = [...container.querySelectorAll<HTMLButtonElement>(".comments-filter")].find(
    (each) => each.textContent?.startsWith("Resolved"),
  );
  act(() => filter?.click());
  act(() => container.querySelector<HTMLButtonElement>(".comment-open")?.click());
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Reopen"]')?.click();
  });

  assert.deepEqual(asked, [
    { thread: ID.RESOLVED, action: { action: PLAN_COMMENT_ACTION.REOPEN } },
  ]);
});

test("a page that is not the plan's own marks no comment", () => {
  const { container } = drawn("other");

  assert.equal(container.querySelectorAll("mark.plan-comment-mark").length, 0);
  assert.equal(container.querySelectorAll(".comment-card").length, 0);
});

/** Types words into a field and presses Return, as a member posts. */
async function post(field: HTMLTextAreaElement, words: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

test("two threads on the same words both mark them, and a press on them opens each in turn", () => {
  const second = threadOn(
    "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
    "**single-use link** that expires",
    "Or a code?",
  );
  const { container } = drawn("page", [...THREADS, second]);

  assert.equal(markedWords(container, ID.OPEN), "single-use link that expires");
  assert.equal(markedWords(container, second.id), "single-use link that expires");
  const mark = () =>
    container.querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${second.id}"]`);
  act(() => mark()?.click());
  const firstOpen = container
    .querySelector(`.comment-card[data-open="true"]`)
    ?.getAttribute("data-thread");
  act(() => mark()?.click());
  const nextOpen = container
    .querySelector(`.comment-card[data-open="true"]`)
    ?.getAttribute("data-thread");

  assert.deepEqual([firstOpen, nextOpen].sort(), [ID.OPEN, second.id].sort());
});

test("a reply whose answer was lost is sent again under the same key, and the next reply under a new one", async () => {
  const lands = [false, true, true];
  const { container, asked } = drawn("page", THREADS, () => lands.shift() ?? true);
  const mark = container.querySelector<HTMLElement>(
    `mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`,
  );
  act(() => mark?.click());
  const field = () =>
    container.querySelector<HTMLTextAreaElement>(
      `.comment-card[data-thread="${ID.OPEN}"] textarea`,
    );

  const reply = field();
  assert.ok(reply);
  await post(reply, "Not for v1.");
  await post(reply, "Not for v1.");
  await post(reply, "Agreed.");

  const keys = asked.map(({ action }) => ("clientKey" in action ? action.clientKey : undefined));
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("deleting a thread asks first, and only the confirm deletes it", async () => {
  const { container, asked } = drawn("page");
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  act(() => card?.querySelector<HTMLButtonElement>('button[aria-label="More"]')?.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === "Delete thread",
  );
  act(() => item?.click());

  assert.deepEqual(asked, []);
  const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === "Delete thread",
  );
  await act(async () => confirm?.click());

  assert.deepEqual(asked, [
    { thread: ID.OPEN, action: { action: PLAN_COMMENT_ACTION.DELETE_THREAD } },
  ]);
});

test("words a block thread and a word thread both cover keep the word's mark, and the block still names its thread for its edge", () => {
  const paragraph = "Admins can withdraw an invite. A withdrawn link never grants access again.";
  const block = threadOn(ID.GONE, paragraph, "Is this v1?", {
    scope: PLAN_COMMENT_SCOPE.BLOCK,
    section: "Approach",
  });
  const words = threadOn(ID.OPEN, "withdraw an invite", "From where?", { section: "Approach" });
  const { container } = drawn("page", [block, words]);

  const shared = container.querySelector<HTMLElement>(
    `mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`,
  );
  const blockOnly = [
    ...container.querySelectorAll<HTMLElement>(`mark.plan-comment-mark[data-block-threads]`),
  ].find((mark) => !(mark.dataset.threads ?? "").includes(ID.OPEN));

  assert.ok(shared, "the word thread's words are marked");
  assert.equal(shared.dataset.block, undefined, "and washed as words, not as a block");
  assert.ok((shared.dataset.blockThreads ?? "").includes(ID.GONE));
  assert.equal(blockOnly?.dataset.block, "true", "the rest of the block reads as the block's");
});

test("Send to posts the draft standing in the field, then sends the thread to Luke", async () => {
  const { container, asked } = drawn("page");
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  const field = card?.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(field);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, "Luke, should this be in v1?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  act(() => card?.querySelector<HTMLButtonElement>(".comment-send-to")?.click());
  const luke = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
    each.textContent?.startsWith("Luke"),
  );
  await act(async () => luke?.click());

  assert.deepEqual(
    asked.map(({ action }) => [
      action.action,
      "words" in action ? action.words : undefined,
      "to" in action ? action.to : undefined,
    ]),
    [
      [PLAN_COMMENT_ACTION.REPLY, "Luke, should this be in v1?", undefined],
      [PLAN_COMMENT_ACTION.ASK, undefined, { actor: PLAN_COMMENT_ACTOR.LUKE }],
    ],
  );
});

test("a Send to whose answer was lost is sent again under the same key, and the next one under a new one", async () => {
  const lands = [false, true, true];
  const { container, asked } = drawn("page", THREADS, () => lands.shift() ?? true);
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  const sendToLuke = async () => {
    act(() => card?.querySelector<HTMLButtonElement>(".comment-send-to")?.click());
    const luke = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((each) =>
      each.textContent?.startsWith("Luke"),
    );
    await act(async () => luke?.click());
  };

  await sendToLuke();
  await sendToLuke();
  await sendToLuke();

  const keys = asked.map(({ action }) => ("clientKey" in action ? action.clientKey : undefined));
  assert.equal(keys.length, 3);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});

test("a press away from the open thread closes it, and a press inside it keeps it open", () => {
  const { container } = drawn("page");
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = () =>
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.equal(card()?.dataset.open, "true");

  act(() => card()?.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  assert.equal(card()?.dataset.open, "true", "a press inside keeps it open");

  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  assert.notEqual(card()?.dataset.open, "true", "a press away closes it");
});

test("the button beside a list comments on the bullet under the pointer, a parent's own words without the bullets nested under it", async () => {
  const text = ["## Goal", "- First item\n- Second item\n  - nested one\n  - nested two", ""].join(
    "\n\n",
  );
  const listed: Task = { ...DOCUMENT_TASK, document: { body: text, assumptions: [] } };
  const { container, started } = wide(() => drawn("page", [], () => true, listed));
  const second = [...container.querySelectorAll("li")].find((li) =>
    li.textContent?.startsWith("Second item"),
  );
  const nested = [...container.querySelectorAll("li")].find(
    (li) => li.textContent === "nested two",
  );
  assert.ok(second && nested);

  const commentOn = async (item: Element, words: string) => {
    act(() => item.dispatchEvent(new Event("pointerover", { bubbles: true })));
    act(() => container.querySelector<HTMLButtonElement>(".comment-block-button button")?.click());
    const field = container.querySelector<HTMLTextAreaElement>(".comment-card textarea");
    assert.ok(field);
    await post(field, words);
  };
  await commentOn(second, "Why second?");
  act(() =>
    container
      .querySelector<HTMLButtonElement>(".comment-card button[aria-label='Cancel']")
      ?.click(),
  );
  await commentOn(nested, "And this one?");

  const spans = started.map((start) => [
    start.scope,
    start.quote,
    text.slice(start.anchor.from, start.anchor.to),
  ]);
  assert.deepEqual(spans[0], [PLAN_COMMENT_SCOPE.BLOCK, "Second item", "Second item"]);
  assert.deepEqual(spans.at(-1), [PLAN_COMMENT_SCOPE.BLOCK, "nested two", "nested two"]);
});

test("a thread at rest opens from a press anywhere on its card", () => {
  const { container } = drawn("page");
  act(() => container.querySelector<HTMLButtonElement>(".comment-count")?.click());
  const card = () =>
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.GONE}"]`);
  assert.equal(card()?.dataset.open, "false");

  act(() => card()?.querySelector<HTMLElement>(".comment-head")?.click());
  assert.equal(card()?.dataset.open, "true", "the card's head opens it");
});

test("the pointer on a thread's words marks its card before a press", () => {
  const { container } = wide(() => drawn("page"));
  const mark = container.querySelector<HTMLElement>(
    `mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`,
  );
  const card = () =>
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.equal(card()?.dataset.pointed, "false");

  act(() => mark?.dispatchEvent(new Event("pointerover", { bubbles: true })));

  assert.equal(card()?.dataset.pointed, "true");
  assert.equal(card()?.dataset.open, "false", "and leaves it closed until a press");
});

test("a line's count stands every thread on the line under it, the first open", () => {
  const { container } = drawn("page");

  act(() => container.querySelector<HTMLButtonElement>(".comment-count")?.click());

  const cards = [...container.querySelectorAll<HTMLElement>(".comment-float .comment-card")];
  assert.deepEqual(
    cards.map((card) => [card.dataset.thread, card.dataset.open]),
    [
      [ID.OPEN, "true"],
      [ID.GONE, "false"],
    ],
  );
});
