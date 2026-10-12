// @vitest-environment jsdom

import assert from "node:assert/strict";
import { FileTree } from "@pierre/trees";
import { onTestFinished, test } from "vitest";
import type { FolderEntry } from "./contract";
import { browseFolders } from "./folder-browser";

/** A repository by folder: each folder's entries, the root under the empty path. */
const REPOSITORY = new Map<string, readonly FolderEntry[]>([
  [
    "",
    [
      { name: "docs", folder: true },
      { name: "src", folder: true },
      { name: "README.md", folder: false },
    ],
  ],
  ["docs", [{ name: "STYLE.md", folder: false }]],
  [
    "src",
    [
      { name: "app", folder: true },
      { name: "index.ts", folder: false },
    ],
  ],
  ["src/app", [{ name: "main.ts", folder: false }]],
]);

/** Pierre's tree over a repository read as `answer` answers, every folder asked written down. */
function browsing(answer: (path: string) => readonly FolderEntry[] | undefined) {
  const asked: string[] = [];
  const tree = new FileTree({ paths: [], flattenEmptyDirectories: true });
  const host = document.createElement("div");
  document.body.append(host);
  tree.render({ containerWrapper: host });
  const browser = browseFolders(tree, (path) => {
    asked.push(path);
    return Promise.resolve(answer(path));
  });
  onTestFinished(() => {
    browser.dispose();
    tree.cleanUp();
    host.remove();
  });
  // Let the reads a change started land, and the reads their entries start.
  const settled = async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  };
  /** The rows the tree draws open now, each by its depth and name, a row folders share by their path. */
  const rows = () =>
    tree
      .getVisibleRows(0, tree.getVisibleCount())
      .map(
        (row) =>
          `${"  ".repeat(row.depth)}${row.isFlattened ? row.path.slice(0, -1) : row.name}${row.kind === "directory" ? "/" : ""}`,
      );
  return { tree, browser, asked, settled, rows };
}

test("revealing a file lists the root and each folder above it, opens them, and marks the file; a folder opened by hand is listed the first time alone", async () => {
  const { tree, browser, asked, settled, rows } = browsing((path) => REPOSITORY.get(path));

  await browser.reveal("src/app/main.ts", { folder: false, focus: false });

  assert.deepEqual(asked, ["", "src", "src/app"]);
  assert.deepEqual(rows(), ["docs/", "src/", "  app/", "    main.ts", "  index.ts", "README.md"]);
  assert.deepEqual(tree.getSelectedPaths(), ["src/app/main.ts"]);

  const docs = tree.getItem("docs/");
  assert.ok(docs !== null && "expand" in docs, "docs is a folder");
  docs.expand();
  await settled();
  docs.collapse();
  docs.expand();
  await settled();

  assert.deepEqual(asked, ["", "src", "src/app", "docs"]);
  assert.deepEqual(rows().slice(0, 2), ["docs/", "  STYLE.md"]);
});

test("revealing another file marks it alone, though a ⌘-press had added to the marks; revealing a folder opens it, and the root its first row", async () => {
  const { tree, browser, rows } = browsing((path) => REPOSITORY.get(path));
  await browser.reveal("src/app/main.ts", { folder: false, focus: false });
  tree.getItem("README.md")?.select();

  await browser.reveal("src/index.ts", { folder: false, focus: false });
  assert.deepEqual(tree.getSelectedPaths(), ["src/index.ts"]);

  await browser.reveal("docs", { folder: true, focus: true });
  assert.deepEqual(rows().slice(0, 2), ["docs/", "  STYLE.md"]);
  assert.equal(tree.getFocusedPath(), "docs/");

  await browser.reveal("src/index.ts", { folder: false, focus: true });
  await browser.reveal("", { folder: true, focus: true });
  assert.equal(tree.getFocusedPath(), "docs/", "the root takes the keyboard to its first row");
});

test("a folder that could not be read closes, and is read again when it is opened again", async () => {
  let failing = true;
  const { tree, browser, asked, settled, rows } = browsing((path) =>
    path === "docs" && failing ? undefined : REPOSITORY.get(path),
  );
  await browser.reveal("README.md", { folder: false, focus: false });

  const docs = tree.getItem("docs/");
  assert.ok(docs !== null && "expand" in docs, "docs is a folder");
  docs.expand();
  await settled();
  assert.equal(docs.isExpanded(), false);
  assert.deepEqual(asked, ["", "docs"]);

  failing = false;
  docs.expand();
  await settled();
  assert.deepEqual(asked, ["", "docs", "docs"]);
  assert.deepEqual(rows().slice(0, 2), ["docs/", "  STYLE.md"]);
});

test("a folder holding one folder alone opens that one too, so the row the two share reads as opened and lists what the inner one holds", async () => {
  const nested = new Map<string, readonly FolderEntry[]>([
    ["", [{ name: "lib", folder: true }]],
    ["lib", [{ name: "core", folder: true }]],
    ["lib/core", [{ name: "store.ts", folder: false }]],
  ]);
  const { tree, asked, settled, rows } = browsing((path) => nested.get(path));
  await settled();

  const lib = tree.getItem("lib/");
  assert.ok(lib !== null && "expand" in lib, "lib is a folder");
  lib.expand();
  await settled();

  assert.deepEqual(asked, ["", "lib", "lib/core"]);
  assert.deepEqual(rows(), ["lib/core/", "  store.ts"]);
});
