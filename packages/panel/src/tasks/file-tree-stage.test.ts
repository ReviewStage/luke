// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Effect } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { type SideBundles, sideBundles } from "../bundle-loader.js";
import type { FolderListing } from "../file-tree/contract.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { landedBundles, onSideBundles } from "../testing/side-bundles.js";
import { FileBreadcrumbs } from "./file-breadcrumbs.js";
import { FileTreePane } from "./file-tree-pane.js";

/**
 * file-tree-stage.test.ts -- where a file tree stands is said by its host,
 * in `@luke/ui`'s lines, beside the tree the bundle draws: its root being
 * read, a root that could not be listed with Retry, which lists it again, a
 * search matching nothing, and a folder listed short of whole. The tree is
 * the bundle's own, Pierre drawing it in jsdom; synthetic paths.
 */

const REPOSITORY = "acme/relay";
const REFUSED = "The repository could not be listed.";

let bundles: SideBundles;
const roots: Root[] = [];

beforeAll(async () => {
  bundles = await Effect.runPromise(
    landedBundles({ fileTree: () => import("../file-tree/index.js").then((e) => e.fileTree) }),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws `element` over the landed tree bundle, and draws again whatever it is handed after. */
function draw(element: ReactElement) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const render = (next: ReactElement) =>
    act(() => root.render(onRegistry(registry, onSideBundles(bundles, next))));
  render(element);
  return { container, render };
}

/** Lets the listings answered land, which the tree and its host draw as they land, on no clock. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The words of every line the host says, alerts, notes and waits alike. */
function said(): string[] {
  return [
    ...document.querySelectorAll(".luke-note-line, .luke-failure-note, .luke-spinner-region"),
  ].map((line) => line.textContent ?? "");
}

/** The host the tree draws in, and whether it is shown. */
function hostShown(): boolean {
  const host = document.querySelector(".file-tree-host") ?? assert.fail("the host is mounted");
  return !host.hasAttribute("hidden");
}

test("a crumb's tree says its root is read, says why it could not be with Retry, and Retry lists it again", async () => {
  const answers = [Promise.withResolvers<FolderListing>(), Promise.withResolvers<FolderListing>()];
  let asked = 0;
  const { container } = draw(
    createElement(FileBreadcrumbs, {
      repository: REPOSITORY,
      path: "README.md",
      listFolder: (path) => {
        if (path !== "") return Promise.resolve({ entries: [], truncated: false });
        asked += 1;
        // Note that the tree lists its root once more as it draws it, which the last answer answers.
        return (answers[asked - 1] ?? answers[1])?.promise ?? assert.fail("the root is answered");
      },
      onOpen: () => undefined,
    }),
  );
  const crumb =
    [...container.querySelectorAll("button")].find(
      (button) => (button.getAttribute("aria-label") ?? button.textContent) === REPOSITORY,
    ) ?? assert.fail("the repository's crumb is drawn");
  act(() => crumb.click());
  await settle();
  assert.deepEqual(said(), ["Reading files"]);
  assert.equal(hostShown(), false);

  answers[0]?.resolve({ notice: REFUSED, retry: true });
  await settle();
  const alert = document.querySelector('[role="alert"]') ?? assert.fail("the refusal is an alert");
  assert.ok(alert.textContent?.includes(REFUSED), alert.textContent ?? "");
  const retry =
    [...alert.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry")) ??
    assert.fail("the refusal offers Retry");
  act(() => retry.click());
  await settle();
  assert.equal(asked, 2, "Retry lists the root again");
  assert.deepEqual(said(), ["Reading files"]);

  answers[1]?.resolve({ entries: [{ name: "README.md", folder: false }], truncated: false });
  await settle();
  assert.deepEqual(said(), []);
  assert.equal(hostShown(), true);
});

test("a tree bundle that failed to load says so with Retry, which imports it again and draws the tree", async () => {
  let online = false;
  const unloaded = sideBundles({
    fileTree: () =>
      online
        ? import("../file-tree/index.js").then((e) => e.fileTree)
        : Promise.reject(new Error("offline")),
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          unloaded,
          createElement(FileTreePane, {
            file: "README.md",
            listFolder: () =>
              Promise.resolve({
                entries: [{ name: "README.md", folder: false }],
                truncated: false,
              }),
            onOpen: () => undefined,
          }),
        ),
      ),
    ),
  );
  await settle();
  assert.deepEqual(said(), ["The files could not be shown.Retry"]);

  online = true;
  const retry =
    [...document.querySelectorAll("button")].find((button) => button.textContent === "Retry") ??
    assert.fail("the failure offers Retry");
  await act(async () => retry.click());
  await settle();
  assert.deepEqual(said(), []);
  assert.equal(hostShown(), true);
});

test("a root that listing again cannot mend says so with no Retry", async () => {
  draw(
    createElement(FileTreePane, {
      file: "README.md",
      listFolder: () => Promise.resolve({ notice: REFUSED, retry: false }),
      onOpen: () => undefined,
    }),
  );
  await settle();
  const alert = document.querySelector('[role="alert"]') ?? assert.fail("the refusal is an alert");
  assert.ok(alert.textContent?.includes(REFUSED), alert.textContent ?? "");
  assert.equal(alert.querySelector("button"), null);
});

test("the pane says under its rows that a folder was cut short, and in their place that a search matches nothing", async () => {
  const listFolder = () =>
    Promise.resolve<FolderListing>({
      entries: [{ name: "README.md", folder: false }],
      truncated: true,
    });
  const drawPane = (query: string) =>
    createElement(FileTreePane, {
      file: "README.md",
      listFolder,
      onOpen: () => undefined,
      search: { query, onQuery: () => undefined },
    });
  const pane = draw(drawPane(""));
  await settle();
  const cutLine =
    "Some folders hold more than the tree lists. Open them on GitHub to see the rest.";
  assert.deepEqual(said(), [cutLine]);
  assert.equal(hostShown(), true);

  pane.render(drawPane("zzz"));
  await settle();
  assert.deepEqual(said(), ["No files match", cutLine]);
  assert.equal(hostShown(), false);
});
