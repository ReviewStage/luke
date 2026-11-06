// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentActionRequest,
  type DescriptionCommentStartRequest,
  type DescriptionCommentThread,
  type DescriptionCommentWriter,
} from "@repo/features/description-comment-wire";
import { formatCount } from "@repo/features/number-format";
import type { Task } from "@repo/features/task-wire";
import { pasteCutWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { APP_COMMAND, APP_SHORTCUTS, shortcutAria } from "@repo/settings/shortcuts";
import { experimentsOn } from "@repo/settings/testing";
import {
  type DescriptionCommentsControl,
  DescriptionCommentsProvider,
} from "@repo/ui/description-comments";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { useAppKeymap } from "../app-commands.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { readExperiments, registryWith } from "../testing/app-state.js";
import { attachmentChipName } from "../testing/attachment-chip.js";
import {
  composerEditor,
  editorBundleLanded,
  installEditorLayout,
  pasteInComposer,
  pressInComposer,
  typeInComposer,
} from "../testing/composer.js";
import { onRegistry, withQueryClient } from "../testing/copy-feedback.js";
import { AGENT } from "../testing/desktop-inbox.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { restOn } from "../testing/hint-rest.js";
import { relayout } from "../testing/resize-observer.js";
import { DescriptionBody } from "./description-body.js";
import { COMMENTS_FILTER, CommentFocusScope, PageComments } from "./description-comments.js";
import type { EditAgents } from "./edit-ref.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";

// Note that the plan's document, comments, and history stand only while the account has Plans on.
beforeAll(() => readExperiments(experimentsOn(EXPERIMENT.DESCRIPTIONS)));

/**
 * A plan's comments on its own page: each open thread's words marked where
 * the plan holds them, a press on them opening the thread beside them, its
 * ✓ resolving it and its reply posting the words typed, a thread whose
 * words were deleted saying so over its quote, a resolved thread marking
 * nothing and listed under Resolved in the Comments tab, where Reopen
 * brings it back, and no mark on a page that is not the plan's own; and
 * ⌥⌘M starts a thread on the words selected, as the bubble over them does.
 * The margin is measured again as a card is resized, and never on a draw
 * that moves nothing it stands on. Synthetic plan and threads.
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
  overrides: Partial<DescriptionCommentThread> = {},
): DescriptionCommentThread {
  const from = TEXT.indexOf(words);
  assert.ok(from >= 0);
  return {
    id,
    scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
    quote: words.replaceAll("**", ""),
    anchor: { from, to: from + words.length },
    section: "Goal",
    status: DESCRIPTION_COMMENT_STATUS.OPEN,
    entries: [
      {
        id: `${id.slice(0, -4)}aaaa`,
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: {
          actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
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

const THREADS: readonly DescriptionCommentThread[] = [
  threadOn(ID.OPEN, "**single-use link** that expires", "Should this be a setting?"),
  (() => {
    const { anchor: _anchor, ...gone } = threadOn(ID.GONE, "Admins can", "Is withdrawing in v1?", {
      section: "Approach",
      quote: "Admins can revoke an invite from the members page.",
    });
    return gone;
  })(),
  threadOn(ID.RESOLVED, "teammate", "A guest, too?", {
    status: DESCRIPTION_COMMENT_STATUS.RESOLVED,
  }),
];

/** The plan's own page's links, which say the page is the plan's own. */
const PAGE_LINKS = { workspace: "acme", onOpen: () => undefined, reveal: undefined };

const roots: Root[] = [];

beforeEach(() => {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (_request: AnyAct): Promise<FakeActAnswer> =>
        Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  // Note that a comment's unsent words are kept in the window's storage, so each test starts with none.
  window.localStorage.clear();
});

/** The choice of the plan's comments list that lists the resolved threads. */
function resolvedChoice(container: HTMLElement): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((choice) =>
    choice.textContent?.startsWith("Resolved"),
  );
}

/** The plan's page, or the page with its comments listed in the margin's place, drawn over the threads, with every write asked kept. */
function drawn(
  view: "page" | "list" | "other",
  threads: readonly DescriptionCommentThread[] = THREADS,
  landing: () => boolean | Promise<boolean> = () => true,
  plan: Task = PLAN,
  reveal?: { readonly thread: string; readonly ask: number },
  mentions?: TaskMentionsValue,
  me?: string,
  read = true,
  agents?: EditAgents,
) {
  const asked: { thread: string; action: DescriptionCommentActionRequest }[] = [];
  const started: DescriptionCommentStartRequest[] = [];
  /** Why each thread's last act failed, which a test sets before it draws the thread. */
  const notes = new Map<string, string>();
  const control: DescriptionCommentsControl = {
    planId: PLAN.id,
    threads,
    read,
    failed: false,
    onRetry: () => undefined,
    notes,
    start: async (start) => {
      if (!("page" in start)) started.push(start);
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
  // The list draws its threads whole, their writers read as the reader's own and the agents named.
  const reader = view === "list" ? (me ?? "u-dean") : me;
  const page = createElement(DescriptionBody, {
    task: plan,
    ...(view === "other" ? undefined : { sectionLinks: PAGE_LINKS }),
    ...(reader === undefined ? undefined : { reader: { readerId: reader } }),
    ...(view === "list" && agents !== undefined ? { agents } : undefined),
  });
  // Note that every page draws on a registry of its own, so the editor bundle installed for one is read afresh and no draft another left is held.
  const registry = registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS));
  const treeOf = (value: DescriptionCommentsControl) =>
    createElement(
      DescriptionCommentsProvider,
      { value },
      createElement(CommentFocusScope, {
        reveal,
        children:
          mentions === undefined
            ? page
            : createElement(TaskMentions, { value: mentions, children: page }),
      }),
    );
  act(() => root.render(onRegistry(registry, treeOf(control))));
  // The list stands in the margin's place once the plan's Comments toggle is pressed.
  if (view === "list") {
    act(() => container.querySelector<HTMLButtonElement>(".comments-toggle button")?.click());
  }
  /** Draws the page again on the threads the service now lists. */
  const rethread = (next: readonly DescriptionCommentThread[]) =>
    act(() => root.render(onRegistry(registry, treeOf({ ...control, threads: next }))));
  return { container, asked, started, notes, rethread };
}

