import { createElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { SettingsSection } from "../settings-section/settings-section.js";
import { SettingsPage } from "./settings-page.js";

/**
 * settings-page.browser.test.ts -- the page's title is its `h1`, heading the
 * sections' regions; the column holds its measure in the middle of a wide
 * page and insets less once the desktop page's content is narrower than 480px;
 * the page's actions end the title's line until they no longer fit beside
 * it; sections stand one equal gap apart; and the page scrolls inside its
 * own box rather than growing its container.
 */

const LONG_TITLE =
  "Coding agents that open pull requests against acme/a-repository-whose-name-runs";

/** A section headed `title` holding one row whose control is a button. */
function section(title: string): React.JSX.Element {
  return createElement(SettingsSection, {
    key: title,
    title,
    children: createElement(SettingsRow, {
      label: `${title} setting`,
      children: () => createElement(Button, { children: "Change" }),
    }),
  });
}

/** A page `width` by `height` pixels titled `title`, with a Reset and a section for each name. */
function pageAt(
  width: number,
  height: number,
  title: string,
  sections: readonly string[],
): React.JSX.Element {
  return createElement(
    "div",
    { style: { width, height } },
    createElement(SettingsPage, {
      title,
      actions: createElement(Button, { variant: BUTTON_VARIANT.QUIET, children: "Reset" }),
      children: sections.map(section),
    }),
  );
}

/** The element `selector` finds in `container`, which must find one. */
function found(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

/** How far the title stands in from the page's left edge. */
async function insetAt(width: number, surface = surfaceAttributes(PROFILE.DESKTOP, THEME.DARK)) {
  const { container } = await mount(pageAt(width, 600, "Voice", ["Microphone"]), surface);
  const edge = found(container, ".luke-settings-page").getBoundingClientRect().left;
  return found(container, "h1").getBoundingClientRect().left - edge;
}

test("the title is the page's h1 and each section a region under it", async () => {
  const { container } = await mount(pageAt(720, 600, "Voice", ["Microphone", "Speaker"]));
  await expect.element(page.getByRole("heading", { level: 1, name: "Voice" })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Microphone" })).toBeInTheDocument();
  await expect.element(page.getByRole("region", { name: "Speaker" })).toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Reset" })).toBeVisible();
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a desktop page insets less once its content is narrower than 480px", async () => {
  const wide = await insetAt(560);
  const narrow = await insetAt(400);
  expect(narrow).toBeGreaterThan(0);
  expect(narrow).toBeLessThan(wide);
});

test("a web page insets the same narrow and wide", async () => {
  const surface = surfaceAttributes(PROFILE.WEB, THEME.LIGHT);
  expect(await insetAt(320, surface)).toBe(await insetAt(640, surface));
});

test("a wide page holds its column to a measure in the page's middle", async () => {
  const { container } = await mount(pageAt(1440, 600, "Voice", ["Microphone"]));
  const pageBox = found(container, ".luke-settings-page").getBoundingClientRect();
  const card = found(container, ".luke-settings-section-card").getBoundingClientRect();
  expect(card.width).toBeLessThan(pageBox.width / 2);
  // Note that the right side gives up the scroll bar's room to the gutter.
  const left = card.left - pageBox.left;
  const right = found(container, ".luke-settings-page").clientWidth - (card.right - pageBox.left);
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
});

test("the page's actions end the title's line and drop below a title too long for both", async () => {
  const { container } = await mount(pageAt(720, 600, "Voice", ["Microphone"]));
  const title = found(container, "h1").getBoundingClientRect();
  const reset = page.getByRole("button", { name: "Reset" }).element().getBoundingClientRect();
  const card = found(container, ".luke-settings-section-card").getBoundingClientRect();
  expect(reset.top).toBeLessThan(title.bottom);
  expect(reset.right).toBeCloseTo(card.right, 0);

  const { container: narrow } = await mount(pageAt(400, 600, LONG_TITLE, ["Microphone"]));
  const longTitle = found(narrow, "h1").getBoundingClientRect();
  const dropped = found(narrow, "button").getBoundingClientRect();
  expect(dropped.top).toBeGreaterThanOrEqual(longTitle.bottom);
  expect(dropped.right).toBeLessThanOrEqual(found(narrow, ".luke-settings-page").clientWidth + 1);
});

test("sections stand below the head one equal gap apart", async () => {
  const { container } = await mount(
    pageAt(720, 900, "Voice", ["Microphone", "Speaker", "Push to talk"]),
  );
  const head = found(container, "header").getBoundingClientRect();
  const sections = [...container.querySelectorAll(".luke-settings-section")].map((element) =>
    element.getBoundingClientRect(),
  );
  expect(sections).toHaveLength(3);
  expect(sections[0]?.top).toBeGreaterThan(head.bottom);
  const gaps = sections.slice(1).map((box, index) => box.top - (sections[index]?.bottom ?? 0));
  expect(gaps[0]).toBeGreaterThan(0);
  expect(gaps[1]).toBe(gaps[0]);
});

test("a page taller than its container scrolls inside its own box", async () => {
  const names = Array.from({ length: 12 }, (_, index) => `Group ${index + 1}`);
  const { container } = await mount(pageAt(720, 300, "Voice", names));
  const scroller = found(container, ".luke-settings-page");
  expect(scroller.getBoundingClientRect().height).toBe(300);
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  const last = page.getByRole("region", { name: "Group 12" });
  await expect.element(last).not.toBeInViewport();
  scroller.scrollTop = scroller.scrollHeight;
  await expect.element(last).toBeInViewport();
  expect(document.scrollingElement?.scrollTop).toBe(0);
});
