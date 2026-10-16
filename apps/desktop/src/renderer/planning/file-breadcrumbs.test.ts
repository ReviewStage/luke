// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { layContainersAt, shown } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import type { FolderListing } from "../file-tree/contract";
import { FileViewBar } from "./file-view";

/**
 * A File or Changes tab's path in its bar, however narrow the bar, giving
 * way in the stylesheet alone: on a bar narrower than 520px the
 * folders between the repository and the file's own folder stand as one
 * "…", the repository, the file's own folder, and the file drawn beside it;
 * on one narrower than 300px the repository and every folder stand as one
 * "…", the file alone after it; each "…" names what it stands for and opens
 * the tree the last of them would; and on a wider bar every crumb is drawn.
 * jsdom lays nothing out, so a width is the stylesheets' `file-bar`
 * container query resolved for a bar that wide (`#testing/container-width`).
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

/** Draws a File tab's bar over `path`, its stylesheets laid for a bar `width` pixels wide. */
function barAt(width: number, path = PATH) {
  layContainersAt({ "file-bar": width });
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
    /** Each crumb drawn, by its name. */
    crumbs: () => buttons().filter(shown).map(named),
    /** Presses the crumb the name names. */
    press: (name: string) => {
      const button =
        buttons().find((each) => named(each) === name) ?? assert.fail(`a crumb named ${name}`);
      act(() => button.click());
    },
  };
}

test("a bar 520px wide or wider draws every crumb of the path, and no “…”", () => {
  assert.deepEqual(barAt(520).crumbs(), [
    REPOSITORY,
    "packages",
    "db",
    "src",
    "members",
    "invites",
    "accept-invite.ts",
  ]);
});

test("a bar narrower than 520px draws the folders between the repository and the file's own folder as one “…” naming them", () => {
  assert.deepEqual(barAt(519).crumbs(), [
    REPOSITORY,
    "Folders: packages/db/src/members",
    "invites",
    "accept-invite.ts",
  ]);
});

test("the “…” opens the tree where the last folder it stands for stands", () => {
  const bar = barAt(300);
  bar.press("Folders: packages/db/src/members");
  assert.ok(document.querySelector('[role="dialog"][aria-label="packages/db/src"]'));
});

test("a path with a single folder between the repository and the file's own folder draws no “…” on a bar 300px wide or wider", () => {
  assert.deepEqual(barAt(300, "src/members/invite.ts").crumbs(), [
    REPOSITORY,
    "src",
    "members",
    "invite.ts",
  ]);
});

test("a bar narrower than 300px draws the repository and every folder as one “…”, the file alone after it, opening the tree where the file's own folder stands", () => {
  const bar = barAt(299);
  assert.deepEqual(bar.crumbs(), [
    "Folders: acme/relay/packages/db/src/members/invites",
    "accept-invite.ts",
  ]);
  bar.press("Folders: acme/relay/packages/db/src/members/invites");
  assert.ok(document.querySelector('[role="dialog"][aria-label="packages/db/src/members"]'));
});

test("a file at the repository's root keeps the repository's crumb however narrow the bar", () => {
  assert.deepEqual(barAt(299, "README.md").crumbs(), [REPOSITORY, "README.md"]);
});

test("a path six folders deep or deeper draws its middle folders as the one “…” on a wide bar too", () => {
  assert.deepEqual(barAt(700, "a/b/c/d/e/f/deep.ts").crumbs(), [
    REPOSITORY,
    "Folders: a/b/c/d/e",
    "f",
    "deep.ts",
  ]);
});

test("a crumb's tree goes once the bar is resized, its crumb perhaps folded out of sight", () => {
  const bar = barAt(700);
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