/** What `draw` drew with the column stood `across` wide, by default wide enough for its margin, since jsdom lays nothing out. */
function wide<Drawn>(draw: () => Drawn, across = 1400): Drawn {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => across,
  });
  try {
    return draw();
  } finally {
    // Note that jsdom holds the width on `Element.prototype`, so the stand-in is taken away rather than put back.
    if (width !== undefined) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  }
}

/** Types `words` into a plain field, as a keyboard's input lands. */
function typeInto(field: HTMLTextAreaElement | null | undefined, words: string): void {
  assert.ok(field, "the field stands");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The words marked for a thread, joined as drawn. */
function markedWords(container: HTMLElement, thread: string): string {
  return [...container.querySelectorAll(`mark.description-comment-mark[data-threads~="${thread}"]`)]
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
    `mark.description-comment-mark[data-threads~="${ID.OPEN}"]`,
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
      [ID.OPEN, DESCRIPTION_COMMENT_ACTION.REPLY, "Not for v1."],
      [ID.OPEN, DESCRIPTION_COMMENT_ACTION.RESOLVE, undefined],
    ],
  );
});

test("a thread resolved fades out of the margin where its card stood, out of reach, and goes once its fade has played", () => {
  const motion = new EventTarget();
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.dataset.leaving === "true" ? [motion] : [];
    },
  });
  try {
    const { container, rethread } = wide(() => drawn("page"));
    const slot = () =>
      container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`)?.closest(".comment-slot");
    const standing = slot();
    assert.ok(standing);

    wide(() =>
      rethread(
        THREADS.map((thread) =>
          thread.id === ID.OPEN
            ? { ...thread, status: DESCRIPTION_COMMENT_STATUS.RESOLVED }
            : thread,
        ),
      ),
    );

    assert.equal(slot(), standing, "the card it had fades, rather than going at once");
    assert.equal(standing.getAttribute("data-leaving"), "true");
    assert.equal(standing.hasAttribute("inert"), true);
    act(() => {
      motion.dispatchEvent(new Event("finish"));
    });
    assert.equal(standing.isConnected, false, "and goes once its fade has played");
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  }
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

test("the plan's comments list, turned to Resolved, lists the resolved thread whole, where Reopen brings it back", async () => {
  const { container, asked } = drawn("list");

  act(() => resolvedChoice(container)?.click());
  assert.deepEqual(
    [...container.querySelectorAll<HTMLElement>(".comments-list .comment-card")].map(
      (card) => card.dataset.thread,
    ),
    [ID.RESOLVED],
  );
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Reopen"]')?.click();
  });

  assert.deepEqual(asked, [
    { thread: ID.RESOLVED, action: { action: DESCRIPTION_COMMENT_ACTION.REOPEN } },
  ]);
});

test("the plan's comments list holds each open thread whole, its reply field under its comments, and no card beside the words", () => {
  const { container } = drawn("list");

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
  assert.equal(container.querySelectorAll(".comment-card").length, cards.length);
});

test("a comment's time reads as a thread's does, a few letters, with the full moment on hover", () => {
  // Note that the window's minute counts on the real clock here, so the comment is dated from it.
  const at = Date.now() - 3 * 3_600_000 - 30_000;
  const [open] = THREADS;
  assert.ok(open?.entries[0]);
  const { container } = drawn("list", [
    { ...open, entries: [{ ...open.entries[0], at }], createdAt: at, updatedAt: at },
  ]);

  const time = container.querySelector<HTMLElement>(".ui-comment-time time");
  assert.equal(time?.textContent, "3h");

  restOn(time as HTMLElement);

  assert.match(
    document.querySelector('[role="tooltip"]')?.textContent ?? "",
    /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s[AP]M$/u,
  );
});

test("a page that is not the plan's own marks no comment", () => {
  const { container } = drawn("other");

  assert.equal(container.querySelectorAll("mark.description-comment-mark").length, 0);
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
    container.querySelector<HTMLElement>(
      `mark.description-comment-mark[data-threads~="${second.id}"]`,
    );
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
    `mark.description-comment-mark[data-threads~="${ID.OPEN}"]`,
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

/** The menu items the first comment's Comment actions offers, over a thread `thread` of the page the reader u-dean reads; none where it draws no ⋯. */
function threadMenuItems(thread: DescriptionCommentThread): string[] | undefined {
  const { container } = drawn(
    "page",
    [thread],
    undefined,
    undefined,
    undefined,
    undefined,
    "u-dean",
  );
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.ok(card, "the thread's card is open");
  const actions = card.querySelector<HTMLButtonElement>('button[aria-label="Comment actions"]');
  if (actions === null) return undefined;
  act(() => actions.click());
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (each) => each.textContent ?? "",
  );
}

/** A thread whose one comment was written by `writer`. */
function startedBy(writer: DescriptionCommentWriter): DescriptionCommentThread {
  const thread = threadOn(ID.OPEN, "**single-use link** that expires", "Why?");
  const [entry] = thread.entries;
  assert.ok(entry);
  return { ...thread, entries: [{ ...entry, writer }] };
}

test("a teammate's thread, with no link to copy here, draws no ⋯ rather than an empty menu, so offers no Delete thread", () => {
  const items = threadMenuItems(
    startedBy({
      actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
      by: { userId: "u-charles", name: "Charles Pan" },
    }),
  );

  assert.equal(items, undefined);
});

test("a thread's menu offers Delete thread over the reader's own thread", () => {
  const items = threadMenuItems(
    startedBy({ actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: { userId: "u-dean", name: "Dean" } }),
  );

  assert.ok(items?.includes("Delete thread"));
});

test("a thread's menu offers Delete thread to any member over a thread an agent started", () => {
  const items = threadMenuItems(startedBy({ actor: DESCRIPTION_COMMENT_ACTOR.AGENT }));

  assert.ok(items?.includes("Delete thread"));
});

test("deleting a thread asks first, and only the confirm deletes it", async () => {
  const { container, asked } = drawn(
    "page",
    [datedThread({ userId: "u-dean", name: "Dean" })],
    undefined,
    undefined,
    undefined,
    undefined,
    "u-dean",
  );
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  act(() =>
    card?.querySelector<HTMLButtonElement>('button[aria-label="Comment actions"]')?.click(),
  );
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
    { thread: ID.OPEN, action: { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD } },
  ]);
});

test("words a block thread and a word thread both cover are marked once, naming both threads, as a block's other words name its own", () => {
  const paragraph = "Admins can withdraw an invite. A withdrawn link never grants access again.";
  const block = threadOn(ID.GONE, paragraph, "Is this v1?", {
    scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
    section: "Approach",
  });
  const words = threadOn(ID.OPEN, "withdraw an invite", "From where?", { section: "Approach" });
  const { container } = drawn("page", [block, words]);

  const shared = container.querySelector<HTMLElement>(
    `mark.description-comment-mark[data-threads~="${ID.OPEN}"]`,
  );
  const blockOnly = [
    ...container.querySelectorAll<HTMLElement>("mark.description-comment-mark"),
  ].find((mark) => mark.dataset.threads === ID.GONE);

  assert.deepEqual(shared?.dataset.threads?.split(" ").sort(), [ID.GONE, ID.OPEN].sort());
  assert.ok(blockOnly, "the rest of the block is marked as the block thread's");
  assert.equal(container.querySelectorAll(".comment-block-edge").length, 0, "and draws no bar");
});

test("a press away from the open thread closes it, and a press inside it keeps it open", () => {
  const { container } = drawn("page");
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
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
  assert.deepEqual(spans[0], [DESCRIPTION_COMMENT_SCOPE.BLOCK, "Second item", "Second item"]);
  assert.deepEqual(spans.at(-1), [DESCRIPTION_COMMENT_SCOPE.BLOCK, "nested two", "nested two"]);
});

test("a thread at rest opens from a press anywhere on its card", () => {
  const { container } = drawn("page");
  act(() => container.querySelector<HTMLButtonElement>(".comment-count button")?.click());
  const card = () =>
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.GONE}"]`);
  assert.equal(card()?.dataset.open, "false");

  act(() => card()?.querySelector<HTMLElement>(".ui-comment-head")?.click());
  assert.equal(card()?.dataset.open, "true", "the card's head opens it");
});

