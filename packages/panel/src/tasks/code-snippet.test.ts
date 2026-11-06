// @vitest-environment jsdom

import assert from "node:assert/strict";
import { getSharedHighlighter } from "@pierre/diffs";
import type { InboxCodeBlock } from "@repo/features/inbox-wire";
import type { TasksFileAnswer } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import type { SideBundles } from "../bundle-loader.js";
import { preferredHighlighter } from "../diff-view/highlight-pool.js";
import { diffView } from "../diff-view/index.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform } from "../testing/app-platform.js";
import { handSettings } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { InboxCodeCard } from "./inbox-code-card.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BLOCK: InboxCodeBlock = {
  type: "code",
  repo: "acme/relay",
  path: "src/seats.ts",
  sha: "0123456789abcdef0123456789abcdef01234567",
  startLine: 5,
  endLine: 5,
};

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

function inboxCode(): ReactElement {
  fakeActPort({ [ACT_KIND.TASKS_FILE]: () => Promise.resolve(ANSWER) });
  return createElement(InboxCodeCard, {
    block: BLOCK,
    code: {
      repository: "acme/relay",
      place: { taskId: "task-1" },
      onOpenFile: () => {},
    },
  });
}

let bundles: SideBundles;
const roots: Root[] = [];

beforeAll(async () => {
  bundles = await Effect.runPromise(landedBundles({ diffView: () => Promise.resolve(diffView) }));
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

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  });
}

async function draw(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), onSideBundles(bundles, element))));
  await settle();
  return container;
}

function drawnRoot(container: HTMLElement): ShadowRoot {
  const root = container.querySelector(".code-snippet diffs-container")?.shadowRoot;
  assert.ok(root, "the lines are drawn by the diff bundle");
  return root;
}

function drawnLines(container: HTMLElement, selector = "[data-line]"): number[] {
  return [...drawnRoot(container).querySelectorAll(selector)].map((row) =>
    Number(row.getAttribute("data-line")),
  );
}

function litLines(container: HTMLElement): number[] {
  return drawnLines(container, "[data-line][data-selected-line]");
}

test("an inbox item's code draws the lines it read numbered from where they sit in the file, those it named lit", async () => {
  const container = await draw(inboxCode());
  await vi.waitFor(() => assert.deepEqual(drawnLines(container), [2, 3, 4, 5, 6, 7, 8]));
  assert.equal(drawnRoot(container).querySelector('[data-line="5"]')?.textContent, "line 5");
  assert.deepEqual(litLines(container), [5]);
});

test("an inbox item's code is a code card: its header names the file and the lines, its one Copy copies the lines named, and the file's opening stands beside it", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  const container = await draw(inboxCode());
  const head = container.querySelector(".ui-code-card figcaption") ?? assert.fail("no header");
  assert.match(head.textContent ?? "", /seats\.ts/u);
  assert.match(head.textContent ?? "", /Line 5/u);
  assert.ok(head.querySelector('button[aria-label="Open file"]'), "the file opens from the header");
  const copies = () => [...head.querySelectorAll<HTMLButtonElement>('button[aria-label^="Copy"]')];
  await vi.waitFor(() =>
    assert.deepEqual(
      copies().map((button) => button.getAttribute("aria-label")),
      ["Copy code"],
    ),
  );
  await act(async () => copies()[0]?.click());
  assert.deepEqual(copied, ["line 5"]);
});
