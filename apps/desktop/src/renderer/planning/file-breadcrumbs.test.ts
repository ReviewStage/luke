// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import type { FolderListing } from "../file-tree/contract";
import { FileViewBar } from "./file-view";

/**
 * A File or Changes tab's path in its bar, however little room the bar
 * leaves it: the folders fold into one "…" from the repository's side,
 * then the repository, so every crumb drawn is drawn whole, the file's
 * always among them, and the "…" names what it stands for and opens the
 * tree the last of them would. jsdom lays nothing out, so the window's
 * layout is stood in for at its boundary: each crumb as wide as its words,
 * at eight pixels a letter and twenty for its chevron and padding, the
 * bar's buttons a hundred, and the bar as wide as the test says.
 */

const REPOSITORY = "acme/relay";
const PATH = "packages/db/src/members/invites/accept-invite.ts";

/** How wide each other part of the bar stands: its buttons, and the commit a file is read at. */
const WIDTHS = [
  [".file-view-actions", 100],
  [".file-view-commit", 120],
] as const;

/** How wide the test lays the bar. */
let barWidth = 0;
const roots: Root[] = [];

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const width = this.matches("li")
      ? (this.textContent ?? "").length * 8 + 20
      : (WIDTHS.find(([selector]) => this.matches(selector))?.[1] ?? 0);
    return new DOMRect(0, 0, width, 24);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches(".file-view-bar") ? barWidth : 0;
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Draws a File tab's bar over the path, the bar as wide as `width`, answering the crumbs as drawn. */
function barAt(width: number) {
  barWidth = width;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  // The bar drawn again with what stands beside the path: none, or the commit the file is read at.
  const draw = (commit: string | undefined) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(FileViewBar, {
            path: {
              path: PATH,
              browse: {
                repository: REPOSITORY,
                listFolder: () => new Promise<FolderListing>(() => undefined),
                onOpen: () => undefined,
              },
            },
            beside:
              commit === undefined
                ? null
                : createElement("span", { className: "file-view-commit" }, commit),
            onGitHub: undefined,
            menu: null,
          }),
        ),
      ),
    );
  draw(undefined);
  const nav = container.querySelector('nav[aria-label="Path"]') ?? assert.fail("the path is drawn");
  return {
    /** Each crumb drawn and in reach, by its name. */
    crumbs: () =>
      [...nav.querySelectorAll<HTMLButtonElement>("button")]
        .filter((button) => button.closest("[inert]") === null)
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    /** The bar laid again at another width, as the window reports a resize. */
    resize: (next: number) => {
      barWidth = next;
      act(() => relayout());
    },
    /** Presses the crumb the name names. */
    press: (name: string) => {
      const button =
        [...nav.querySelectorAll<HTMLButtonElement>("button")].find(
          (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
        ) ?? assert.fail(`a crumb named ${name}`);
      act(() => button.click());
    },
    /** The bar drawn again with the commit the file is read at beside its path. */
    readAt: (commit: string) => draw(commit),
  };
}

test("a bar with room for the whole path draws every crumb", () => {
  const bar = barAt(700);
  assert.deepEqual(bar.crumbs(), [
    REPOSITORY,
    "packages",
    "db",
    "src",
    "members",
    "invites",
    "accept-invite.ts",
  ]);
});

test("a narrower bar folds the folders into one crumb from the repository's side, as few as let the rest stand whole", () => {
  const bar = barAt(480);
  assert.deepEqual(bar.crumbs(), [
    REPOSITORY,
    "Folders: packages/db/src/members",
    "invites",
    "accept-invite.ts",
  ]);
});

test("a bar too narrow for the repository beside the file folds the repository too, and the folded crumb opens the tree where its last folder stands", () => {
  const bar = barAt(300);
  const folded = "Folders: acme/relay/packages/db/src/members/invites";
  assert.deepEqual(bar.crumbs(), [folded, "accept-invite.ts"]);

  bar.press(folded);
  assert.ok(document.querySelector('[role="dialog"][aria-label="packages/db/src/members"]'));
});

test("the crumbs fold and unfold again as the bar is laid narrower and wider", () => {
  const bar = barAt(700);
  bar.resize(480);
  assert.equal(bar.crumbs().length, 4);
  bar.resize(700);
  assert.equal(bar.crumbs().length, 7);
});

test("a repository too long for the room left it beside the folded folders and the file is cut short rather than folded, while that leaves it room to be read", () => {
  const bar = barAt(350);
  assert.deepEqual(bar.crumbs(), [
    REPOSITORY,
    "Folders: packages/db/src/members/invites",
    "accept-invite.ts",
  ]);
});

test("a commit drawn beside the path folds the crumbs it leaves no room for, the bar's own width unchanged", () => {
  const bar = barAt(700);
  bar.readAt("3f1c5a7");
  assert.deepEqual(bar.crumbs(), [
    REPOSITORY,
    "Folders: packages/db",
    "src",
    "members",
    "invites",
    "accept-invite.ts",
  ]);
});

test("a crumb's tree is let go once the bar folds its crumbs again, its own perhaps among them", () => {
  const bar = barAt(700);
  bar.press("src");
  assert.ok(document.querySelector('[role="dialog"][aria-label="packages/db"]'));

  bar.resize(480);
  assert.equal(document.querySelector('[role="dialog"]'), null);
});