test("a press that opens a thread puts the caret in its reply, and a thread drawn open takes none", () => {
  const { container } = drawn("page");
  act(() => container.querySelector<HTMLButtonElement>(".comment-count button")?.click());
  const card = () =>
    container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.GONE}"]`);
  assert.equal(card()?.querySelector("textarea"), null, "a card at rest has no field");

  act(() => card()?.querySelector<HTMLElement>(".ui-comment-head")?.click());

  const reply = card()?.querySelector("textarea");
  assert.ok(reply, "the open thread's reply field");
  assert.equal(document.activeElement, reply);

  const tab = drawn("list");
  const [field] = tab.container.querySelectorAll("textarea");
  assert.ok(field, "the Comments tab's reply field");
  assert.notEqual(
    document.activeElement,
    field,
    "a tab of threads open from the first takes no caret",
  );
});

test("a failed act on an open thread says why in its reply's foot", () => {
  const { container, notes } = drawn("page");
  const mark = container.querySelector<HTMLElement>(
    `mark.description-comment-mark[data-threads~="${ID.OPEN}"]`,
  );
  notes.set(ID.OPEN, "Could not resolve the thread.");

  act(() => mark?.click());

  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.equal(
    card?.querySelector(".ui-composer-foot-note")?.textContent,
    "Could not resolve the thread.",
  );
});

