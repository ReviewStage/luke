// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import type { FolderListing } from "../file-tree/contract.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { relayout } from "../testing/resize-observer.js";
import { FileBreadcrumbs } from "./file-breadcrumbs.js";
import { FileViewBar } from "./file-view.js";

/**
 * A File tab's path in its bar: each "…" names the folders it
 * stands for and opens the tree the last of them would, and a crumb's tree
 * goes once the bar is resized.
 */

const REPOSITORY = "acme/relay";
const PATH = "packages/db/src/members/invites/accept-invite.ts";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** Draws a File tab's bar over `path`. */
function barOver(path = PATH) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(FileViewBar, {
          history: { canGoBack: false, canGoForward: false, onStep: () => undefined },
          lead: createElement(FileBreadcrumbs, {
            repository: REPOSITORY,
            path,
            listFolder: () => new Promise<FolderListing>(() => undefined),
            onOpen: () => undefined,
          }),
          github: undefined,
          menu: null,
        }),
      ),
    ),
  );
  const nav = container.querySelector('nav[aria-label="Path"]') ?? assert.fail("the path is drawn");
  const buttons = () => [...nav.querySelectorAll<HTMLButtonElement>("button")];
  const named = (button: HTMLButtonElement) =>
    button.getAttribute("aria-label") ?? button.textContent;
  return {
    /** Presses the crumb the name names. */
    press: (name: string) => {
      const button =
        buttons().find((each) => named(each) === name) ?? assert.fail(`a crumb named ${name}`);
      act(() => button.click());
    },
  };
}

test("the “…” opens the tree where the last folder it stands for stands", () => {
  const bar = barOver();
  bar.press("Folders: packages/db/src/members");
  assert.ok(document.querySelector('[role="dialog"][aria-label="packages/db/src"]'));
});

test("the “…” standing for the repository and every folder opens the tree where the file's own folder stands", () => {
  const bar = barOver();
  bar.press("Folders: acme/relay/packages/db/src/members/invites");
  assert.ok(document.querySelector('[role="dialog"][aria-label="packages/db/src/members"]'));
});

/** A press landing on `target`, as the pointer's goes down. */
function pressOn(target: Element) {
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

test("a crumb's tree hangs under the crumb pressed, from its leading edge, bounded by the room under it", () => {
  // Note that jsdom lays out nothing, so the crumb stands where a bar would put it, and the layer is laid in the page.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.textContent === "src" && this.tagName === "BUTTON"
      ? DOMRect.fromRect({ x: 140, y: 12, width: 40, height: 24 })
      : DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });
  const bar = barOver();
  bar.press("src");
  const tree = document.querySelector('[role="dialog"]') ?? assert.fail("the tree is open");
  const layer = tree.parentElement ?? assert.fail("the tree hangs in a layer");
  assert.equal(layer.dataset.side, "below");
  assert.equal(layer.style.left, "140px");
  assert.equal(layer.style.top, "36px");
  // The room under the crumb in a 768px window, less the gap and the margin kept from its edge.
  assert.equal(layer.style.getPropertyValue("--luke-popover-room"), `${768 - 36 - 4 - 8}px`);
});

test("a crumb's tree closes on a press outside it, and stays open for a press inside it", () => {
  const bar = barOver();
  bar.press("src");
  const tree = document.querySelector('[role="dialog"]') ?? assert.fail("the tree is open");
  pressOn(tree);
  const keptOpen = document.querySelector('[role="dialog"]') !== null;
  pressOn(document.body);
  assert.equal(keptOpen, true, "a press in the tree leaves it open");
  assert.equal(
    document.querySelector('[role="dialog"]') !== null,
    false,
    "a press outside closes it",
  );
});

test("a crumb's tree goes once the bar is resized, its crumb perhaps folded out of sight", () => {
  const bar = barOver();
  bar.press("src");
  assert.ok(document.querySelector('[role="dialog"]'));
  act(() => relayout());
  act(() => relayout());
  assert.equal(
    document.querySelector('[role="dialog"]') !== null,
    false,
    "the tree stands no more",
  );
});
