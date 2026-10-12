// @vitest-environment jsdom

import assert from "node:assert/strict";
import { onTestFinished, test } from "vitest";
import type { FolderListing } from "./contract";
import "./index";

/** The tree bundle mounted on a host of its own over the listings `answer` gives, every file opened written down. */
function mounted(answer: (path: string) => FolderListing) {
  const module = window.lukeFileTree;
  assert.ok(module, "the bundle sets its global");
  const host = document.createElement("div");
  document.body.append(host);
  const opened: string[] = [];
  const handle = module.mount(host, {
    readFolder: (path) => Promise.resolve(answer(path)),
    onOpen: (path, newTab) => opened.push(newTab ? `${path} in a new tab` : path),
  });
  onTestFinished(() => {
    handle.unmount();
    host.remove();
  });
  // Let a listing land and the tree draw what it added.
  const settled = async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  };
  const row = (path: string) => {
    const found = host
      .querySelector("file-tree-container")
      ?.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    assert.ok(found, `no row for ${path}`);
    return found;
  };
  return { host, handle, opened, settled, row };
}

const ROOT: FolderListing = {
  entries: [
    { name: "src", folder: true },
    { name: "README.md", folder: false },
  ],
  truncated: false,
};

test("a root that cannot be listed says why in the tree's place, and Try again lists it and draws the tree", async () => {
  let refusing = true;
  const tree = mounted((path) =>
    path === "" && refusing
      ? { notice: "GitHub could not be read just now.", retry: true }
      : path === ""
        ? ROOT
        : { entries: [], truncated: false },
  );
  await tree.settled();

  assert.equal(tree.host.textContent, "GitHub could not be read just now.Try again");
  refusing = false;
  tree.host.querySelector("button")?.click();
  await tree.settled();
  assert.ok(tree.row("README.md"));
});

test("a refusal that cannot pass offers nothing more", async () => {
  const tree = mounted(() => ({ notice: "This plan has no repository.", retry: false }));
  await tree.settled();

  assert.equal(tree.host.textContent, "This plan has no repository.");
  assert.equal(tree.host.querySelector("button"), null);
});

test("a press on a file opens it, in a tab of its own where ⌘ is held, and a press on a folder opens none", async () => {
  const tree = mounted((path) => (path === "" ? ROOT : { entries: [], truncated: false }));
  await tree.settled();

  tree.row("README.md").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  tree
    .row("README.md")
    .dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, metaKey: true }));
  tree.row("src/").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

  assert.deepEqual(tree.opened, ["README.md", "README.md in a new tab"]);
});

test("a file revealed before the root is listed is marked once the tree is drawn", async () => {
  const tree = mounted((path) =>
    path === "" ? ROOT : { entries: [{ name: "index.ts", folder: false }], truncated: false },
  );
  tree.handle.reveal("src/index.ts", { folder: false, focus: false });
  await tree.settled();

  assert.equal(tree.row("src/index.ts").getAttribute("aria-selected"), "true");
});

test("a folder listed short of whole says so under the tree, once", async () => {
  const tree = mounted((path) =>
    path === "" ? ROOT : { entries: [{ name: "index.ts", folder: false }], truncated: true },
  );
  tree.handle.reveal("src/index.ts", { folder: false, focus: false });
  await tree.settled();
  tree.handle.reveal("src/index.ts", { folder: false, focus: false });
  await tree.settled();

  assert.equal(
    [...tree.host.querySelectorAll(".file-tree-cut")].map((cut) => cut.textContent).join(),
    "Some folders hold more than the tree lists. Open them on GitHub to see the rest.",
  );
});
