// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { InboxCodeBlock } from "@luke/features/inbox-wire";
import type { TasksFileAnswer } from "@luke/features/tasks-view";
import { getSharedHighlighter } from "@pierre/diffs";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { preferredHighlighter } from "../diff-view/highlight-pool.js";
import { diffView } from "../diff-view/index.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { InboxCodeCard } from "./inbox-code-card.js";

/**
 * code-snippet.test.ts -- an inbox item's code drawn by the diff bundle in
 * its code card: numbered from where its lines sit in the file, the lines
 * named lit, under a header naming the file and its lines with the one Copy
 * and the file's opening. The real bundle draws in jsdom on the window's
 * own thread, since no worker text was built in.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Line 5 of `src/seats.ts` at a commit, as an Inbox item names it. */
const BLOCK: InboxCodeBlock = {
  type: "code",
  repo: "acme/relay",
  path: "src/seats.ts",
  sha: "0123456789abcdef0123456789abcdef01234567",
  startLine: 5,
  endLine: 5,
};

/** Lines 2 to 8 of the file, as the File tab's read answers them. */
const ANSWER: TasksFileAnswer = {
  file: {
    path: "src/seats.ts",
    repository: "acme/relay",
    branch: "main",
    firstLine: 2,
    lineCount: 20,
    lines: [2, 3, 4, 5, 6, 7, 8].map((line) => `line ${line}`),
  },
};

/** The item's code card, reading the file's lines through `ANSWER`. */
function inboxCode(): ReactElement {
  return createElement(InboxCodeCard, {
    block: BLOCK,
    code: {
      repository: "acme/relay",
      readFile: () => Promise.resolve(ANSWER),
      onOpenFile: () => {},
    },
  });
}

let bundles: SideBundles;
const roots: Root[] = [];

beforeAll(async () => {
  bundles = await Effect.runPromise(landedBundles({ diffView: () => Promise.resolve(diffView) }));
  // Note that the highlighter is loaded first, in the default themes and on the
  // highlighter the bundle picks, so Pierre draws the first card within the
  // test's own ticks rather than whenever a cold load lets it on a busy machine.
  await getSharedHighlighter({
    themes: ["github-dark-default", "github-light-default"],
    langs: ["typescript"],
    preferredHighlighter: preferredHighlighter(),
  });
});

beforeEach(() => handSettings());

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Lets the settings' read and Pierre's next frame land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
}

/** The element drawn over the landed bundle. */
async function draw(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), onSideBundles(bundles, element))));
  await settle();
  return container;
}

/** The shadow root Pierre drew a card's lines in. */
function drawnRoot(container: HTMLElement): ShadowRoot {
  const root = container.querySelector(".code-snippet diffs-container")?.shadowRoot;
  assert.ok(root, "the lines are drawn by the diff bundle");
  return root;
}

/** The numbers of the rows of code drawn, in order, those matching `selector`. */
function drawnLines(container: HTMLElement, selector = "[data-line]"): number[] {
  return [...drawnRoot(container).querySelectorAll(selector)].map((row) =>
    Number(row.getAttribute("data-line")),
  );
}

/** The lines lit. */
function litLines(container: HTMLElement): number[] {
  return drawnLines(container, "[data-line][data-selected-line]");
}

test("an inbox item's code draws the lines it read numbered from where they sit in the file, those it named lit", async () => {
  const container = await draw(inboxCode());
  assert.deepEqual(drawnLines(container), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(drawnRoot(container).querySelector('[data-line="5"]')?.textContent, "line 5");
  assert.deepEqual(litLines(container), [5]);
});

test("an inbox item's code is a code card: its header names the file and the lines, its one Copy copies the lines named, and the file's opening stands beside it", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const container = await draw(inboxCode());
  const head = container.querySelector(".luke-code-card figcaption") ?? assert.fail("no header");
  assert.match(head.textContent ?? "", /seats\.ts/u);
  assert.match(head.textContent ?? "", /Line 5/u);
  assert.ok(head.querySelector('button[aria-label="Open file"]'), "the file opens from the header");
  const copies = [...head.querySelectorAll<HTMLButtonElement>('button[aria-label^="Copy"]')];
  assert.deepEqual(
    copies.map((button) => button.getAttribute("aria-label")),
    ["Copy code"],
  );
  await act(async () => copies[0]?.click());
  assert.deepEqual(copied, ["line 5"]);
});
