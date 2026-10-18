// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { DOCUMENT_TASK } from "@luke/panel/testing/document-task";
import { markdownHtmlParserLanded } from "@luke/panel/testing/markdown";
import { useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { DESKTOP_LINKS, fakeAppPlatform } from "#testing/app-platform";
import { editorBundleLanded, installEditorLayout } from "#testing/composer";
import { MARKDOWN_MARK, MarkdownMessage } from "../markdown-message";
import { notesBefore } from "./file-note";
import { PlanBody } from "./plan-body";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions";
import { TranscriptWords } from "./transcript-blocks";
import { HISTORY_READ } from "./use-plan-history";
import { VersionView } from "./version-view";

/**
 * plain-links.test.ts -- a link the window has no chip for is one plain
 * link wherever words are drawn: a transcript, the plan read and edited, a
 * version, and Luke's note. A bare address says its host and path with a
 * ↗, a labelled one its label, and a plain link pressed in the plan, a version, or a note opens in the
 * browser without opening the section's editor. Synthetic plan and
 * repository.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/relay";
const DOCS = "https://example.com/docs";
const BARE =
  "https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY";

const WORDS = [
  `Read [the rollout](https://tryluke.dev/acme/plan/${TASK_ID}#rollout),`,
  `[the store](https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L3-L5),`,
  `[the docs](${DOCS}), and ${BARE}.`,
].join(" ");

const TASK: Task = {
  ...DOCUMENT_TASK,
  id: TASK_ID,
  repository: REPOSITORY,
  document: { body: `## Rollout\n\n${WORDS}`, assumptions: [] },
};

/** What every surface draws the two plain links as: the label, and the bare address cut short. */
const PLAIN = [
  ["the docs", false],
  ["postgresql.org/docs/…/sql-createindex.html", true],
];

const PAGE: TaskMentionsValue = {
  taskId: TASK_ID,
  taskName: "Invitations",
  workspace: "acme",
  repository: REPOSITORY,
  text: () => TASK.document.body,
  doors: {
    taskId: TASK_ID,
    place: { workspace: "acme", repository: REPOSITORY },
    anchors: new Set(["rollout"]),
    onOpenTask: () => undefined,
    onOpenFile: () => undefined,
  },
};

const SECTION_LINKS = {
  workspace: "acme",
  onOpen: () => undefined,
  onOpenFile: () => undefined,
  reveal: undefined,
};

// A reply is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

const roots: Root[] = [];
let sent: Act[] = [];

// Landed before any box renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  sent = [];
  installEditorLayout();
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      sent.push(request);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function drawn(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(TaskMentions, { value: PAGE, children: node })));
  return container;
}

/** Each plain link drawn: what it says, and whether it wears the ↗ of an address cut short. */
function plainLinks(container: HTMLElement): [string | null, boolean][] {
  return [...container.querySelectorAll<HTMLElement>(".luke-text-link")].map((link) => [
    link.textContent,
    link.querySelector("svg") !== null,
  ]);
}

/** A plan's version, read and ready, as the version history draws it. */
function Version(): ReactNode {
  const restore = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
    Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
  );
  return createElement(VersionView, {
    viewing: {
      line: {
        seq: 2,
        lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 2, duringCall: true },
        startedAt: 1,
        changes: 1,
      },
      current: false,
      read: { kind: HISTORY_READ.READY, document: TASK.document, previous: null },
    },
    restore,
  });
}

/** Luke's note on a File tab's lines. */
function Note(): ReactNode {
  const notes = notesBefore({
    notes: [{ callId: "call-1", shownAt: 0, startLine: 3, endLine: 5, note: WORDS }],
    folded: [],
    onFold: () => undefined,
    onShow: () => undefined,
  });
  return notes(3);
}

test("a transcript, the plan, a version, and a note draw a link they have no chip for as one plain link, a bare address cut short", () => {
  const surfaces = [
    drawn(createElement(TranscriptWords, { text: WORDS })),
    drawn(createElement(PlanBody, { task: TASK, live: false, sectionLinks: SECTION_LINKS })),
    drawn(createElement(Version)),
    drawn(createElement(Note)),
  ];

  for (const surface of surfaces) {
    assert.deepEqual(plainLinks(surface), PLAIN);
    assert.equal(surface.querySelectorAll("[data-mention-ref]").length, 2);
  }
});

