// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { APP_COMMAND, APP_SHORTCUTS, shortcutAria } from "@luke/settings/shortcuts";
import { type PlanCommentsControl, PlanCommentsProvider } from "@luke/ui/plan-comments";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { useAppKeymap } from "../app-commands.js";
import {
  editorBundleLanded,
  installEditorLayout,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { PlanBody } from "./plan-body.js";
import { CommentFocusScope, PlanCommentsTab } from "./plan-comments.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";

/**
 * A plan's comments on its own page: each open thread's words marked where
 * the plan holds them, a press on them opening the thread beside them, its
 * ✓ resolving it and its reply posting the words typed, a thread whose
 * words were deleted saying so over its quote, a resolved thread marking
 * nothing and listed under Resolved in the Comments tab, where Reopen
 * brings it back, and no mark on a page that is not the plan's own; and
 * ⌥⌘M starts a thread on the words selected, as the bubble over them does.
 * Synthetic plan and threads.
 */

// Landed before any field renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

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
  reveal?: { readonly thread: string; readonly ask: number },
  mentions?: TaskMentionsValue,
) {
  const asked: { thread: string; action: PlanCommentActionRequest }[] = [];
  const started: PlanCommentStartRequest[] = [];
  /** Each time the plan's own tab was asked to be shown. */
  const documentsShown: true[] = [];
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
          onShowDocument: () => documentsShown.push(true),
        })
      : createElement(PlanBody, {
          task: plan,
          live: false,
          ...(view === "page" ? { sectionLinks: PAGE_LINKS } : undefined),
        });
  // Note that a page with mentions draws on a registry of its own, so the editor bundle installed for it is read afresh.
  const registry = AtomRegistry.make();
  const tree = createElement(
    PlanCommentsProvider,
    { value: control },
    createElement(CommentFocusScope, {
      reveal,
      children:
        mentions === undefined
          ? page
          : createElement(TaskMentions, { value: mentions, children: page }),
    }),
  );
  act(() => root.render(mentions === undefined ? tree : onRegistry(registry, tree)));
  return { container, asked, started, documentsShown };
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

test("the Comments tab's Resolved toggle lists the resolved thread whole, where Reopen brings it back", async () => {
  const { container, asked } = drawn("tab");

  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Resolved"]')?.click());
  assert.ok(container.querySelector(".comments-head")?.textContent?.startsWith("Resolved"));
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Reopen"]')?.click();
  });

  assert.deepEqual(asked, [
    { thread: ID.RESOLVED, action: { action: PLAN_COMMENT_ACTION.REOPEN } },
  ]);
});

test("the Comments tab's Resolved toggle starts the other list at its top", () => {
  const { container } = drawn("tab");
  // The list scrolls in the box around its rows (`ScrollArea`).
  const list = container.querySelector<HTMLElement>(".comments-list")?.parentElement;
  assert.ok(list);
  let top = 240;
  Object.defineProperty(list, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });

  act(() =>
    container.querySelector<HTMLButtonElement>(".comments-head button[aria-pressed]")?.click(),
  );

  assert.equal(top, 0);
});

