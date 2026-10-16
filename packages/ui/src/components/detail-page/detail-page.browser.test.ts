import { createElement } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Button } from "../button/button.js";
import { DetailPage } from "./detail-page.js";

/**
 * detail-page.browser.test.ts -- the page's main content and its secondary
 * column each scroll on their own under a header that stays where it is,
 * the title opens on the main content's edge and the acts end on the
 * secondary column's, a narrow pane puts the secondary column after the
 * main content in one scroll, each column scrolls by the keyboard, and a
 * desktop page narrows its inset in a
 * narrow pane.
 */

/** Lines enough to overflow either column, each its own paragraph. */
function lines(prefix: string, count: number): React.JSX.Element[] {
  return Array.from({ length: count }, (_, index) =>
    createElement("p", { key: index }, `${prefix} ${index + 1}`),
  );
}

/** The plan's page in a frame `width` wide and 480px tall, its secondary column the plan's facts. */
function Plan({
  width = 960,
  secondary = true,
}: {
  width?: number;
  secondary?: boolean;
}): React.JSX.Element {
  return createElement(
    "div",
    { style: { display: "flex", width: `${width}px`, height: "480px" } },
    createElement(DetailPage, {
      title: "Launch checklist",
      description: "A plan in the platform workspace.",
      actions: createElement(Button, null, "Edit"),
      secondary: secondary ? { label: "Details", content: lines("Fact", 40) } : undefined,
      children: lines("Step", 60),
    }),
  );
}

function box(element: Element | null | undefined): DOMRect {
  expect(element).toBeTruthy();
  return element?.getBoundingClientRect() ?? new DOMRect();
}

function title(): Element {
  return page.getByRole("heading", { level: 1, name: "Launch checklist" }).element();
}

function details(): Element {
  return page.getByRole("complementary", { name: "Details" }).element();
}

test("the main content and the secondary column each scroll on their own under a header that stays", async () => {
  await mount(createElement(Plan));
  const heading = box(title());
  const firstFact = box(page.getByText("Fact 1", { exact: true }).element());
  const lastStep = page.getByText("Step 60", { exact: true });
  lastStep.element().scrollIntoView();
  await expect.element(lastStep).toBeInViewport();
  expect(box(title()).toJSON()).toEqual(heading.toJSON());
  expect(box(page.getByText("Fact 1", { exact: true }).element()).toJSON()).toEqual(
    firstFact.toJSON(),
  );

  const firstStep = box(page.getByText("Step 1", { exact: true }).element());
  const lastFact = page.getByText("Fact 40", { exact: true });
  lastFact.element().scrollIntoView();
  await expect.element(lastFact).toBeInViewport();
  expect(box(title()).toJSON()).toEqual(heading.toJSON());
  expect(box(page.getByText("Step 1", { exact: true }).element()).toJSON()).toEqual(
    firstStep.toJSON(),
  );
});

test("each column takes the keyboard's focus in turn and scrolls by its keys alone", async () => {
  const { container } = await mount(createElement(Plan));
  const main = container.querySelector(".luke-detail-page-main");
  await page.getByRole("button", { name: "Edit" }).click();
  await userEvent.tab();
  expect(document.activeElement).toBe(main);
  await userEvent.keyboard("{End}");
  await expect.element(page.getByText("Step 60", { exact: true })).toBeInViewport();
  await expect.element(page.getByText("Fact 1", { exact: true })).toBeInViewport();
  await userEvent.tab();
  expect(document.activeElement).toBe(details());
  await userEvent.keyboard("{End}");
  await expect.element(page.getByText("Fact 40", { exact: true })).toBeInViewport();
  await expect.element(page.getByText("Step 60", { exact: true })).toBeInViewport();
});

