// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { DetailPage, type DetailSecondary } from "./detail-page.js";

/**
 * detail-page.test.ts -- the page is a region named by its title, its
 * secondary column a landmark of its own named by its label and holding only
 * its own content, a page with none has no such landmark, an empty slot draws
 * nothing, and each column takes the keyboard so it can be scrolled by its
 * keys. Synthetic plans.
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

const FACTS: DetailSecondary = {
  label: "Details",
  content: createElement("p", null, "Owner: Ada Lovelace"),
};

test("the page is a region named by its title, and its secondary column a landmark named by its label", () => {
  const container = draw({ secondary: FACTS });
  const region = container.querySelector("section");
  expect(region).not.toBeNull();
  expect(nameOf(region as Element)).toBe("Launch checklist");
  expect(container.querySelector("h1")?.textContent).toBe("Launch checklist");

  const asides = container.querySelectorAll("aside");
  expect(asides).toHaveLength(1);
  const details = asides[0] as Element;
  expect(nameOf(details)).toBe("Details");
  expect(details.textContent).toBe("Owner: Ada Lovelace");
  expect(region?.contains(details)).toBe(true);
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
  const main = [...container.querySelectorAll("[tabindex]")].find((element) =>
    element.textContent?.includes("Step 1"),
  ) as HTMLElement | undefined;
  const details = container.querySelector("aside") as HTMLElement | null;
  main?.focus();
  expect(document.activeElement).toBe(main);
  details?.focus();
  expect(document.activeElement).toBe(details);
});
