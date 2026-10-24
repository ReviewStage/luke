// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PAGE_FRAME } from "../page-frame/page-frame.js";
import { DetailPage, type DetailSecondary } from "./detail-page.js";

/**
 * detail-page.test.ts -- the page is a region named by its title, its
 * secondary column a landmark of its own named by its label and holding only
 * its own content, a page with none has no such landmark, an empty slot draws
 * nothing, and each column takes the keyboard so it can be scrolled by its
 * keys. Its bar picks up its title once the header has scrolled away, as
 * words hidden from a reader while the header is in view. Under the window's
 * toolbar the page draws no title of its own, stands the toolbar, and is
 * named by its label. Synthetic plans.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The plan's page drawn into the document, its secondary column `secondary`. */
function draw({
  secondary,
  description = "A plan in the platform workspace.",
}: {
  secondary?: DetailSecondary;
  description?: string;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DetailPage, {
        frame: PAGE_FRAME.PAGE,
        title: "Launch checklist",
        description,
        actions: createElement("button", { type: "button" }, "Edit"),
        secondary,
        children: createElement("p", null, "Step 1"),
      }),
    ),
  );
  return container;
}

/** The name a landmark is given, by its label or the element its label points at. */
function nameOf(element: Element): string | null {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) return document.getElementById(labelledBy)?.textContent ?? null;
  return element.getAttribute("aria-label");
}

/** The one element `selector` finds in `container` whose words include `words`, failing the test if there is none. */
function find(container: Element, selector: string, words = ""): HTMLElement {
  const found = [...container.querySelectorAll(selector)].find(
    (element) => element instanceof HTMLElement && (element.textContent ?? "").includes(words),
  );
  if (!(found instanceof HTMLElement)) throw new Error(`no ${selector} with "${words}"`);
  return found;
}

const FACTS: DetailSecondary = {
  label: "Details",
  content: createElement("p", null, "Owner: Ada Lovelace"),
};

test("the page is a region named by its title, and its secondary column a landmark named by its label", () => {
  const container = draw({ secondary: FACTS });
  const region = find(container, "section");
  expect(nameOf(region)).toBe("Launch checklist");
  expect(container.querySelector("h1")?.textContent).toBe("Launch checklist");

  expect(container.querySelectorAll("aside")).toHaveLength(1);
  const details = find(container, "aside");
  expect(nameOf(details)).toBe("Details");
  expect(details.textContent).toBe("Owner: Ada Lovelace");
  expect(region.contains(details)).toBe(true);
});

test("a page with no secondary column has no complementary landmark, and shows its main content", () => {
  const container = draw({});
  expect(container.querySelectorAll("aside")).toHaveLength(0);
  expect(container.textContent).toContain("Step 1");
});

test("an empty description draws no paragraph under the title", () => {
  const container = draw({ description: "" });
  expect(container.querySelectorAll("header p")).toHaveLength(0);
  expect(draw({}).querySelector("header p")?.textContent).toBe("A plan in the platform workspace.");
});

test("the main content and the secondary column each take the keyboard's focus", () => {
  const container = draw({ secondary: FACTS });
  const main = find(container, "[tabindex]", "Step 1");
  const details = find(container, "aside");
  main.focus();
  expect(document.activeElement).toBe(main);
  details.focus();
  expect(document.activeElement).toBe(details);
});

test("under the toolbar the page is a region named by its label, with no title of its own", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DetailPage, {
        frame: PAGE_FRAME.TOOLBAR,
        label: "Launch checklist",
        toolbar: createElement("header", null, createElement("button", { type: "button" }, "Edit")),
        secondary: FACTS,
        children: createElement("p", null, "Step 1"),
      }),
    ),
  );
  const region = find(container, "section");
  expect(nameOf(region)).toBe("Launch checklist");
  expect(container.querySelector("h1")).toBeNull();
  expect(find(region, "header button").textContent).toBe("Edit");
  expect(find(region, "[tabindex]", "Step 1").textContent).toBe("Step 1");
  expect(nameOf(find(region, "aside"))).toBe("Details");
});

