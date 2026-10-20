// @vitest-environment jsdom

import assert from "node:assert/strict";
import { inboxAttachmentAddress } from "@luke/features/inbox-attachment-link";
import { LINK_PLACE, linkOf } from "@luke/features/luke-link";
import type { TaskFileRequest } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Effect } from "effect";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import {
  type AnyAct,
  fakeActPort,
  fakeAppBridge,
  type OpenedLink,
  openingLinks,
} from "../testing/app-bridge.js";
import { DESKTOP_LINKS, fakeAppPlatform } from "../testing/app-platform.js";
import { markdownHtmlParserLanded } from "../testing/markdown.js";
import { InboxPictures } from "./inbox-pictures.js";
import { LoneLinkCards } from "./lone-link-card.js";
import { SentWords } from "./skill-chip.js";
import { TranscriptWords } from "./transcript-blocks.js";
import type { InboxImage } from "./use-task-inbox.js";

/**
 * transcript-document.test.ts -- words drawn as a document, as an Inbox
 * item's are: a link alone in its paragraph stands as the card of what it
 * names, the same link in a sentence stays its chip, pictures written next
 * to each other stand side by side, and an item's own pictures are read
 * through the Inbox and drawn with their captions. Words drawn as a
 * transcript keep none of it. Synthetic ids, repository, and pictures.
 */

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const PAGE_ID = "3c4d5e6f-0000-4000-8000-000000000001";
const ITEM_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const OTHER_ITEM_ID = "a1b2c3d4-0000-4000-8000-000000000002";
const BEFORE = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const AFTER = "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02";
const REPOSITORY = "acme/relay";
const COMMIT = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";
const PULL_REQUEST = `https://github.com/${REPOSITORY}/pull/42`;
const LINES = `https://github.com/${REPOSITORY}/blob/${COMMIT}/apps/web/rollout-store.ts#L3-L5`;
const PAGE = linkOf({ kind: LINK_PLACE.PAGE, planId: TASK_ID, pageId: PAGE_ID }, "acme");
const LINEAR = "https://linear.app/acme/issue/LUKE-142";

/** A picture's bytes as the Inbox holds them once read. */
const HELD: InboxImage = { url: "data:image/png;base64,iVBORw0KGgo=" };

/** An item's own picture's address, under its task. */
function pictureOf(itemId: string, attachmentId: string): string {
  return inboxAttachmentAddress(
    { kind: LINK_PLACE.INBOX_ITEM, planId: TASK_ID, itemId },
    attachmentId,
    "acme",
  );
}

/** The words of a message with a link in a sentence and three standing alone. */
const LINKS = [
  `The fix is in [the pull request](${PULL_REQUEST}).`,
  PULL_REQUEST,
  `[@The funnel](${PAGE})`,
  LINES,
  LINEAR,
].join("\n\n");

/** The words of a message with a before and an after written next to each other. */
const PAIR = [
  "Here is the change:",
  `![Before](${pictureOf(ITEM_ID, BEFORE)} "Before") ![After](${pictureOf(ITEM_ID, AFTER)} "After")`,
].join("\n\n");

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

// A message is drawn once the parser has landed, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(markdownHtmlParserLanded));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const told: (AnyAct | OpenedLink)[] = [];

