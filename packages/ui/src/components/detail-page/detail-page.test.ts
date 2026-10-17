// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { PAGE_FRAME } from "../page-frame/page-frame.js";
import { DetailPage, type DetailSecondary } from "./detail-page.js";

/**
 * detail-page.test.ts -- the page is a region named by its title, its
 * secondary column a landmark of its own named by its label and holding only
 * its own content, a page with none has no such landmark, an empty slot draws
 * nothing, and each column takes the keyboard so it can be scrolled by its
 * keys. Under the window's toolbar the page draws no title of its own,
 * stands the toolbar, and is named by its label. Synthetic plans.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
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
