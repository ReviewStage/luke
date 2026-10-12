// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PLAN_FILE_REFUSAL, PLAN_TREE_ENTRY } from "@sidecar/hosted/plan-wire";
import type { PlanningTreeAnswer } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import "../file-tree/index";
import { FileBreadcrumbs } from "./file-breadcrumbs";

/**
 * A File tab's breadcrumbs over the file tree bundle the window loads: a
 * crumb hangs the tree rooted at the folder it stands in, the tab's file
 * revealed in it; a folder opens in place, listed as it opens, and a file
 * opens in the tab; the tree stands as tall as its rows within the window,
 * and closes as a menu does.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const REPOSITORY = "acme/relay";
const FILE = "apps/web/plans-app.ts";

/** A folder's entries as the service lists them: a name ending in a slash is a folder. */
function folder(path: string, names: readonly string[]): PlanningTreeAnswer {
  return {
    folder: {
      path,
      repository: REPOSITORY,
      branch: "main",
      entries: names.map((name) =>
        name.endsWith("/")
          ? { name: name.slice(0, -1), kind: PLAN_TREE_ENTRY.FOLDER }
          : { name, kind: PLAN_TREE_ENTRY.FILE },
      ),
      truncated: false,
    },
  };
}

const FOLDERS = new Map<string, PlanningTreeAnswer>([
  ["", folder("", ["apps/", "README.md"])],
  ["apps", folder("apps", ["web/", "desktop/"])],
  ["apps/web", folder("apps/web", ["plans-app.ts", "routes/", "index.ts"])],
  ["apps/web/routes", folder("apps/web/routes", ["health.ts"])],
]);

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** The breadcrumbs over `path`, every folder listed and every file opened written down. */
function mounted(path: string, folders: ReadonlyMap<string, PlanningTreeAnswer> = FOLDERS) {
  const listed: string[] = [];
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(FileBreadcrumbs, {
        repository: REPOSITORY,
        path,
        listFolder: (asked) => {
          listed.push(asked);
          return Promise.resolve(folders.get(asked) ?? { failure: "unanswered" as const });
        },
        onOpen: (chosen, newTab) => opened.push(newTab ? `${chosen} in a new tab` : chosen),
      }),
    ),
  );
  // Lets the listings land and the tree draw what they added.
  const settle = () =>
    act(async () => {
      for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    });
  const crumb = (name: string) => {
    const found = [...container.querySelectorAll<HTMLButtonElement>(".file-breadcrumb")].find(
      (each) => each.textContent === name,
    );
    assert.ok(found, `no crumb ${name}`);
    return found;
  };
  const press = async (element: HTMLElement) => {
    act(() => element.click());
    await settle();
  };
  const box = () => document.querySelector<HTMLElement>(".file-crumb-tree");
  const shadow = () => box()?.querySelector("file-tree-container")?.shadowRoot;
  const rows = () =>
    [...(shadow()?.querySelectorAll<HTMLElement>("[data-item-path]") ?? [])].map(
      (row) =>
        `${row.dataset.itemPath ?? ""}${row.getAttribute("aria-selected") === "true" ? " (marked)" : ""}`,
    );
  const row = (path: string) => {
    const found = shadow()?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    assert.ok(found, `no row ${path}`);
    return found;
  };
  const click = async (element: HTMLElement, metaKey = false) => {
    act(() => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, metaKey }));
    });
    await settle();
  };
  return { listed, opened, settle, crumb, press, box, rows, row, click };
}

test("a crumb hangs the tree rooted at the folder it stands in, the tab's file marked in it; a folder pressed opens in place, listed as it opens, the tree standing; a file pressed opens in the tab and takes the tree down, ⌘ in a tab of its own", async () => {
  const view = mounted(FILE);
  await view.press(view.crumb("plans-app.ts"));

  assert.equal(view.crumb("plans-app.ts").getAttribute("aria-expanded"), "true");
  assert.equal(view.box()?.getAttribute("aria-label"), "apps/web");
  assert.ok(
    view
      .box()
      ?.querySelector("file-tree-container")
      ?.shadowRoot?.querySelector("[data-file-tree-colored-icons='true']"),
    "the tree's own coloured icons",
  );
  assert.deepEqual(view.rows(), ["routes/", "index.ts", "plans-app.ts (marked)"]);

  await view.click(view.row("routes/"));
  assert.ok(view.box(), "a folder pressed leaves the tree standing");
  assert.ok(view.listed.includes("apps/web/routes"));
  assert.deepEqual(view.rows(), [
    "routes/ (marked)",
    "routes/health.ts",
    "index.ts",
    "plans-app.ts",
  ]);

  await view.click(view.row("routes/health.ts"), true);
  assert.equal(view.box(), null, "a file chosen takes the tree down");
  await view.press(view.crumb("plans-app.ts"));
  await view.click(view.row("index.ts"));
  assert.deepEqual(view.opened, ["apps/web/routes/health.ts in a new tab", "apps/web/index.ts"]);
});

test("a folder's crumb roots its tree at the folder above it, the repository's at the root, each with the path to the tab's file opened", async () => {
  const view = mounted(FILE);
  await view.press(view.crumb("web"));
  assert.equal(view.box()?.getAttribute("aria-label"), "apps");
  assert.deepEqual(view.rows(), [
    "desktop/",
    "web/",
    "web/routes/",
    "web/index.ts",
    "web/plans-app.ts (marked)",
  ]);

  await view.press(view.crumb(REPOSITORY));
  assert.equal(view.box()?.getAttribute("aria-label"), REPOSITORY);
  assert.equal(view.crumb("web").getAttribute("aria-expanded"), "false");
  assert.ok(view.rows().includes("apps/web/plans-app.ts (marked)"));
  assert.ok(view.rows().includes("README.md"));
});

test("the tree stands as tall as its rows up to the room under the crumb, Escape hands the keyboard back to the crumb, and a second press on the crumb takes it down", async () => {
  const view = mounted(FILE);
  await view.press(view.crumb("plans-app.ts"));
  assert.equal(view.box()?.dataset.placed, "true");
  assert.equal(view.box()?.style.height, "80px", "three rows and the box's insets");
  await view.click(view.row("routes/"));
  assert.equal(view.box()?.style.height, "104px", "it grows as a folder opens");

  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
  });
  assert.equal(view.box(), null);
  assert.equal(document.activeElement, view.crumb("plans-app.ts"));

  vi.stubGlobal("innerHeight", 60);
  await view.press(view.crumb("plans-app.ts"));
  assert.equal(view.box()?.style.height, "48px", "the room under the crumb, less the margin");
  await view.press(view.crumb("plans-app.ts"));
  assert.equal(view.box(), null);
});

test("a folder that cannot be listed says why in the tree's place, and the box still takes Escape", async () => {
  const view = mounted(FILE, new Map([["apps/web", { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE }]]));
  await view.press(view.crumb("plans-app.ts"));

  assert.equal(
    view.box()?.textContent,
    "The Luke GitHub App no longer reaches this plan's repository.",
  );
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.equal(view.box(), null);
  assert.equal(document.activeElement, view.crumb("plans-app.ts"));
});
