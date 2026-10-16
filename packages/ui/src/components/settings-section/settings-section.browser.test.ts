import { createElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { Button } from "../button/button.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { SettingsSection } from "./settings-section.js";

/**
 * settings-section.browser.test.ts -- a headed section is a region its
 * heading names, standing above the card; the card holds its rows edge to
 * edge with one hairline between each and the next and none above the
 * first; and a section with no heading draws the card alone.
 */

/** A row named `label` whose one control is a button. */
function row(label: string): React.JSX.Element {
  return createElement(SettingsRow, {
    key: label,
    label,
    children: () => createElement(Button, { children: "Change" }),
  });
}

/** A section `width` pixels wide headed `title`, holding a row for each label. */
function sectionAt(width: number, title: string | undefined, labels: readonly string[]) {
  return createElement(
    "div",
    { style: { width } },
    createElement(SettingsSection, { title, children: labels.map(row) }),
  );
}

/** The element `selector` finds in `container`, which must find one. */
function found(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

test("a headed section is a region its heading names", async () => {
  const { container } = await mount(sectionAt(480, "Voice", ["Microphone", "Speaker"]));
  const region = page.getByRole("region", { name: "Voice" });
  await expect.element(region).toBeInTheDocument();
  await expect.element(page.getByRole("heading", { level: 2, name: "Voice" })).toBeVisible();
  await expect.element(region.getByRole("button", { name: "Change" }).first()).toBeInTheDocument();
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("the heading stands above the card, inside its edges", async () => {
  const { container } = await mount(sectionAt(480, "Voice", ["Microphone"]));
  const heading = found(container, "h2").getBoundingClientRect();
  const card = found(container, ".luke-settings-section-card").getBoundingClientRect();
  expect(heading.bottom).toBeLessThan(card.top);
  expect(heading.left).toBeGreaterThanOrEqual(card.left);
  expect(heading.right).toBeLessThanOrEqual(card.right);
});

test("rows meet edge to edge with one hairline between each and none above the first", async () => {
  const { container } = await mount(
    sectionAt(480, "Voice", ["Microphone", "Speaker", "Push to talk"]),
  );
  const card = found(container, ".luke-settings-section-card").getBoundingClientRect();
  // Note that we measure each row's body, inside the rule a row wears above it.
  const rows = [...container.querySelectorAll(".luke-settings-row-body")].map((element) =>
    element.getBoundingClientRect(),
  );
  expect(rows).toHaveLength(3);
  for (const box of rows) {
    expect(box.width).toBe(rows[0]?.width);
    expect(card.width - box.width).toBe(2);
  }
  expect(rows[0]?.top).toBe(card.top + 1);
  expect(rows.at(-1)?.bottom).toBe(card.bottom - 1);
  for (const [index, box] of rows.entries()) {
    const previous = rows[index - 1];
    if (previous !== undefined) expect(box.top - previous.bottom).toBe(1);
  }
});

test("a row in a section narrower than 380px still drops its controls below its words", async () => {
  const { container } = await mount(sectionAt(360, "Voice", ["Microphone"]));
  const copy = found(container, ".luke-settings-row-copy").getBoundingClientRect();
  const control = found(container, "button").getBoundingClientRect();
  expect(control.top).toBeGreaterThanOrEqual(copy.bottom);
});

test("a section with no heading draws its card alone and is no landmark", async () => {
  const { container } = await mount(sectionAt(480, undefined, ["Launch at login"]));
  expect(container.querySelector("h2")).toBeNull();
  await expect.element(page.getByRole("region")).not.toBeInTheDocument();
  const section = found(container, ".luke-settings-section").getBoundingClientRect();
  const card = found(container, ".luke-settings-section-card").getBoundingClientRect();
  expect(card.top).toBe(section.top);
  expect(await accessibilityViolations(container)).toEqual([]);
});
