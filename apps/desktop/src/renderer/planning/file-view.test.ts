// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_FILE_REFUSAL, PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import type { PlanCodeShowing, PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
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
  /** Each search the tree was asked for, and each narrowing, the whole repository written as "all". */
  narrowed: string[];
}

const tree: TreeSeen = { props: undefined, reveals: [], narrowed: [] };

// The bundle already loaded, as it is once a tree has been shown in this window.
window.lukeFileTree = {
  mount: (_host, props) => {
    tree.props = props;
    return {
      reveal: (path, options) =>
        tree.reveals.push(`${path}${options.folder ? "/" : ""}${options.focus ? " focused" : ""}`),
      search: (query) => tree.narrowed.push(`search "${query}"`),
      only: (paths) => tree.narrowed.push(`only ${paths?.join(", ") ?? "all"}`),
      within: (entries) =>
        tree.narrowed.push(
          `within ${entries.map((entry) => `${entry.name}${entry.folder ? "/" : ""}`).join(", ")}`,
        ),
      unmount: () => undefined,
    };
  },
};

const roots: Root[] = [];

beforeEach(() => {
  tree.props = undefined;
  tree.reveals = [];
  tree.narrowed = [];
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

/** The whole repository listed in one read, as the search asks it, or cut short. */
function wholeListing(truncated: boolean): PlanningTreeAnswer {
  return {
    folder: {
      path: "",
      repository: REPOSITORY,
      branch: "main",
      entries: [
        { name: "apps", kind: PLAN_TREE_ENTRY.FOLDER },
        { name: FILE, kind: PLAN_TREE_ENTRY.FILE },
      ],
      truncated,
    },
  };
}

/** A code Luke showed on the plan, of the file and repository given. */
function showing(path: string, repository: string): PlanCodeShowing {
  return {
    callId: `call-${path}`,
    turnId: "turn-1",
    shownAt: 0,
    code: { ref: { path }, repository, firstLine: 1, lineCount: 1, lines: [[]] },
  };
}

/** The view over a file, its tree closed, every folder listed and every file browsed to written down. */
function mounted(
  shownCode: readonly PlanCodeShowing[] = [],
  whole: () => Promise<PlanningTreeAnswer> = () => Promise.resolve(wholeListing(false)),
) {
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
      shownCode,
      readFile: (window) =>
        Promise.resolve({
          file: { ...window, repository: REPOSITORY, branch: "main", lineCount: 1, lines: [[]] },
        }),
      readFolder: (path) => {
        listed.push(path);
        return Promise.resolve(FOLDERS.get(path) ?? { failure: "unanswered" as const });
      },
      readWhole: whole,
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

test("the tree's search hands the tree what is typed, Escape clears it, and ⌘F in the pane takes the caret there; the filter narrows to the files Luke showed of this repository; a breadcrumb's folder lets go of both", async () => {
  const view = mounted([
    showing(FILE, REPOSITORY),
    showing("README.md", "acme/other"),
    showing("apps/web/README.md", REPOSITORY),
    showing(FILE, REPOSITORY),
  ]);
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));
  const field = view.container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
  assert.ok(field, "the tree has a search field");
  tree.narrowed = [];

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = (words: string) =>
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("plans");
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(field.value, "");
  assert.deepEqual(tree.narrowed, ['search "plans"', 'search ""']);

  const filter = view.container.querySelector('[aria-label="Only files Luke showed"]');
  await view.press(filter);
  assert.equal(filter?.getAttribute("aria-pressed"), "true");
  assert.equal(
    tree.narrowed.findLast((asked) => asked.startsWith("only")),
    `only ${FILE}, apps/web/README.md`,
  );

  const pane = view.container.querySelector(".file-tree-pane");
  act(() => {
    pane?.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }));
  });
  assert.equal(document.activeElement, field);

  type("web");
  await view.press(view.container.querySelectorAll(".file-breadcrumb")[1]);
  assert.equal(field.value, "");
  assert.equal(filter?.getAttribute("aria-pressed"), "false");
  assert.equal(
    tree.narrowed.findLast((asked) => asked.startsWith("search")),
    'search ""',
  );
  assert.equal(
    tree.narrowed.findLast((asked) => asked.startsWith("only")),
    "only all",
  );
  assert.equal(tree.reveals.at(-1), "apps/ focused");
});

test("the filter offers nothing while Luke has shown no file of the repository", async () => {
  const view = mounted([showing("README.md", "acme/other")]);
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));

  const filter = view.container.querySelector<HTMLButtonElement>(
    '[aria-label="Only files Luke showed"]',
  );
  assert.equal(filter?.disabled, true);
});

test("the first search reads the whole repository once and hands the tree its every entry; a listing cut short leaves the search on the folders opened, as the empty field says", async () => {
  const typeInto = (field: HTMLInputElement, words: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const fieldOf = (container: HTMLElement) => {
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
    assert.ok(field, "the tree has a search field");
    return field;
  };

  const whole = mounted();
  await whole.draw(FILE);
  await whole.press(whole.container.querySelector(".file-tree-toggle"));
  assert.equal(fieldOf(whole.container).placeholder, "Search files");
  typeInto(fieldOf(whole.container), "plans");
  await whole.draw(FILE);
  typeInto(fieldOf(whole.container), "plans-app");
  await whole.draw(FILE);
  assert.deepEqual(
    tree.narrowed.filter((asked) => asked.startsWith("within")),
    [`within apps/, ${FILE}`],
  );
  act(() => roots.pop()?.unmount());

  tree.narrowed = [];
  const cut = mounted([], () => Promise.resolve(wholeListing(true)));
  await cut.draw(FILE);
  await cut.press(cut.container.querySelector(".file-tree-toggle"));
  typeInto(fieldOf(cut.container), "plans");
  await cut.draw(FILE);
  typeInto(fieldOf(cut.container), "");
  await cut.draw(FILE);
  assert.equal(fieldOf(cut.container).placeholder, "Search opened folders");
  assert.deepEqual(
    tree.narrowed.filter((asked) => asked.startsWith("within")),
    [],
  );
});

test("a whole read that did not land leaves the search on the folders opened without asking again until the field is emptied and a new search begins", async () => {
  let asked = 0;
  const view = mounted([], () => {
    asked += 1;
    return Promise.resolve({ refusal: PLAN_FILE_REFUSAL.UNAVAILABLE });
  });
  await view.draw(FILE);
  await view.press(view.container.querySelector(".file-tree-toggle"));
  const field = view.container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
  assert.ok(field, "the tree has a search field");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = async (words: string) => {
    act(() => {
      setValue?.call(field, words);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await view.draw(FILE);
  };

  await type("plans");
  await type("plans-app");
  assert.equal(asked, 1, "the search standing asks once");
  await type("");
  await type("routes");
  assert.equal(asked, 2, "a new search asks again");
  assert.deepEqual(
    tree.narrowed.filter((narrowing) => narrowing.startsWith("within")),
    [],
  );
});