test("the Comments tab lists each open thread whole, its reply field under its comments", () => {
  const { container } = drawn("tab");

  const cards = [...container.querySelectorAll<HTMLElement>(".comments-list .comment-card")];
  assert.deepEqual(
    cards.map((card) => [card.dataset.thread, card.dataset.open]),
    [
      [ID.OPEN, "true"],
      [ID.GONE, "true"],
    ],
  );
  assert.ok(
    cards.every((card) => card.querySelector(".comment-field[data-variant='reply']") !== null),
  );
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

test("words a block thread and a word thread both cover are marked once, naming both threads, as a block's other words name its own", () => {
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
  const blockOnly = [...container.querySelectorAll<HTMLElement>("mark.plan-comment-mark")].find(
    (mark) => mark.dataset.threads === ID.GONE,
  );

  assert.deepEqual(shared?.dataset.threads?.split(" ").sort(), [ID.GONE, ID.OPEN].sort());
  assert.ok(blockOnly, "the rest of the block is marked as the block thread's");
  assert.equal(container.querySelectorAll(".comment-block-edge").length, 0, "and draws no bar");
});

test("where one thread's mark stands inside another's, the open thread's is drawn as its own mark, inner or outer, under the panel's own stylesheet", () => {
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync(`${__dirname}/../styles/tasks.css`, "utf8");
  document.head.append(sheet);
  // Note that the editor nests a mark per thread over words two threads cover.
  const nested = (open: "inner" | "outer") => {
    const outer = document.body.appendChild(document.createElement("mark"));
    const inner = outer.appendChild(document.createElement("mark"));
    outer.className = "plan-comment-mark";
    inner.className = "plan-comment-mark";
    (open === "inner" ? inner : outer).dataset.active = "true";
    return { outer, inner };
  };
  const innerOpen = nested("inner");
  const outerOpen = nested("outer");
  // Note that jsdom resolves no custom property, so a mark's wash reads the same whichever rule set it; the room under its edge, a length, says which rule drew it.
  const edgeRoom = (mark: HTMLElement): string => getComputedStyle(mark).paddingBottom;
  const drawn = {
    innerOpen: edgeRoom(innerOpen.inner),
    outerOpen: edgeRoom(outerOpen.outer),
    underOuterOpen: edgeRoom(outerOpen.inner),
  };
  sheet.remove();
  innerOpen.outer.remove();
  outerOpen.outer.remove();

  assert.deepEqual(drawn, { innerOpen: "1px", outerOpen: "1px", underOuterOpen: "0px" });
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
  act(() => container.querySelector<HTMLButtonElement>(".comment-count button")?.click());
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

  act(() => container.querySelector<HTMLButtonElement>(".comment-count button")?.click());

  const cards = [...container.querySelectorAll<HTMLElement>(".comment-float .comment-card")];
  assert.deepEqual(
    cards.map((card) => [card.dataset.thread, card.dataset.open]),
    [
      [ID.OPEN, "true"],
      [ID.GONE, "false"],
    ],
  );
});

test("a link to a resolved thread lists it under Resolved, open, and scrolls the list to it", () => {
  const box = (top: number) => () => ({
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return (this.classList.contains("comment-card") ? box(500) : box(0))();
  };
  try {
    const { container } = drawn("tab", THREADS, () => true, PLAN, {
      thread: ID.RESOLVED,
      ask: 1,
    });

    const card = container.querySelector<HTMLElement>(
      `.comment-card[data-thread="${ID.RESOLVED}"]`,
    );
    assert.equal(card?.dataset.open, "true");
    assert.equal(container.querySelector(".comments-list")?.parentElement?.scrollTop, 500 - 96);
  } finally {
    if (rect !== undefined) Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
  }
});

/** The plan's page's mentions, as the page hands them to every box on it. */
const PAGE_MENTIONS: TaskMentionsValue = {
  taskId: PLAN.id,
  taskName: "Invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => TEXT,
  doors: {
    taskId: PLAN.id,
    place: { workspace: "acme", repository: "acme/relay" },
    anchors: new Set(["goal", "approach"]),
    onOpenTask: () => undefined,
    onOpenFile: undefined,
  },
};

test("on a plan's page a reply is written in the agent box's editor, its words posted on Return, and a comment's mention drawn as its chip", async () => {
  installEditorLayout();
  const mentioned = threadOn(ID.OPEN, "**single-use link** that expires", "", {
    entries: [
      {
        id: `${ID.OPEN.slice(0, -4)}aaaa`,
        kind: PLAN_COMMENT_ENTRY.COMMENT,
        writer: {
          actor: PLAN_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-charles", name: "Charles Pan" },
        },
        words: `See [@Goal](https://tryluke.dev/acme/plan/${PLAN.id}#goal) first.`,
        at: 1,
      },
    ],
  });
  const { container, asked } = drawn(
    "page",
    [mentioned],
    () => true,
    PLAN,
    undefined,
    PAGE_MENTIONS,
  );
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  await act(async () => undefined);
  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.ok(card);
  assert.ok(
    card.querySelector(".comment-words [data-mention-ref]"),
    "the mention is drawn as its chip",
  );
  assert.ok(card.querySelector(".composer-editor"), "the reply is the agent box's editor");
  typeInComposer(card, "Agreed.");
  pressInComposer(card, "Enter");
  await act(async () => undefined);

  assert.deepEqual(
    asked.map(({ action }) => [action.action, "words" in action ? action.words : undefined]),
    [[PLAN_COMMENT_ACTION.REPLY, "Agreed."]],
  );
});

test("a thread at rest draws its comment's mentions as their chips, as it does open, and a press on one opens the thread too", async () => {
  installEditorLayout();
  const mentioned = threadOn(ID.OPEN, "**single-use link** that expires", "", {
    entries: [
      {
        id: `${ID.OPEN.slice(0, -4)}aaaa`,
        kind: PLAN_COMMENT_ENTRY.COMMENT,
        writer: {
          actor: PLAN_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-charles", name: "Charles Pan" },
        },
        words: `See [@Goal](https://tryluke.dev/acme/plan/${PLAN.id}#goal) first.`,
        at: 1,
      },
    ],
  });
  const { container } = wide(() =>
    drawn("page", [mentioned], () => true, PLAN, undefined, PAGE_MENTIONS),
  );
  await act(async () => undefined);

  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.equal(card?.dataset.open, "false");
  assert.ok(
    card?.querySelector(".comment-clamp [data-mention-ref]"),
    "the chip stands at rest too",
  );

  act(() => card?.querySelector<HTMLElement>(".comment-clamp [data-mention-ref]")?.click());
  assert.equal(
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`)?.dataset.open,
    "true",
    "a press on the chip opens the thread with it",
  );
});

test("a block a thread covers whole offers no button to start another, and one a thread covers in part keeps it", () => {
  const onHeading = threadOn(ID.OPEN, "Approach", "Is this the right order?", {
    scope: PLAN_COMMENT_SCOPE.BLOCK,
    section: "Approach",
  });
  const onWord = threadOn(ID.RESOLVED, "withdraw", "Or revoke?", { section: "Approach" });
  const blocks = (container: HTMLElement) => {
    const button = (block: Element) => {
      act(() => block.dispatchEvent(new Event("pointerover", { bubbles: true })));
      return container.querySelector(".comment-block-button button");
    };
    const heading = (name: string) =>
      [...container.querySelectorAll(".markdown-heading")].find((h) => h.textContent === name);
    const paragraph = [...container.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Admins can withdraw"),
    );
    const approach = heading("Approach");
    const goal = heading("Goal");
    assert.ok(approach && goal && paragraph);
    return { button, approach, goal, paragraph };
  };

  const { container } = wide(() => drawn("page", [onHeading, onWord]));
  const { button, approach, goal, paragraph } = blocks(container);
  assert.ok(button(approach) === null, "the heading a thread covers offers none");
  assert.ok(button(goal), "a heading without one does");
  assert.ok(button(paragraph), "a paragraph with a thread on one word does");
  assert.ok(button(approach) === null, "and going back takes it away");
  for (const root of roots.splice(0)) act(() => root.unmount());
  container.remove();

  // Note that folded, a line's count stands where its button would, though its thread covers a word alone; jsdom stands every line at one top.
  const folded = blocks(drawn("page", [onWord]).container);
  assert.ok(folded.button(folded.paragraph) === null, "the counted line offers none");
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  const bare = blocks(drawn("page", []).container);
  assert.ok(bare.button(bare.paragraph), "a line with no count does");
});

test("a thread being started goes on a press away while empty, and stays holding a draft", () => {
  const { container } = wide(() => drawn("page", []));
  const startOn = () => {
    const paragraph = [...container.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Admins can withdraw"),
    );
    assert.ok(paragraph);
    act(() => paragraph.dispatchEvent(new Event("pointerover", { bubbles: true })));
    act(() => container.querySelector<HTMLButtonElement>(".comment-block-button button")?.click());
  };
  const pending = () => container.querySelector(`.comment-card[data-thread="pending"]`);
  const away = () =>
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));

  startOn();
  assert.ok(pending(), "the thread is being started");
  away();
  assert.equal(pending(), null, "empty, it goes");

  startOn();
  const field = pending()?.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(field);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, "Worth a setting?");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  away();
  assert.ok(pending(), "holding a draft, it stays");
});

test("on a plan's page a comment's field offers dictation, and the plain field none", async () => {
  installEditorLayout();
  const withMentions = drawn("page", THREADS, () => true, PLAN, undefined, PAGE_MENTIONS);
  act(() =>
    withMentions.container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  await act(async () => undefined);
  const plain = drawn("page");
  act(() =>
    plain.container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );

  const dictate = (container: HTMLElement) =>
    container.querySelector(
      `.comment-card[data-thread="${ID.OPEN}"] .comment-field-tools button[aria-label^="Dictate"]`,
    );
  assert.ok(dictate(withMentions.container), "the editor's field takes a dictation");
  assert.equal(dictate(plain.container), null, "the plain field does not");
});

test("in the Comments tab a thread's quote shows its words in the plan, and a deleted thread's quote where they stood", () => {
  const { container, documentsShown } = drawn("tab");
  const quote = (thread: string) =>
    container.querySelector<HTMLButtonElement>(
      `.comment-card[data-thread="${thread}"] button.comment-quote-link`,
    );

  act(() => quote(ID.OPEN)?.click());
  act(() => quote(ID.GONE)?.click());

  assert.ok(quote(ID.OPEN) && quote(ID.GONE), "both quotes are presses");
  assert.equal(documentsShown.length, 2);
});

test("a comment's field offers Luke first among the agents, with no Send to beside it", async () => {
  installEditorLayout();
  const { container } = drawn("page", THREADS, () => true, PLAN, undefined, PAGE_MENTIONS);
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  await act(async () => undefined);
  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.ok(card);

  typeInComposer(card, "@Lu");
  await act(async () => undefined);

  const rows = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (row) => row.textContent ?? "",
  );
  assert.ok(rows[0]?.startsWith("Luke"), `Luke leads the list: ${rows.join(" | ")}`);
  assert.equal(card.querySelector(".comment-send-to"), null);
});

test("a reply's field empties as it is sent, and takes the words back where the send fails", async () => {
  const { container } = drawn("page", THREADS, () => false);
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.plan-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const field = container.querySelector<HTMLTextAreaElement>(
    `.comment-card[data-thread="${ID.OPEN}"] textarea`,
  );
  assert.ok(field);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, "Not for v1.");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.equal(field.value, "", "the field empties as the words are sent");

  await act(async () => undefined);
  assert.equal(field.value, "Not for v1.", "and takes them back where the send fails");
});

test("a thread being started keeps its card through a press away while its words are sent, and takes them back where the send fails", async () => {
  const { container } = wide(() => drawn("page", []));
  const paragraph = [...container.querySelectorAll("p")].find((p) =>
    p.textContent?.startsWith("Admins can withdraw"),
  );
  assert.ok(paragraph);
  act(() => paragraph.dispatchEvent(new Event("pointerover", { bubbles: true })));
  act(() => container.querySelector<HTMLButtonElement>(".comment-block-button button")?.click());
  const pending = () => container.querySelector(`.comment-card[data-thread="pending"]`);
  const field = pending()?.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(field);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, "Ask Luke about retries");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  assert.ok(pending(), "the card stays while its words are sent");

  await act(async () => undefined);
  assert.equal(
    pending()?.querySelector<HTMLTextAreaElement>("textarea")?.value,
    "Ask Luke about retries",
    "and takes them back where the send fails",
  );
});

test("in the Comments tab a thread's quote stands under its first comment's writer, so its tools keep the card's top corner", () => {
  const { container } = drawn("tab");
  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  const entry = card?.querySelector(".comment-entry");

  assert.ok(
    entry?.querySelector(
      ":scope > .comment-head + * .comment-quote, :scope > .comment-head + .comment-quote",
    ),
  );
  assert.equal(card?.firstElementChild?.classList.contains("comment-entry"), true);
});

test("a thread's resolve reads as its writer's own line, drawn as a comment's head, and an empty tab says how a thread starts", () => {
  const resolved = threadOn(ID.RESOLVED, "teammate", "A guest, too?", {
    status: PLAN_COMMENT_STATUS.RESOLVED,
    entries: [
      ...threadOn(ID.RESOLVED, "teammate", "A guest, too?").entries,
      {
        id: `${ID.RESOLVED.slice(0, -4)}bbbb`,
        kind: PLAN_COMMENT_ENTRY.RESOLVED,
        writer: {
          actor: PLAN_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-dean", name: "Dean Stratakos" },
        },
        at: 2,
      },
    ],
  });
  const { container } = drawn("tab", [resolved]);

  assert.ok(container.querySelector(".luke-empty-state")?.textContent?.includes("No comments"));
  act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Resolved"]')?.click());
  const event = container.querySelector<HTMLElement>(".comment-event[data-kind='resolved']");
  assert.ok(
    event?.firstElementChild?.classList.contains("comment-head"),
    "drawn as a comment's head",
  );
  assert.ok(event?.textContent?.includes("Dean Stratakos resolved this"));
});

test("the line a thread's ask leaves is not drawn, since the mention in its words says who was asked", () => {
  const asked = threadOn(ID.OPEN, "**single-use link** that expires", "Should this be a setting?", {
    entries: [
      ...threadOn(ID.OPEN, "**single-use link** that expires", "Should this be a setting?").entries,
      {
        id: `${ID.OPEN.slice(0, -4)}cccc`,
        kind: PLAN_COMMENT_ENTRY.ASKED,
        writer: {
          actor: PLAN_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-dean", name: "Dean Stratakos" },
        },
        asked: { actor: PLAN_COMMENT_ACTOR.LUKE },
        at: 2,
      },
    ],
  });
  const { container } = drawn("tab", [asked]);

  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.ok(card);
  assert.equal(card.querySelectorAll(".comment-event").length, 0);
});

/** The plan's page with its text open in the editor from the Goal block's Enter, the editor's caret then stood in the open thread's words, which opens that thread. */
async function caretInThread() {
  installEditorLayout();
  const control: PlanCommentsControl = {
    planId: PLAN.id,
    threads: THREADS,
    read: true,
    failed: false,
    onRetry: () => undefined,
    notes: new Map(),
    start: async () => ({ note: "not in this test" }),
    act: async () => true,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        PlanCommentsProvider,
        { value: control },
        createElement(CommentFocusScope, {
          reveal: undefined,
          children: createElement(PlanBody, {
            task: PLAN,
            live: false,
            sectionLinks: PAGE_LINKS,
            onEdit: () => Promise.resolve({ saved: true } as const),
          }),
        }),
      ),
    ),
  );
  const goal = container.querySelector<HTMLElement>('[role="group"][aria-label="Goal"]');
  assert.ok(goal);
  act(() => goal.focus());
  act(() => {
    goal.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => undefined);
  const words = container.querySelector(`.ProseMirror mark[data-threads~="${ID.OPEN}"]`);
  assert.ok(words?.firstChild, "the editor marks the thread's words");
  const caret = words.firstChild;
  act(() => {
    window.getSelection()?.collapse(caret, 2);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const opened = () =>
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`)?.dataset
      .open === "true";
  assert.ok(opened(), "the caret in the thread's words opens it");
  return { container, opened };
}

test("Tab from the editor to another of the plan's controls closes the thread its caret opened", async () => {
  const { container, opened } = await caretInThread();

  // Note that jsdom moves no focus on a Tab, so the focus goes where Tab takes it: the line's count, the next stop after the text.
  const count = container.querySelector<HTMLButtonElement>(".comment-count button");
  assert.ok(count, "the line's count");
  act(() => count.focus());

  assert.equal(opened(), false);
});

test("the focus going from the editor into the thread its caret opened keeps it open", async () => {
  const { container, opened } = await caretInThread();

  const reply = container.querySelector<HTMLElement>(
    `.comment-card[data-thread="${ID.OPEN}"] textarea`,
  );
  assert.ok(reply, "the thread's reply field");
  act(() => reply.focus());

  assert.ok(opened());
});

test("a press on the line's count while the editor's caret holds its thread open closes it, as the count's toggle does", async () => {
  const { container, opened } = await caretInThread();
  const count = container.querySelector<HTMLButtonElement>(".comment-count button");
  assert.ok(count, "the line's count");

  // Note that a press focuses the count between its pointerdown and its click, as the window does.
  act(() => count.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  act(() => count.focus());
  act(() => count.dispatchEvent(new Event("pointerup", { bubbles: true })));
  act(() => count.click());

  assert.equal(opened(), false);
});

/** The device's main pointer answered as a finger's or a mouse's, which jsdom answers no media query for. */
function answerPointer(coarse: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/** Where the comment bubble stands once `words` in the plan are selected, the selection laid at `box` and the body at the page's top. */
function bubbleOver(words: string, box: { top: number; bottom: number }): HTMLElement {
  const rect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  Range.prototype.getBoundingClientRect = () => new DOMRect(40, box.top, 120, box.bottom - box.top);
  try {
    const { container } = drawn("page");
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let text: Node | null = walker.nextNode();
    while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
    assert.ok(text instanceof Text, `${words} is drawn`);
    const range = document.createRange();
    range.setStart(text, text.data.indexOf(words));
    range.setEnd(text, text.data.indexOf(words) + words.length);
    act(() => {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    const bubble = container.querySelector<HTMLElement>(".comment-bubble");
    assert.ok(bubble, "the bubble stands by the selection");
    return bubble;
  } finally {
    if (rect !== undefined) Object.defineProperty(Range.prototype, "getBoundingClientRect", rect);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    Reflect.deleteProperty(window, "matchMedia");
  }
}

test("on a touch screen the comment bubble stands under the words selected, clear of the system's menu over them, or over them where the window ends first, and with a mouse over them", () => {
  const box = { top: 100, bottom: 120 };

  answerPointer(true);
  const touch = bubbleOver("withdraw an invite", box);
  assert.ok(
    Number.parseFloat(touch.style.top) >= box.bottom,
    "a finger's bubble hangs under the words",
  );

  document.body.innerHTML = "";
  answerPointer(true);
  const low = { top: window.innerHeight - 30, bottom: window.innerHeight - 10 };
  const atEnd = bubbleOver("withdraw an invite", low);
  assert.ok(
    Number.parseFloat(atEnd.style.top) <= low.top,
    "with no room under the words, it rises over them",
  );

  document.body.innerHTML = "";
  answerPointer(false);
  const mouse = bubbleOver("withdraw an invite", box);
  assert.ok(
    Number.parseFloat(mouse.style.top) <= box.top,
    "a mouse's bubble rises from the words' top",
  );
});

/** The window's keymap, which answers a chord while its command's offer stands. */
function Keymap(): null {
  useAppKeymap(true);
  return null;
}

test("⌥⌘M starts a thread on the words selected, as the bubble over them does, and nothing with none selected", async () => {
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(keys);
  act(() => keys.render(createElement(Keymap)));
  const { container, started } = wide(() => drawn("page", []));
  const pending = () => container.querySelector(`.comment-card[data-thread="pending"]`);
  const pressComment = () =>
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "µ",
          code: "KeyM",
          metaKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

  pressComment();
  assert.equal(pending(), null, "with nothing selected, no thread is started");

  const words = "withdraw an invite";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
  assert.ok(text instanceof Text, `${words} is drawn`);
  const range = document.createRange();
  range.setStart(text, text.data.indexOf(words));
  range.setEnd(text, text.data.indexOf(words) + words.length);
  // Note that jsdom lays nothing out, so the selection is given a box for the bubble to stand by.
  const rect = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
  Range.prototype.getBoundingClientRect = () => new DOMRect(40, 100, 120, 20);
  answerPointer(false);
  try {
    act(() => {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
  } finally {
    if (rect !== undefined) Object.defineProperty(Range.prototype, "getBoundingClientRect", rect);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    Reflect.deleteProperty(window, "matchMedia");
  }
  assert.equal(
    container.querySelector(".comment-bubble button")?.getAttribute("aria-keyshortcuts"),
    shortcutAria(APP_SHORTCUTS[APP_COMMAND.COMMENT_ON_SELECTION].chord),
    "the bubble names its key",
  );

  pressComment();
  const field = pending()?.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(field, "the thread is being started");
  await post(field, "Who can withdraw?");
  assert.deepEqual(
    started.map((start) => [
      start.scope,
      start.quote,
      TEXT.slice(start.anchor.from, start.anchor.to),
    ]),
    [[PLAN_COMMENT_SCOPE.WORDS, words, words]],
  );
});
