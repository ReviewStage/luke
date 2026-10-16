import { createElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "./text.js";

/**
 * text.browser.test.ts -- how words look and what they are are chosen apart:
 * a heading keeps its level whatever role it is set in, and a role sets its
 * words alike whatever element holds them.
 */

/** The size, leading, and weight words are drawn at. */
function setOf(element: Element): string {
  const style = getComputedStyle(element);
  return `${style.fontSize}/${style.lineHeight}/${style.fontWeight}`;
}

test("a heading set in the caption role is still a heading of its level, drawn as a caption", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      createElement(Text, {
        variant: TEXT_VARIANT.CAPTION,
        as: TEXT_ELEMENT.H1,
        children: "Members",
      }),
      createElement(Text, {
        variant: TEXT_VARIANT.CAPTION,
        as: TEXT_ELEMENT.SPAN,
        children: "Members",
      }),
    ),
  );
  const heading = page.getByRole("heading", { level: 1, name: "Members" });
  await expect.element(heading).toBeInTheDocument();
  const [asHeading, asSpan] = container.querySelectorAll(".luke-text");
  expect(asHeading && setOf(asHeading)).toBe(asSpan && setOf(asSpan));
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a title set at a lower heading level is drawn as a title, not as its level", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      createElement(Text, {
        variant: TEXT_VARIANT.TITLE,
        as: TEXT_ELEMENT.H3,
        children: "Workspace",
      }),
      createElement(Text, {
        variant: TEXT_VARIANT.TITLE,
        as: TEXT_ELEMENT.H1,
        children: "Workspace",
      }),
    ),
  );
  const [low, high] = container.querySelectorAll(".luke-text");
  expect(low?.tagName).toBe("H3");
  expect(low && setOf(low)).toBe(high && setOf(high));
});