test("the pointer on a thread's words marks its card before a press", () => {
  const { container } = wide(() => drawn("page"));
  const mark = container.querySelector<HTMLElement>(
    `mark.description-comment-mark[data-threads~="${ID.OPEN}"]`,
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

test("a line's count stands centered on the first line its words stand on, though they wrap onto the next", () => {
  // Note that jsdom lays nothing out, so the marked words are given two line boxes 22px apart, the body at the page's top.
  const lines = Object.getOwnPropertyDescriptor(Element.prototype, "getClientRects");
  Element.prototype.getClientRects = function (this: Element) {
    const marked = this.classList.contains("description-comment-mark");
    return (marked ? [new DOMRect(40, 100, 300, 20), new DOMRect(0, 122, 200, 20)] : []) as never;
  };
  try {
    const { container } = drawn("page");
    const count = container.querySelector<HTMLElement>(".comment-count");
    assert.equal(count?.style.top, "110px", "the middle of the first line's box");
  } finally {
    if (lines !== undefined) Object.defineProperty(Element.prototype, "getClientRects", lines);
  }
});

test("a fold's counts stand in the order of their lines, so the keyboard meets them top to bottom", () => {
  // Note that the thread listed first stands on the lower line, and jsdom lays nothing out, so each mark is given its line's top.
  const lower = threadOn(ID.GONE, "Admins can withdraw", "Who else?", { section: "Approach" });
  const upper = threadOn(ID.OPEN, "**single-use link** that expires", "A setting?");
  const at = new Map<string, number>([
    [ID.GONE, 300],
    [ID.OPEN, 100],
  ]);
  const rect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const thread = this.closest<HTMLElement>("mark.description-comment-mark")?.dataset.threads;
    return new DOMRect(0, (thread === undefined ? undefined : at.get(thread)) ?? 0, 0, 0);
  };
  try {
    const { container } = drawn("page", [lower, upper]);
    const counts = [...container.querySelectorAll<HTMLElement>(".comment-count")];
    assert.deepEqual(
      counts.map((count) => count.style.top),
      ["100px", "300px"],
    );
  } finally {
    if (rect !== undefined) Object.defineProperty(Element.prototype, "getBoundingClientRect", rect);
  }
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
    const { container } = drawn("page", THREADS, () => true, PLAN, {
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
  holder: { taskId: PLAN.id },
  taskName: "Invitations",
  workspace: "acme",
  repository: "acme/relay",
  text: () => TEXT,
  doors: {
    holder: { taskId: PLAN.id },
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
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: {
          actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-charles", name: "Charles Pan" },
        },
        words: `See [@Goal](https://vespin.dev/acme/plan/${PLAN.id}#goal) first.`,
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
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
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
    [[DESCRIPTION_COMMENT_ACTION.REPLY, "Agreed."]],
  );
});

test("a reply pasted past the comment's cap is cut to the room left and the card says so, until the words change, and the counter stands from four fifths of the cap", () => {
  installEditorLayout();
  const { container } = drawn(
    "page",
    [THREADS[0] as DescriptionCommentThread],
    () => true,
    PLAN,
    undefined,
    PAGE_MENTIONS,
  );
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card = container.querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.ok(card);
  const cap = DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS;
  const note = () => card.querySelector(".ui-composer-foot-note")?.textContent;
  assert.equal(card.querySelector(".ui-length-counter"), null);

  pasteInComposer(card, "x".repeat(cap + 100));
  assert.equal(note(), pasteCutWords(cap));
  assert.equal(
    card.querySelector(".ui-length-counter")?.textContent,
    `${formatCount(cap)}/${formatCount(cap)}`,
  );

  const editor = composerEditor(card).editor;
  assert.ok(editor);
  act(() => {
    editor.view.dispatch(editor.state.tr.delete(1, 2));
  });
  assert.equal(note(), undefined, "the note goes once the words change again");
});

test("a thread at rest draws its comment's mentions as their chips, as it does open, and a press on one opens the thread too", async () => {
  installEditorLayout();
  const mentioned = threadOn(ID.OPEN, "**single-use link** that expires", "", {
    entries: [
      {
        id: `${ID.OPEN.slice(0, -4)}aaaa`,
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: {
          actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-charles", name: "Charles Pan" },
        },
        words: `See [@Goal](https://vespin.dev/acme/plan/${PLAN.id}#goal) first.`,
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
    scope: DESCRIPTION_COMMENT_SCOPE.BLOCK,
    section: "Approach",
  });
  const onWord = threadOn(ID.RESOLVED, "withdraw", "Or revoke?", { section: "Approach" });
  const blocks = (container: HTMLElement) => {
    const button = (block: Element) => {
      act(() => block.dispatchEvent(new Event("pointerover", { bubbles: true })));
      return container.querySelector(".comment-block-button button");
    };
    const heading = (name: string) =>
      [...container.querySelectorAll(".ui-markdown-heading")].find((h) => h.textContent === name);
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

test("a finger's arrival on a block shows no button, so iOS spends no tap on one, a link's in it among them, and its tap shows the button by that block", () => {
  const { container } = wide(() => drawn("page", []));
  const paragraph =
    [...container.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Admins can withdraw"),
    ) ?? assert.fail("the paragraph");
  const finger = (type: string) =>
    act(() => {
      paragraph.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch" }));
    });
  const button = () => container.querySelector(".comment-block-button button");

  finger("pointerover");
  assert.ok(button() === null, "the arrival shows none");

  finger("pointerdown");
  finger("pointerup");
  act(() => paragraph.click());
  assert.ok(button() !== null, "the tap shows it");
});

test("a thread being started goes on a press away and on Esc, and its words come back as it is started on the same words again", () => {
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
  const field = () => pending()?.querySelector<HTMLTextAreaElement>("textarea");
  const away = () =>
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));

  startOn();
  assert.ok(pending(), "the thread is being started");
  away();
  assert.ok(pending() === null, "empty, it goes");

  startOn();
  typeInto(field(), "Worth a setting?");
  away();
  assert.ok(pending() === null, "holding words, it goes too");

  startOn();
  assert.equal(field()?.value, "Worth a setting?", "its words come back");
  act(() => {
    field()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.ok(pending() === null, "Esc lets it go");

  startOn();
  assert.equal(field()?.value, "Worth a setting?", "and keeps its words");
});

test("a reply's words outlast its thread closing, and come back as it opens again", () => {
  const { container } = drawn("page");
  const open = () =>
    act(() =>
      container
        .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
        ?.click(),
    );
  const field = () =>
    container.querySelector<HTMLTextAreaElement>(
      `.comment-card[data-thread="${ID.OPEN}"][data-open="true"] textarea`,
    );

  open();
  typeInto(field(), "Not for v1.");
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  assert.ok(field() === null, "the thread is closed");

  open();
  assert.equal(field()?.value, "Not for v1.");
});

test("on a finger's keyboard Return in a comment's field breaks the line, and ⌘Return sends it", async () => {
  answerPointer(true);
  try {
    const { container, asked } = drawn("page");
    act(() =>
      container
        .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
        ?.click(),
    );
    const field = container.querySelector<HTMLTextAreaElement>(
      `.comment-card[data-thread="${ID.OPEN}"] textarea`,
    );
    typeInto(field, "Not for v1.");

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      field?.dispatchEvent(enter);
    });
    assert.equal(asked.length, 0, "Return sends nothing");
    assert.equal(enter.defaultPrevented, false, "and types its line");

    await act(async () => {
      field?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });
    assert.deepEqual(
      asked.map(({ action }) => ("words" in action ? action.words : undefined)),
      ["Not for v1."],
    );
  } finally {
    answerMouse();
  }
});

test("on a plan's page a comment's field offers dictation, and the plain field none", async () => {
  installEditorLayout();
  const withMentions = drawn("page", THREADS, () => true, PLAN, undefined, PAGE_MENTIONS);
  act(() =>
    withMentions.container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  await act(async () => undefined);
  const plain = drawn("page");
  act(() =>
    plain.container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );

  const dictate = (container: HTMLElement) =>
    container.querySelector(
      `.comment-card[data-thread="${ID.OPEN}"] .ui-composer-foot button[aria-label^="Dictate"]`,
    );
  assert.ok(dictate(withMentions.container), "the editor's field takes a dictation");
  assert.equal(dictate(plain.container), null, "the plain field does not");
});

test("in the plan's comments list a thread's quote lights its words in the plan, and a deleted thread's quote is a press too", () => {
  const { container } = drawn("list");
  const quote = (thread: string) =>
    container.querySelector<HTMLButtonElement>(
      `.comment-card[data-thread="${thread}"] .comment-quote button`,
    );

  assert.ok(quote(ID.OPEN) && quote(ID.GONE), "both quotes are presses");
  act(() => quote(ID.OPEN)?.click());

  assert.equal(
    container
      .querySelector(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.getAttribute("data-active"),
    "true",
  );
});

test("a comment's field offers no Vespin among the agents, since no task has one, and no Send to beside it", async () => {
  installEditorLayout();
  const { container } = drawn("page", THREADS, () => true, PLAN, undefined, PAGE_MENTIONS);
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
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
  assert.ok(
    rows.every((row) => !row.startsWith("Vespin")),
    `no Vespin is offered: ${rows.join(" | ")}`,
  );
  assert.equal(card.querySelector(".comment-send-to"), null);
});

test("a reply's field empties as it is sent and takes the next at once, each sent as it is written, and a refused reply comes back into the field, sent again under its key", async () => {
  const answer = Promise.withResolvers<boolean>();
  const { container, asked } = drawn("page", THREADS, () =>
    asked.length === 1 ? false : asked.length === 2 ? answer.promise : true,
  );
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const field = container.querySelector<HTMLTextAreaElement>(
    `.comment-card[data-thread="${ID.OPEN}"] textarea`,
  );
  assert.ok(field);
  await post(field, "Not for v1.");
  assert.equal(field.value, "Not for v1.", "a reply refused comes back into the field");

  await post(field, "Not for v1.");
  assert.equal(field.value, "", "the field empties as the words are sent");
  await post(field, "Maybe v2.");
  const words = () => asked.map(({ action }) => ("words" in action ? action.words : undefined));
  assert.deepEqual(words(), ["Not for v1.", "Not for v1.", "Maybe v2."], "none waits on another");
  await act(async () => answer.resolve(false));
  assert.equal(field.value, "Not for v1.");

  const keys = asked.map(({ action }) => ("clientKey" in action ? action.clientKey : undefined));
  assert.equal(keys[1], keys[0], "the reply whose answer may be lost goes again under its key");
  assert.notEqual(keys[2], keys[1]);
});

test("a thread being started gives its card's place to the thread as its words are sent, under the id its first comment's key names, and words refused stand as not sent where its words are commented on again", async () => {
  const { container, started } = wide(() => drawn("page", []));
  const paragraph = [...container.querySelectorAll("p")].find((p) =>
    p.textContent?.startsWith("Admins can withdraw"),
  );
  assert.ok(paragraph);
  const comment = () => {
    act(() => paragraph.dispatchEvent(new Event("pointerover", { bubbles: true })));
    act(() => container.querySelector<HTMLButtonElement>(".comment-block-button button")?.click());
  };
  const pending = () => container.querySelector(`.comment-card[data-thread="pending"]`);
  comment();
  const field = pending()?.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(field);
  typeInto(field, "Ask Vespin about retries");

  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  assert.equal(pending(), null, "the card gives way as its words are sent");
  const [start] = started;
  assert.ok(start);
  assert.equal(start.id, start.clientKey);

  await act(async () => undefined);
  comment();
  assert.equal(
    pending()?.querySelector("[data-unsent] .comment-words")?.textContent,
    "Ask Vespin about retries",
  );
});

test("a thread's resolve reads as its writer's own line, drawn as a comment's head, an agent of another task named as the workspace's list names it, and an empty tab says how a thread starts", () => {
  const resolvedBy = (id: string, writer: DescriptionCommentThread["entries"][number]["writer"]) =>
    threadOn(id, "teammate", "A guest, too?", {
      status: DESCRIPTION_COMMENT_STATUS.RESOLVED,
      entries: [
        ...threadOn(id, "teammate", "A guest, too?").entries,
        { id: `${id.slice(0, -4)}bbbb`, kind: DESCRIPTION_COMMENT_ENTRY.RESOLVED, writer, at: 2 },
      ],
    });
  const byMember = resolvedBy(ID.RESOLVED, {
    actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
    by: { userId: "u-dean", name: "Dean Stratakos" },
  });
  const byAgent = resolvedBy(ID.GONE, {
    actor: DESCRIPTION_COMMENT_ACTOR.AGENT,
    agentId: AGENT.id,
  });
  // The agent works on another task, so only the window's list across the workspace holds it.
  const agents: EditAgents = {
    control: {
      agents: [],
      archived: [],
      listed: [AGENT],
      models: [],
      me: "u-dean",
      pullRequests: new Map(),
    },
    onOpen: undefined,
  };
  const { container } = drawn(
    "list",
    [byMember, byAgent],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
    agents,
  );

  assert.ok(container.querySelector(".ui-empty-state")?.textContent?.includes("No comments"));
  act(() => resolvedChoice(container)?.click());
  const events = [
    ...container.querySelectorAll<HTMLElement>(".comment-event[data-kind='resolved']"),
  ];
  assert.ok(
    events[0]?.querySelector(":scope > .ui-comment > .ui-comment-head"),
    "drawn as a comment's head",
  );
  const lines = events.map((event) => event.textContent ?? "");
  assert.ok(lines.some((line) => line.includes("Dean Stratakos resolved this")));
  assert.ok(lines.some((line) => line.includes(`${AGENT.title} resolved this`)));
});

test("the line a thread's ask leaves is not drawn, since the mention in its words says who was asked", () => {
  const asked = threadOn(ID.OPEN, "**single-use link** that expires", "Should this be a setting?", {
    entries: [
      ...threadOn(ID.OPEN, "**single-use link** that expires", "Should this be a setting?").entries,
      {
        id: `${ID.OPEN.slice(0, -4)}cccc`,
        kind: DESCRIPTION_COMMENT_ENTRY.ASKED,
        writer: {
          actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
          by: { userId: "u-dean", name: "Dean Stratakos" },
        },
        asked: { actor: DESCRIPTION_COMMENT_ACTOR.APP },
        at: 2,
      },
    ],
  });
  const { container } = drawn("list", [asked]);

  const card = container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`);
  assert.ok(card);
  assert.equal(card.querySelectorAll(".comment-event").length, 0);
});

/** The plan's page with its text open in the editor from the Goal block's Enter, the editor's caret then stood in the open thread's words, which opens that thread. */
async function caretInThread() {
  installEditorLayout();
  const control: DescriptionCommentsControl = {
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
      withQueryClient(
        createElement(
          DescriptionCommentsProvider,
          { value: control },
          createElement(CommentFocusScope, {
            reveal: undefined,
            children: createElement(DescriptionBody, {
              task: PLAN,
              sectionLinks: PAGE_LINKS,
              onEdit: () => Promise.resolve({ saved: true } as const),
            }),
          }),
        ),
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

/** The suite's own answer to a media query, a mouse's, which a test answering for a finger puts back. */
const MOUSE_MEDIA = Object.getOwnPropertyDescriptor(window, "matchMedia");

/** Puts back the suite's mouse, which every field's send key asks after. */
function answerMouse(): void {
  if (MOUSE_MEDIA !== undefined) Object.defineProperty(window, "matchMedia", MOUSE_MEDIA);
}

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
    answerMouse();
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
  act(() => keys.render(withQueryClient(createElement(Keymap))));
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
    answerMouse();
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
    [[DESCRIPTION_COMMENT_SCOPE.WORDS, words, words]],
  );
});

test("words selected in a plan whose tab is then hidden take the bubble and ⌥⌘M with them, and bring them back as it is shown again", async () => {
  const keys = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(keys);
  act(() => keys.render(withQueryClient(createElement(Keymap))));
  const { container } = wide(() => drawn("page", []));
  const words = "withdraw an invite";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text: Node | null = walker.nextNode();
  while (text !== null && !(text.textContent ?? "").includes(words)) text = walker.nextNode();
  assert.ok(text instanceof Text, `${words} is drawn`);
  const range = document.createRange();
  range.setStart(text, text.data.indexOf(words));
  range.setEnd(text, text.data.indexOf(words) + words.length);
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
    answerMouse();
  }
  assert.ok(container.querySelector(".comment-bubble"), "the bubble stands by the selection");

  await act(async () => {
    container.hidden = true;
    await Promise.resolve();
  });
  assert.equal(container.querySelector(".comment-bubble"), null, "the bubble goes with the tab");
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
  assert.equal(
    container.querySelector(`.comment-card[data-thread="pending"]`),
    null,
    "⌥⌘M starts no thread on the hidden plan",
  );

  Range.prototype.getBoundingClientRect = () => new DOMRect(40, 100, 120, 20);
  answerPointer(false);
  try {
    await act(async () => {
      container.hidden = false;
      await Promise.resolve();
    });
  } finally {
    if (rect !== undefined) Object.defineProperty(Range.prototype, "getBoundingClientRect", rect);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    answerMouse();
  }
  assert.ok(container.querySelector(".comment-bubble"), "the bubble stands again by the words");
});

/** Hands files to a field's picker, as a member picks them, and waits for them to be read. */
async function pickFiles(field: Element, files: readonly File[]): Promise<void> {
  const picker =
    field.querySelector<HTMLInputElement>('input[type="file"]') ?? assert.fail("no file picker");
  Object.defineProperty(picker, "files", { configurable: true, value: files });
  await act(async () => {
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Note that a file is read off the disk before it lands in the field.
  for (let round = 0; round < 4; round += 1) await act(() => Promise.resolve());
}

test("a reply carries the files picked into its field, and a comment's files are drawn under its words, each read as the plan's", async () => {
  const notes = Buffer.from("expiry: 7 days\n").toString("base64");
  const read: string[] = [];
  fakeActs({
    act: (request: AnyAct): Promise<FakeActAnswer> => {
      if (request.kind !== ACT_KIND.TASKS_PICTURE_READ) {
        return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
      }
      read.push(request.payload.attachmentId);
      return Promise.resolve({
        status: FAKE_ANSWER.DONE,
        value: { contentType: "text/plain", base64: notes },
      });
    },
  });
  const fileId = "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f80";
  const [open] = THREADS;
  assert.ok(open);
  const withFile: DescriptionCommentThread = {
    ...open,
    entries: open.entries.map((entry) => ({
      ...entry,
      files: [{ attachmentId: fileId, name: "expiry.txt", mediaType: "text/plain" }],
    })),
  };
  const { container, asked } = drawn("page", [withFile, ...THREADS.slice(1)]);
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  await act(() => Promise.resolve());
  const card =
    container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`) ?? assert.fail("no card");

  const sent = [...card.querySelectorAll('.comment-files [aria-label="Attached files"] > li')];
  assert.deepEqual(sent.map(attachmentChipName), ["expiry.txt"]);
  assert.deepEqual(read, [fileId]);
  const words = card.querySelector(".comment-entry .comment-words");
  assert.ok(sent[0] && words);
  assert.ok(
    sent[0].compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING,
    "a comment's files stand over its words",
  );

  const field = card.querySelector(".comment-field") ?? assert.fail("no reply field");
  await pickFiles(field, [new File(["Steps to reproduce\n"], "steps.txt", { type: "text/plain" })]);
  assert.deepEqual(
    [...field.querySelectorAll('[aria-label="Attached files"] > li')].map(attachmentChipName),
    ["steps.txt"],
  );
  await post(field.querySelector("textarea") ?? assert.fail("no textarea"), "Repro attached.");

  const [reply] = asked;
  assert.equal(reply?.action.action, DESCRIPTION_COMMENT_ACTION.REPLY);
  assert.deepEqual(
    reply !== undefined && "attachments" in reply.action
      ? reply.action.attachments?.map((file) => [file.name, file.mediaType, file.data])
      : undefined,
    [["steps.txt", "text/plain", Buffer.from("Steps to reproduce\n").toString("base64")]],
  );
  assert.equal(field.querySelectorAll('[aria-label="Attached files"] > li').length, 0);
});

test("a picture pasted into the plain field is attached to the reply, as the editor's paste attaches one", async () => {
  const { container, asked } = drawn("page");
  act(() =>
    container
      .querySelector<HTMLElement>(`mark.description-comment-mark[data-threads~="${ID.OPEN}"]`)
      ?.click(),
  );
  const card =
    container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`) ?? assert.fail("no card");
  const field = card.querySelector("textarea") ?? assert.fail("no textarea");
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [new File([png], "screenshot.png", { type: "image/png" })] },
  });
  await act(async () => {
    field.dispatchEvent(paste);
  });
  for (let round = 0; round < 4; round += 1) await act(() => Promise.resolve());

  assert.equal(paste.defaultPrevented, true);
  await post(field, "Like this.");
  const [reply] = asked;
  assert.deepEqual(
    reply !== undefined && "attachments" in reply.action
      ? reply.action.attachments?.map((file) => [file.name, file.mediaType])
      : undefined,
    [["screenshot.png", "image/png"]],
  );
});

/** A thread whose one comment, written by `by`, names a date. */
function datedThread(by: { userId: string; name: string }): DescriptionCommentThread {
  return threadOn(ID.OPEN, "**single-use link** that expires", "", {
    entries: [
      {
        id: `${ID.OPEN.slice(0, -4)}aaaa`,
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by },
        words: "Ship by [@Oct 23, 2026](mention://date/2026-10-23).",
        at: 1,
      },
    ],
  });
}

test("the date chip in the reader's own comment opens its picker with no field opened, and a day picked there saves the comment with the date named anew", async () => {
  const { container, asked } = drawn("list", [datedThread({ userId: "u-dean", name: "Dean" })]);

  act(() => container.querySelector<HTMLElement>('.comment-entry [data-kind="date"]')?.click());
  await act(async () => undefined);
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog, "the picker is open");
  assert.equal(container.querySelector(".comment-editing"), null);
  act(() =>
    dialog.querySelector<HTMLElement>('button[aria-label="Saturday, October 24, 2026"]')?.click(),
  );
  act(() =>
    (dialog.contains(document.activeElement) ? document.activeElement : dialog)?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  await act(async () => undefined);

  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.deepEqual(asked, [
    {
      thread: ID.OPEN,
      action: {
        action: DESCRIPTION_COMMENT_ACTION.EDIT,
        entry: `${ID.OPEN.slice(0, -4)}aaaa`,
        words: "Ship by [@Oct 24, 2026](mention://date/2026-10-24).",
      },
    },
  ]);
});

test("the date chip in another's comment opens no picker, since only its writer changes it", () => {
  const { container } = drawn("list", [datedThread({ userId: "u-charles", name: "Charles Pan" })]);

  const chip = container.querySelector<HTMLElement>('.comment-entry [data-kind="date"]');
  assert.ok(chip);
  act(() => chip.click());

  assert.equal(chip.tagName, "SPAN");
  assert.equal(container.querySelector('[role="dialog"]'), null);
});

test("on the plan's page the date chip in the reader's own comment, its thread open in the margin, opens its picker beside it", async () => {
  const thread = datedThread({ userId: "u-dean", name: "Dean" });
  const { container } = wide(() =>
    drawn("page", [thread], () => true, PLAN, undefined, undefined, "u-dean"),
  );
  await act(async () => undefined);
  act(() =>
    container
      .querySelector<HTMLElement>(`.comment-card[data-thread="${ID.OPEN}"] .ui-comment-head`)
      ?.click(),
  );

  act(() =>
    container
      .querySelector<HTMLElement>(
        '.comment-card[data-open="true"] .comment-entry [data-kind="date"]',
      )
      ?.click(),
  );
  await act(async () => undefined);

  assert.ok(container.querySelector('[role="dialog"]'), "the picker is open");
});

/** The margin's cards' tops, in the order drawn, as their slots stand them. */
function slotTops(container: HTMLElement): number[] {
  return [...container.querySelectorAll<HTMLElement>(".comment-margin .comment-slot")].map((slot) =>
    Number(/translateY\((-?[\d.]+)px\)/.exec(slot.style.transform)?.[1]),
  );
}

/** Stands every card of the margin `height` tall, as `heights.card` says when read, since jsdom lays nothing out. */
function cardsTall(heights: { card: number }): () => void {
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("comment-slot") ? heights.card : 0;
    },
  });
  return () => {
    if (offset !== undefined) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offset);
    else Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
  };
}

test("a card that grows with nothing drawn again moves the card under it down, in the frame after", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((heard) => frames.push(heard));
  const heights = { card: 40 };
  const restore = cardsTall(heights);
  try {
    const { container } = wide(() => drawn("page"));
    assert.deepEqual(slotTops(container), [0, 48]);

    heights.card = 120;
    wide(() => {
      act(() => relayout());
      act(() => {
        for (const heard of frames.splice(0)) heard(0);
      });
    });

    assert.deepEqual(slotTops(container), [0, 128]);
  } finally {
    restore();
    vi.restoreAllMocks();
  }
});

/** The reader's own comment in the Comments tab, with presses that open its Edit and the field it opens. */
function ownComment(landing?: () => boolean | Promise<boolean>) {
  const drawnTab = drawn("list", [datedThread({ userId: "u-dean", name: "Dean" })], landing);
  const { container } = drawnTab;
  const edit = () => {
    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Comment actions"]')?.click(),
    );
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (each) => each.textContent === "Edit",
    );
    assert.ok(item, "the menu offers Edit");
    act(() => item.click());
  };
  const field = () => container.querySelector<HTMLTextAreaElement>(".comment-editing textarea");
  const press = (label: string) =>
    act(() =>
      [...container.querySelectorAll<HTMLButtonElement>(".comment-editing button")]
        .find((each) => each.textContent === label)
        ?.click(),
    );
  return { ...drawnTab, edit, field, press };
}

test("an edit's words outlast Cancel and Esc, come back as Edit opens it again, and go once it is saved", async () => {
  const { edit, field, press, asked } = ownComment();

  edit();
  assert.equal(field()?.value, "Ship by [@Oct 23, 2026](mention://date/2026-10-23).");
  typeInto(field(), "Ship by Friday.");
  press("Cancel");
  assert.ok(field() === null, "Cancel closes the field");

  edit();
  assert.equal(field()?.value, "Ship by Friday.", "its words come back");
  act(() => {
    field()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.ok(field() === null, "Esc closes the field");

  edit();
  assert.equal(field()?.value, "Ship by Friday.", "and keeps them too");
  await act(async () => press("Save"));
  assert.deepEqual(
    asked.map(({ action }) => ("words" in action ? action.words : undefined)),
    ["Ship by Friday."],
  );

  edit();
  assert.equal(
    field()?.value,
    "Ship by [@Oct 23, 2026](mention://date/2026-10-23).",
    "saved, its draft is let go",
  );
});

test("an edit's field closes on Save, before the service answers", () => {
  const { edit, field, press, asked } = ownComment(() => Promise.withResolvers<boolean>().promise);

  edit();
  typeInto(field(), "Ship by Friday.");
  press("Save");

  assert.ok(field() === null);
  assert.deepEqual(
    asked.map(({ action }) => ("words" in action ? action.words : undefined)),
    ["Ship by Friday."],
  );
});

test("an edit emptied and saved asks to delete the comment, and only the confirm deletes it", async () => {
  const { edit, field, press, asked } = ownComment();

  edit();
  typeInto(field(), "");
  await act(async () => press("Save"));

  assert.equal(asked.length, 0, "nothing is saved yet");
  const confirm = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="alertdialog"] button, [role="dialog"] button',
    ),
  ].find((each) => each.textContent === "Delete thread");
  assert.ok(confirm, "the delete is asked");
  assert.match(
    document.querySelector('[role="alertdialog"], [role="dialog"]')?.textContent ?? "",
    /This cannot be undone\./u,
    "the question says it cannot be undone",
  );
  await act(async () => confirm.click());
  assert.deepEqual(asked, [
    { thread: ID.OPEN, action: { action: DESCRIPTION_COMMENT_ACTION.DELETE_THREAD } },
  ]);
});

test("a scroller with room for the reading width and one margin, but not one on each side of the centered column, folds its threads to counts rather than running a card past its edge", () => {
  const { container } = wide(() => drawn("page"), 1200);

  assert.ok(container.querySelector(".comment-count"), "the threads are counted at their lines");
  assert.equal(container.querySelector(".comment-margin"), null, "no margin stands");
});

test("a thread resolved fades out of a page's column where its row stood, out of reach, and goes once its fade has played", () => {
  const motion = new EventTarget();
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.dataset.leaving === "true" ? [motion] : [];
    },
  });
  try {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const registry = registryWith(experimentsOn(EXPERIMENT.DESCRIPTIONS));
    const draw = (threads: readonly DescriptionCommentThread[]) =>
      act(() =>
        root.render(
          onRegistry(
            registry,
            createElement(PageComments, {
              control: {
                planId: PLAN.id,
                threads,
                read: true,
                failed: false,
                onRetry: () => undefined,
                notes: new Map(),
                start: async () => ({ note: "not in this test" }),
                act: async () => true,
              },
              doors: { agents: undefined, me: "u-dean" },
              open: undefined,
              filter: COMMENTS_FILTER.OPEN,
              onFilter: () => undefined,
              onOpen: () => undefined,
            }),
          ),
        ),
      );
    draw(THREADS);
    const slot = () =>
      container.querySelector(`.comment-card[data-thread="${ID.OPEN}"]`)?.closest(".comment-slot");
    const standing = slot();
    assert.ok(standing);

    draw(
      THREADS.map((thread) =>
        thread.id === ID.OPEN ? { ...thread, status: DESCRIPTION_COMMENT_STATUS.RESOLVED } : thread,
      ),
    );

    assert.equal(slot() === standing, true, "the row it had fades, rather than going at once");
    assert.equal(standing.getAttribute("data-leaving"), "true");
    assert.equal(standing.hasAttribute("inert"), true);
    act(() => {
      motion.dispatchEvent(new Event("finish"));
    });
    assert.equal(standing.isConnected, false, "and goes once its fade has played");
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  }
});