test("the page is named by its title and its secondary column by its label", async () => {
  const { container } = await mount(createElement(Plan));
  const region = page.getByRole("region", { name: "Launch checklist" }).element();
  expect(region.contains(title())).toBe(true);
  expect(region.contains(details())).toBe(true);
  expect(details().textContent).toContain("Fact 1");
  expect(details().textContent).not.toContain("Step 1");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("with no secondary column there is no complementary landmark, and the main content scrolls alone", async () => {
  await mount(createElement(Plan, { secondary: false }));
  expect(page.getByRole("complementary").all().length).toBe(0);
  const heading = box(title());
  const lastStep = page.getByText("Step 60", { exact: true });
  lastStep.element().scrollIntoView();
  await expect.element(lastStep).toBeInViewport();
  expect(box(title()).toJSON()).toEqual(heading.toJSON());
});

for (const profile of Object.values(PROFILE)) {
  test(`on the ${profile} profile, the title opens on the main content's edge and the acts end on the secondary column's`, async () => {
    await mount(createElement(Plan, { width: 1440 }), surfaceAttributes(profile, THEME.LIGHT));
    const heading = box(title());
    const step = box(page.getByText("Step 1", { exact: true }).element());
    const act = box(page.getByRole("button", { name: "Edit" }).element());
    const fact = box(page.getByText("Fact 1", { exact: true }).element());
    const lineHeight = Number.parseFloat(getComputedStyle(title()).lineHeight);
    expect(Math.abs(step.left - heading.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(fact.right - act.right)).toBeLessThanOrEqual(1);
    expect(fact.left).toBeGreaterThan(step.right);
    expect(Math.abs(act.top + act.height / 2 - (heading.top + lineHeight / 2))).toBeLessThanOrEqual(
      1,
    );
  });
}

test("in a narrow pane the secondary column follows the main content in one scroll", async () => {
  await mount(createElement(Plan, { width: 400 }));
  const heading = box(title());
  const step = box(page.getByText("Step 60", { exact: true }).element());
  const fact = page.getByText("Fact 1", { exact: true });
  expect(box(fact.element()).top).toBeGreaterThan(step.bottom);
  expect(Math.abs(box(fact.element()).left - heading.left)).toBeLessThanOrEqual(1);
  fact.element().scrollIntoView();
  await expect.element(fact).toBeInViewport();
  expect(box(title()).toJSON()).toEqual(heading.toJSON());
});

test("a desktop page narrows its inset in a pane under 480px wide", async () => {
  const { container } = await mount(createElement(Plan, { width: 640 }));
  const wide = box(title()).left - box(container).left;
  container.remove();
  const narrow = await mount(createElement(Plan, { width: 400 }));
  expect(wide - (box(title()).left - box(narrow.container).left)).toBe(40 - 24);
});

test("acts too many for a phone's header wrap under the title, every one inside the page", async () => {
  const { container } = await mount(
    createElement(
      "div",
      { style: { display: "flex", width: "320px", height: "480px" } },
      createElement(DetailPage, {
        title: "Launch checklist",
        actions: ["Share", "Duplicate", "Move", "Archive", "Edit"].map((name) =>
          createElement(Button, { key: name, children: name }),
        ),
        children: lines("Step", 3),
      }),
    ),
  );
  const pageBox = box(container.querySelector(".luke-detail-page"));
  for (const name of ["Share", "Duplicate", "Move", "Archive", "Edit"]) {
    const act = box(page.getByRole("button", { name }).element());
    expect(act.left).toBeGreaterThanOrEqual(pageBox.left);
    expect(act.right).toBeLessThanOrEqual(pageBox.right);
  }
});

test("a title taller than half a short pane scrolls with the header, and the content keeps the rest", async () => {
  const { container } = await mount(
    createElement(
      "div",
      { style: { display: "flex", width: "320px", height: "240px" } },
      createElement(DetailPage, {
        title:
          "Migrate every workspace in the platform group onto the new runners one region at a time",
        description: "A plan in the platform workspace.",
        children: lines("Step", 3),
      }),
    ),
  );
  const body = box(container.querySelector(".luke-detail-page-body"));
  expect(body.height).toBeGreaterThanOrEqual(120);
  await expect.element(page.getByText("Step 1", { exact: true })).toBeInViewport();
  const description = page.getByText("A plan in the platform workspace.");
  description.element().scrollIntoView();
  await expect.element(description).toBeInViewport();
});