test("the plan's editor draws a plain link as every place does, whole", async () => {
  const container = drawn(
    createElement(PlanBody, {
      task: TASK,
      live: false,
      onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
      sectionLinks: SECTION_LINKS,
    }),
  );
  const rollout = container.querySelector<HTMLElement>('[role="group"][aria-label="Rollout"]');
  assert.ok(rollout !== null);
  act(() => rollout.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);

  assert.deepEqual(
    [...container.querySelectorAll(".plan-document-text a")].map((link) => link.textContent),
    ["the rollout", "the store", "the docs", BARE],
  );
});

test("a plain link pressed in the plan opens in the browser and opens no editor", async () => {
  const container = drawn(
    createElement(PlanBody, {
      task: TASK,
      live: false,
      onEdit: () => Promise.reject(new Error("Nothing is saved in this test.")),
      sectionLinks: SECTION_LINKS,
    }),
  );

  for (const link of container.querySelectorAll<HTMLElement>(".luke-text-link")) {
    act(() => link.click());
  }
  await act(async () => undefined);

  assert.deepEqual(sent, [
    { kind: ACT_KIND.WEB_OPEN, payload: { url: DOCS } },
    { kind: ACT_KIND.WEB_OPEN, payload: { url: BARE } },
  ]);
  assert.equal(container.querySelector(".plan-document-text"), null);
});

test("a plain link pressed in a version or a note opens in the browser", () => {
  for (const surface of [drawn(createElement(Version)), drawn(createElement(Note))]) {
    sent = [];
    const docs = [...surface.querySelectorAll<HTMLElement>(".luke-text-link")].find(
      (link) => link.textContent === "the docs",
    );
    assert.ok(docs !== undefined);

    act(() => docs.click());

    assert.deepEqual(sent, [{ kind: ACT_KIND.WEB_OPEN, payload: { url: DOCS } }]);
  }
});

test("a bare address an edit or a change marks inside is drawn whole, its caret and its marks where they stand", () => {
  const words = `See ${BARE} now.`;
  const inside = words.indexOf("current");
  const changed = drawn(
    createElement(MarkdownMessage, {
      words,
      edit: {
        marks: [{ kind: MARKDOWN_MARK.INSERTED, from: inside, to: inside + "current".length }],
      },
    }),
  );
  const typed = drawn(createElement(MarkdownMessage, { words, edit: { caret: inside } }));

  for (const surface of [changed, typed]) {
    assert.deepEqual(plainLinks(surface), [[BARE, false]]);
  }
  assert.equal(
    changed.querySelector(".luke-text-link ins.markdown-inserted")?.textContent,
    "current",
  );
  assert.notEqual(typed.querySelector(".luke-text-link .markdown-caret"), null);
});

test("a plain link to an address the window refuses to open is drawn going nowhere", () => {
  const long = `https://example.com/${"a".repeat(2_100)}`;
  const container = drawn(
    createElement(PlanBody, {
      task: {
        ...TASK,
        document: { body: `## Rollout\n\n[the long page](${long})`, assumptions: [] },
      },
      live: false,
      sectionLinks: SECTION_LINKS,
    }),
  );
  const link = container.querySelector<HTMLElement>(".luke-text-link");
  assert.ok(link !== null);

  act(() => link.click());

  assert.equal(link.tagName, "SPAN");
  assert.deepEqual(sent, []);
});

test("a plain link hangs its whole address in the window's hint, an address past the hint's bound cut short", () => {
  const long = `https://example.com/${"a".repeat(2_100)}`;
  const container = drawn(
    createElement(MarkdownMessage, { words: `See ${BARE} and [the long page](${long}).` }),
  );
  const [bare, longLink] = [...container.querySelectorAll<HTMLElement>(".luke-text-link")];
  assert.ok(bare !== undefined && longLink !== undefined);
  const hint = (link: HTMLElement): string | null | undefined => {
    act(() => link.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    return document.querySelector('[role="tooltip"]')?.textContent;
  };

  assert.equal(hint(bare), BARE);
  assert.equal(hint(longLink), `${long.slice(0, 499)}…`);
});