/** What an intersection observer reports of the heading it watches: in its root's view, or scrolled up past its top. */
type HeadingSeen = (entries: readonly Partial<IntersectionObserverEntry>[]) => void;

/** The headings the page's intersection observers watch, each with its observer's callback. */
const headingsWatched = new Map<Element, HeadingSeen>();

/** An intersection observer that reports nothing until a test scrolls the heading it watches, as the browser's would. */
class HeadingObserver {
  readonly #callback: HeadingSeen;
  constructor(callback: HeadingSeen) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    headingsWatched.set(target, this.#callback);
  }
  disconnect(): void {
    for (const [target, callback] of headingsWatched)
      if (callback === this.#callback) headingsWatched.delete(target);
  }
}

/** Scrolls the page's `h1` up out of its column's view, or back into it, as the observer over the column reports it. */
function scrollHeading(container: Element, away: boolean): void {
  const heading = find(container, "h1");
  const seen = headingsWatched.get(heading);
  if (seen === undefined) throw new Error("the heading is not watched");
  const top = 100;
  act(() =>
    seen([
      {
        isIntersecting: !away,
        rootBounds: { top } as DOMRectReadOnly,
        boundingClientRect: { bottom: away ? top - 20 : top + 40 } as DOMRectReadOnly,
      },
    ]),
  );
}

/** The bar's copy of the page's name, as a reader is handed it: its words, or none where it is hidden from them or not drawn. */
function barName(container: Element): string | undefined {
  const bar = find(container, "header.luke-toolbar");
  const copy = [...bar.querySelectorAll(".luke-toolbar-pick-up")].find(
    (element) => element.closest('[aria-hidden="true"]') === null,
  );
  return copy?.textContent ?? undefined;
}

test("once the header's title scrolls out of view the bar names the page, as words rather than a second heading, and once it is back the bar's copy is gone", () => {
  vi.stubGlobal("IntersectionObserver", HeadingObserver);
  const container = draw({});
  expect(barName(container)).toBeUndefined();

  scrollHeading(container, true);
  expect(barName(container)).toBe("Launch checklist");
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(find(container, "header.luke-toolbar").querySelector("h1, [role='heading']")).toBeNull();

  scrollHeading(container, false);
  expect(barName(container)).toBeUndefined();
});

test("a title that is more than words hands the bar the words a reader hears, not what is hidden from them", () => {
  vi.stubGlobal("IntersectionObserver", HeadingObserver);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DetailPage, {
        frame: PAGE_FRAME.PAGE,
        title: createElement(
          "span",
          null,
          createElement("span", { "aria-hidden": "true" }, "AL"),
          " Ada Lovelace",
        ),
        children: createElement("p", null, "Step 1"),
      }),
    ),
  );
  scrollHeading(container, true);
  expect(barName(container)).toBe("Ada Lovelace");
});

test("a page whose bar stands outside it draws no bar and hands the caller the name its bar picks up, shown once the header has scrolled away", () => {
  vi.stubGlobal("IntersectionObserver", HeadingObserver);
  const picked: { name: string; shown: boolean }[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DetailPage, {
        frame: PAGE_FRAME.PAGE,
        title: "Launch checklist",
        onPickUp: (pickUp: { name: string; shown: boolean }) => picked.push(pickUp),
        children: createElement("p", null, "Step 1"),
      }),
    ),
  );

  expect(container.querySelector("header.luke-toolbar")).toBeNull();
  expect(container.querySelectorAll("h1")).toHaveLength(1);
  expect(picked.at(-1)).toEqual({ name: "Launch checklist", shown: false });

  scrollHeading(container, true);
  expect(picked.at(-1)).toEqual({ name: "Launch checklist", shown: true });
});
