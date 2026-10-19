// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { FolderListing } from "@luke/panel/file-tree/contract";
import { FileViewBar } from "@luke/panel/tasks/file-view";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { relayout } from "@luke/panel/testing/resize-observer";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";

/**
 * A File or Changes tab's path in its bar: each "…" names the folders it
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
          path: {
            path,
            browse: {
              repository: REPOSITORY,
              listFolder: () => new Promise<FolderListing>(() => undefined),
              onOpen: () => undefined,
            },
          },
          beside: null,
          onGitHub: undefined,
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
