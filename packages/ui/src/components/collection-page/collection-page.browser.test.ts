import { createElement, type ReactNode, useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Button } from "../button/button.js";
import { List, ListRow } from "../list-row/list-row.js";
import { TextField } from "../text-field/text-field.js";
import { COLLECTION_STATE, CollectionPage, type CollectionState } from "./collection-page.js";

/**
 * collection-page.browser.test.ts -- the page's header and filters stand
 * still while its content changes state and scrolls, a row's words open on
 * the title's edge, the title's acts sit on its line, a desktop page narrows
 * its inset in a narrow pane, and a read in progress is announced by name.
 */

const PLANS = Array.from({ length: 40 }, (_, index) => ({
  id: `plan-${index}`,
  name: `Plan ${index + 1}`,
}));

/** The plans page at `state`, in a frame `width` wide and 480px tall, its rows the plans. */
function Plans({
  state,
  width = 640,
}: {
  state: CollectionState;
  width?: number;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  return frame(
    width,
    createElement(CollectionPage, {
      title: "Plans",
      description: "Everything planned in this workspace.",
      actions: createElement(Button, null, "New plan"),
      filters: createElement(TextField, {
        label: "Search plans",
        value: query,
        onChange: setQuery,
      }),
      state,
      loadingLabel: "Reading plans",
      empty: createElement("p", null, "No plans yet"),
      error: createElement("p", { role: "alert" }, "Plans could not be read"),
      children: createElement(List, {
        label: "Plans",
        children: PLANS.map((plan) =>
          createElement(ListRow, { key: plan.id, title: plan.name, onPress: () => undefined }),
        ),
      }),
    }),
  );
}

function frame(width: number, children: ReactNode): React.JSX.Element {
  return createElement(
    "div",
    { style: { display: "flex", width: `${width}px`, height: "480px" } },
    children,
  );
}

function box(element: Element | null | undefined): DOMRect {
  expect(element).toBeTruthy();
  return element?.getBoundingClientRect() ?? new DOMRect();
}

function title(): Element {
  return page.getByRole("heading", { level: 1, name: "Plans" }).element();
}

test("the header and filters stand still, and the content opens in one place, whatever its state", async () => {
  const seen = new Map<CollectionState, { title: DOMRect; filter: DOMRect; content: DOMRect }>();
  for (const state of Object.values(COLLECTION_STATE)) {
    const { container } = await mount(createElement(Plans, { state }));
    seen.set(state, {
      title: box(title()),
      filter: box(page.getByRole("textbox", { name: "Search plans" }).element()),
      content: box(container.querySelector(".luke-collection-page-content")),
    });
    container.remove();
  }
  const ready = seen.get(COLLECTION_STATE.READY);
  for (const [, boxes] of seen) {
    expect(boxes.title.toJSON()).toEqual(ready?.title.toJSON());
    expect(boxes.filter.toJSON()).toEqual(ready?.filter.toJSON());
    expect(boxes.content.top).toBe(ready?.content.top);
  }
});

test("each state draws its own content, and a read in progress is announced by name", async () => {
  const { container } = await mount(createElement(Plans, { state: COLLECTION_STATE.LOADING }));
  await expect.element(page.getByRole("status")).toHaveTextContent("Reading plans");
  await expect.element(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(page.getByRole("list").all().length).toBe(0);
  expect(page.getByRole("region", { name: "Plans" }).element().contains(title())).toBe(true);
  expect(await accessibilityViolations(container)).toEqual([]);
  container.remove();

  await mount(createElement(Plans, { state: COLLECTION_STATE.EMPTY }));
  await expect.element(page.getByText("No plans yet")).toBeVisible();
  expect(page.getByRole("status").all().length).toBe(0);

  await mount(createElement(Plans, { state: COLLECTION_STATE.ERROR }));
  await expect.element(page.getByRole("alert")).toHaveTextContent("Plans could not be read");

  await mount(createElement(Plans, { state: COLLECTION_STATE.READY }));
  await expect.element(page.getByRole("list", { name: "Plans" })).toBeInTheDocument();
});

test("the content scrolls under a header and filters that stay where they are", async () => {
  const { container } = await mount(createElement(Plans, { state: COLLECTION_STATE.READY }));
  const before = box(title());
  const filter = page.getByRole("textbox", { name: "Search plans" });
  const filterBefore = box(filter.element());
  const last = page.getByRole("button", { name: "Plan 40" });
  last.element().scrollIntoView();
  const scroller = container.querySelector(".luke-collection-page-scroll");
  expect(scroller?.scrollTop).toBeGreaterThan(0);
  expect(box(title()).toJSON()).toEqual(before.toJSON());
  expect(box(filter.element()).toJSON()).toEqual(filterBefore.toJSON());
  expect(box(container).height).toBeLessThanOrEqual(480);
  await expect.element(last).toBeInViewport();
});

for (const profile of Object.values(PROFILE)) {
  test(`on the ${profile} profile, a row's words, the filters, and the title open on one edge, and the acts sit on the title's line`, async () => {
    await mount(
      createElement(Plans, { state: COLLECTION_STATE.READY }),
      surfaceAttributes(profile, THEME.LIGHT),
    );
    const heading = box(title());
    const rowWords = box(page.getByText("Plan 1", { exact: true }).element());
    const filter = box(page.getByRole("textbox", { name: "Search plans" }).element());
    const act = box(page.getByRole("button", { name: "New plan" }).element());
    const lineHeight = Number.parseFloat(getComputedStyle(title()).lineHeight);
    expect(Math.abs(rowWords.left - heading.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(filter.left - heading.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(act.top + act.height / 2 - (heading.top + lineHeight / 2))).toBeLessThanOrEqual(
      1,
    );
  });
}

test("a desktop page narrows its inset in a pane under 480px wide", async () => {
  const { container } = await mount(createElement(Plans, { state: COLLECTION_STATE.READY }));
  const wide = box(title()).left - box(container).left;
  container.remove();
  const narrow = await mount(createElement(Plans, { state: COLLECTION_STATE.READY, width: 400 }));
  expect(wide - (box(title()).left - box(narrow.container).left)).toBe(40 - 24);
});

test("acts too many for a phone's header wrap under the title, every one inside the page", async () => {
  const { container } = await mount(
    frame(
      320,
      createElement(CollectionPage, {
        title: "Plans",
        actions: ["Import", "Export", "New plan"].map((name) =>
          createElement(Button, { key: name, children: name }),
        ),
        state: COLLECTION_STATE.EMPTY,
        loadingLabel: "Reading plans",
        empty: createElement("p", null, "No plans yet"),
      }),
    ),
  );
  const pageBox = box(container.querySelector(".luke-collection-page"));
  for (const name of ["Import", "Export", "New plan"]) {
    const act = box(page.getByRole("button", { name }).element());
    expect(act.left).toBeGreaterThanOrEqual(pageBox.left);
    expect(act.right).toBeLessThanOrEqual(pageBox.right);
  }
});

test("on a phone, an act leaves a long title 240px and wraps under it rather than beside it", async () => {
  await mount(
    frame(
      320,
      createElement(CollectionPage, {
        title: "Automations for the platform workspace",
        actions: createElement(Button, null, "New automation"),
        state: COLLECTION_STATE.EMPTY,
        loadingLabel: "Reading automations",
        empty: createElement("p", null, "No automations yet"),
      }),
    ),
  );
  const heading = box(page.getByRole("heading", { level: 1 }).element());
  const act = box(page.getByRole("button", { name: "New automation" }).element());
  expect(heading.width).toBeGreaterThanOrEqual(240);
  expect(act.top).toBeGreaterThanOrEqual(heading.bottom);
});

test("filters taller than half a short pane scroll themselves, and the content keeps the rest", async () => {
  const { container } = await mount(
    createElement(
      "div",
      { style: { display: "flex", width: "320px", height: "240px" } },
      createElement(CollectionPage, {
        title: "Plans",
        filters: Array.from({ length: 12 }, (_, index) =>
          createElement(Button, { key: index, children: `Filter ${index + 1}` }),
        ),
        state: COLLECTION_STATE.READY,
        loadingLabel: "Reading plans",
        children: createElement(List, {
          label: "Plans",
          children: createElement(ListRow, { title: "Launch checklist" }),
        }),
      }),
    ),
  );
  const scroll = box(container.querySelector(".luke-collection-page-scroll"));
  expect(scroll.height).toBeGreaterThanOrEqual(120);
  await expect.element(page.getByText("Launch checklist")).toBeInViewport();
  page.getByRole("button", { name: "Filter 12" }).element().scrollIntoView();
  await expect.element(page.getByRole("button", { name: "Filter 12" })).toBeInViewport();
});
