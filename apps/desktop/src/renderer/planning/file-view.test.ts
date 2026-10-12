// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_FILE_REFUSAL, PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import type { PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { FileTreeProps } from "../file-tree/contract";
import { FileView } from "./file-view";
import type { OpenFile } from "./use-side-panel";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const REPOSITORY = "acme/relay";
const FILE = "apps/web/server/plans-app.ts";

/** What the tree bundle was handed and asked, as a stand-in for the bundle the window loads. */
interface TreeSeen {
  props: FileTreeProps | undefined;
  reveals: string[];
}

const tree: TreeSeen = { props: undefined, reveals: [] };

// The bundle already loaded, as it is once a tree has been shown in this window.
window.lukeFileTree = {
  mount: (_host, props) => {
    tree.props = props;
    return {
      reveal: (path, options) =>
        tree.reveals.push(`${path}${options.folder ? "/" : ""}${options.focus ? " focused" : ""}`),
      unmount: () => undefined,
    };
  },
};

const roots: Root[] = [];

beforeEach(() => {
  tree.props = undefined;
  tree.reveals = [];
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Each folder's listing as the service answers it, by path. */
const FOLDERS = new Map<string, PlanningTreeAnswer>([
  [
    "apps/web",
    {
      folder: {
        path: "apps/web",
        repository: REPOSITORY,
        branch: "main",
        entries: [
          { name: "server", kind: PLAN_TREE_ENTRY.FOLDER },
          { name: "README.md", kind: PLAN_TREE_ENTRY.FILE },
          { name: "package.json", kind: PLAN_TREE_ENTRY.FILE },
          { name: "lib", kind: PLAN_TREE_ENTRY.FOLDER },
        ],
        truncated: false,
      },
    },
  ],
  ["", { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE }],
  ["flaky", { refusal: PLAN_FILE_REFUSAL.UNAVAILABLE }],
]);

/** The view over a file, its tree closed, every folder listed and every file browsed to written down. */
function mounted() {
  const listed: string[] = [];
  const browsed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  function View({ file }: { file: OpenFile }) {
    const [treeOpen, setTreeOpen] = useState(false);
    return createElement(FileView, {
      planId: PLAN,
      repository: REPOSITORY,
      file,
      snippet: undefined,
      readFile: (window) =>
        Promise.resolve({
          file: { ...window, repository: REPOSITORY, branch: "main", lineCount: 1, lines: [[]] },
        }),
      readFolder: (path) => {
        listed.push(path);
        return Promise.resolve(FOLDERS.get(path) ?? { failure: "unanswered" as const });
      },
      openGitHub: () => undefined,
      treeOpen,
      onToggleTree: () => setTreeOpen((was) => !was),
      onBrowse: (path, newTab) => browsed.push(newTab ? `${path} in a new tab` : path),
    });
  }
  const draw = async (path: string) => {
    await act(async () => {
      root.render(createElement(View, { file: { path, range: undefined, opened: 1 } }));
      await Promise.resolve();
    });
  };
  const press = async (element: Element | null | undefined) => {
    assert.ok(element instanceof HTMLElement, "nothing to press");
    await act(async () => {
      element.click();
      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
    });
  };
  return { container, listed, browsed, draw, press };
}

test("the heading's breadcrumbs name the repository, each folder, and the file; a folder's press opens the tree and reveals the folder there, and the file shown is revealed as it changes", async () => {
  const view = mounted();
  await view.draw(FILE);

  const crumbs = [...view.container.querySelectorAll(".file-breadcrumb")];
  assert.deepEqual(
    crumbs.map((crumb) => crumb.textContent),
    [REPOSITORY, "apps", "web", "server", "plans-app.ts"],
  );
  assert.equal(view.container.querySelector(".file-tree-pane"), null, "the tree starts closed");

  await view.press(crumbs[2]);
  assert.ok(view.container.querySelector(".file-tree-pane"), "the press opened the tree");
  assert.deepEqual(tree.reveals, [FILE, "apps/web/ focused"]);

  await view.press(view.container.querySelector(".file-breadcrumb"));
  await view.draw("apps/web/README.md");
  assert.deepEqual(tree.reveals, [FILE, "apps/web/ focused", "/ focused", "apps/web/README.md"]);
});

test("a chevron lists its folder's entries, folders first, a file chosen there browsed to in the tab and a folder revealed in the tree; a folder is listed once however often it is asked", async () => {
  const view = mounted();
  await view.draw(FILE);
  const chevron = () => view.container.querySelector('[aria-label="Entries of apps/web"]');

  await view.press(chevron());
  const items = () => [...document.querySelectorAll('[role="menuitem"]')];
  assert.deepEqual(
    items().map((item) => item.textContent),
    ["lib/", "server/", "package.json", "README.md"],
  );
  await view.press(items()[2]);
  assert.deepEqual(view.browsed, ["apps/web/package.json"]);

  await view.press(chevron());
  await view.press(items()[0]);
  assert.ok(view.container.querySelector(".file-tree-pane"), "the folder opened the tree");
  assert.ok(tree.reveals.includes("apps/web/lib/ focused"));
  assert.equal(view.listed.filter((path) => path === "apps/web").length, 1);
});

test("the tree hears a folder in the File tab's words, a refusal saying whether listing again may help, and a file it opens is browsed to", async () => {
  const view = mounted();
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));
  const props = tree.props;
  assert.ok(props, "the tree was mounted");

  assert.deepEqual(await props.readFolder(""), {
    notice: "The Luke GitHub App no longer reaches this plan's repository.",
    retry: false,
  });
  assert.deepEqual(await props.readFolder("flaky"), {
    notice: "GitHub could not be read just now.",
    retry: true,
  });
  assert.deepEqual(await props.readFolder("gone"), {
    notice: "The files could not be read.",
    retry: true,
  });
  assert.deepEqual((await props.readFolder("apps/web")).valueOf(), {
    entries: [
      { name: "server", folder: true },
      { name: "README.md", folder: false },
      { name: "package.json", folder: false },
      { name: "lib", folder: true },
    ],
    truncated: false,
  });
  props.onOpen("apps/web/README.md", true);
  assert.deepEqual(view.browsed, ["apps/web/README.md in a new tab"]);
  assert.deepEqual(
    view.listed.filter((path) => path === "flaky"),
    ["flaky"],
  );
  await props.readFolder("flaky");
  assert.deepEqual(
    view.listed.filter((path) => path === "flaky"),
    ["flaky", "flaky"],
    "a refusal is not kept, so the next ask lists again",
  );
});