beforeEach(() => {
  told.length = 0;
  fakeAppPlatform(DESKTOP_LINKS);
  fakeAppBridge({});
  fakeActPort(openingLinks((link) => told.push(link)));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** What a pane hands its words: the cards' doors over the task's repository, and the item's pictures as `images` holds them, each asked for kept. */
function inPane(
  children: ReactNode,
  images: ReadonlyMap<string, InboxImage> = new Map(),
  asked: string[] = [],
  read: { path: string; ref: string | undefined }[] = [],
): ReactNode {
  const doors = {
    code: {
      repository: REPOSITORY,
      // A file's lines are held unread, so a code card stands as it reads them.
      readFile: (window: TaskFileRequest) => {
        read.push({ path: window.path, ref: window.ref });
        return new Promise<never>(() => undefined);
      },
      onOpenFile: () => undefined,
    },
  };
  return createElement(InboxPictures, {
    itemId: ITEM_ID,
    control: {
      images,
      onImage: (itemId: string, attachmentId: string) => asked.push(`${itemId}/${attachmentId}`),
      onRetryImage: () => undefined,
    },
    children: createElement(LoneLinkCards, { doors, children }),
  });
}

/** The node drawn into a fresh container. */
function drawn(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

/** Each lone link's card drawn: its kind and what it says. */
function cards(container: HTMLElement): [string | undefined, string][] {
  return [...container.querySelectorAll<HTMLElement>(".lone-link-card")].map((card) => [
    card.dataset.loneLink,
    card.querySelector("[data-inbox-code]")?.getAttribute("aria-label") ??
      card.querySelector(".luke-list-row-title")?.textContent ??
      "",
  ]);
}

/** Each chip drawn in a paragraph of words, by the name it says. */
function chipsInWords(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("p [data-mention-ref]")].map(
    (chip) => chip.querySelector(".luke-inline-ref-label")?.textContent ?? null,
  );
}

test("drawn as a document, a link alone in its paragraph is its card, a pull request's row, a page's row, or the lines at a commit as the Code tab's card, while the same link in a sentence and a lone link that earns no card stay chips", () => {
  const read: { path: string; ref: string | undefined }[] = [];
  const container = drawn(
    inPane(createElement(TranscriptWords, { text: LINKS, asDocument: true }), new Map(), [], read),
  );

  assert.deepEqual(cards(container), [
    ["pull-request", "#42"],
    ["page", "The funnel"],
    ["code", "apps/web/rollout-store.ts, Lines 3–5"],
  ]);
  // The pull request named in a sentence, and the issue standing alone, which earns no card.
  const chips = chipsInWords(container);
  assert.equal(chips.length, 2);
  assert.equal(chips[0], "the pull request");
  // The code card reads its lines at the link's commit, as an Inbox code block does.
  assert.deepEqual(read, [{ path: "apps/web/rollout-store.ts", ref: COMMIT }]);

  const pullRequest = container.querySelector<HTMLButtonElement>(
    '[data-lone-link="pull-request"] button',
  );
  assert.ok(pullRequest, "the pull request's row is pressed");
  act(() => pullRequest.click());
  assert.deepEqual(told.at(-1), { kind: ACT_KIND.GITHUB_OPEN, payload: { url: PULL_REQUEST } });
});

test("a typed message drawn as a document draws its lone links as cards too", () => {
  const container = drawn(inPane(createElement(SentWords, { text: LINKS, asDocument: true })));

  assert.deepEqual(
    cards(container).map(([kind]) => kind),
    ["pull-request", "page", "code"],
  );
});

test("drawn as a document, pictures written next to each other stand side by side in one row, each with its caption, asked for as it is drawn and opened over the window by a press", () => {
  const asked: string[] = [];
  const reading = drawn(
    inPane(createElement(TranscriptWords, { text: PAIR, asDocument: true }), new Map(), asked),
  );
  assert.deepEqual(asked, [`${ITEM_ID}/${BEFORE}`, `${ITEM_ID}/${AFTER}`]);
  assert.equal(reading.querySelectorAll(".transcript-pictures .picture-pending").length, 2);

  const held = new Map([
    [BEFORE, HELD],
    [AFTER, HELD],
  ]);
  const container = drawn(
    inPane(createElement(TranscriptWords, { text: PAIR, asDocument: true }), held),
  );
  const rows = [...container.querySelectorAll(".transcript-pictures")];
  assert.equal(rows.length, 1, "the two pictures stand in one row");
  assert.deepEqual(
    [...(rows[0]?.querySelectorAll("img") ?? [])].map((image) => image.alt),
    ["Before", "After"],
  );
  assert.deepEqual(
    [...(rows[0]?.querySelectorAll(".picture-caption") ?? [])].map((said) => said.textContent),
    ["Before", "After"],
  );
  const press = container.querySelector<HTMLButtonElement>('button[aria-label="Enlarge After"]');
  assert.ok(press, "a picture is pressed to enlarge it");
  act(() => press.click());
  assert.equal(
    document.querySelector<HTMLImageElement>(".attachment-viewer-image")?.alt,
    "After.png",
  );
});

test("a picture of another item stands as its link and is never asked for", () => {
  const asked: string[] = [];
  const text = `![Another's](${pictureOf(OTHER_ITEM_ID, BEFORE)})`;
  const container = drawn(
    inPane(createElement(TranscriptWords, { text, asDocument: true }), new Map(), asked),
  );

  assert.deepEqual(asked, []);
  assert.equal(container.querySelector("img"), null);
  assert.equal(
    container.querySelector(".text-link-inert, .luke-text-link, a")?.textContent,
    "Another's",
  );
});

test("words drawn as a transcript, as the transcript and the plan draw them, keep a lone link as its chip and their pictures in their paragraph", () => {
  const container = drawn(
    inPane(createElement(TranscriptWords, { text: [LINKS, PAIR].join("\n\n") })),
  );

  assert.equal(container.querySelectorAll(".lone-link-card").length, 0);
  assert.equal(container.querySelectorAll(".transcript-pictures").length, 0);
  // Every link, in a sentence or alone, stays a chip in its paragraph.
  assert.equal(chipsInWords(container).length, 5);
});
