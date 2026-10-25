// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { COLLECTION_STATE, CollectionPage } from "../collection-page/collection-page.js";
import { DetailPage } from "../detail-page/detail-page.js";
import { PAGE_FRAME } from "../page-frame/page-frame.js";
import { SettingsPage } from "../settings-page/settings-page.js";
import { PageHeader } from "./page-header.js";

/**
 * page-header.test.ts -- a document names itself once: every page that
 * heads itself (one thing's, a collection's, Settings) draws exactly one
 * `h1`, its title, and its acts stand in its header after the title, in
 * the keyboard's reach; a page under the window's toolbar draws none, so
 * the toolbar's title is never said twice; and the line under the title
 * says what the page is. Synthetic pages.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** `element` drawn into the document. */
function draw(element: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The page's one act. */
function shareButton(): ReactNode {
  return createElement("button", { type: "button" }, "Share");
}

const DOCUMENTS: readonly { page: string; draw: () => HTMLElement }[] = [
  {
    page: "one thing's page",
    draw: () =>
      draw(
        createElement(DetailPage, {
          frame: PAGE_FRAME.PAGE,
          title: "Launch checklist",
          actions: shareButton(),
          children: createElement("h2", null, "Steps"),
        }),
      ),
  },
  {
    page: "a collection's page",
    draw: () =>
      draw(
        createElement(CollectionPage, {
          frame: PAGE_FRAME.PAGE,
          title: "Launch checklist",
          actions: shareButton(),
          state: COLLECTION_STATE.READY,
          loadingLabel: "Loading steps",
          children: createElement("h2", null, "Steps"),
        }),
      ),
  },
  {
    page: "a settings page",
    draw: () =>
      draw(
        createElement(SettingsPage, {
          title: "Launch checklist",
          actions: shareButton(),
          children: createElement("h2", null, "Steps"),
        }),
      ),
  },
];

test.each(DOCUMENTS)("$page names itself once, its title the one h1", ({ draw: drawPage }) => {
  const container = drawPage();
  const headings = container.querySelectorAll("h1");
  expect(headings).toHaveLength(1);
  expect(headings[0]?.textContent).toBe("Launch checklist");
});

test.each(DOCUMENTS)(
  "$page's acts stand in its header after the title, in the keyboard's reach",
  ({ draw: drawPage }) => {
    const container = drawPage();
    const title = container.querySelector("h1");
    const share = [...container.querySelectorAll("button")].find((b) => b.textContent === "Share");
    if (title === null || share === undefined) throw new Error("no title or no act");

    expect(share.closest("header")).toBe(title.closest("header"));
    expect(title.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(share.closest("[hidden], [inert], [aria-hidden='true']")).toBeNull();
    share.focus();
    expect(document.activeElement).toBe(share);
  },
);

test("a page under the window's toolbar draws no h1 of its own, so its name is said once", () => {
  const container = draw([
    createElement(DetailPage, {
      key: "detail",
      frame: PAGE_FRAME.TOOLBAR,
      label: "Launch checklist",
      toolbar: createElement("div", null, "Launch checklist"),
      children: createElement("p", null, "Step 1"),
    }),
    createElement(CollectionPage, {
      key: "collection",
      frame: PAGE_FRAME.TOOLBAR,
      label: "Tasks",
      state: COLLECTION_STATE.READY,
      loadingLabel: "Loading tasks",
      children: createElement("p", null, "Task 1"),
    }),
  ]);
  expect(container.querySelectorAll("h1")).toHaveLength(0);
});

test("the line under the title says what the page is, and a slot left empty draws nothing", () => {
  const container = draw(
    createElement(PageHeader, {
      title: "Ada Lovelace",
      titleId: "person-title",
      description: "Engineer · Platform",
      actions: false,
    }),
  );
  const header = container.querySelector("header");
  expect(document.getElementById("person-title")?.textContent).toBe("Ada Lovelace");
  expect(header?.textContent).toBe("Ada LovelaceEngineer · Platform");
  expect(header?.querySelector("h1 + p")?.textContent).toBe("Engineer · Platform");
});
