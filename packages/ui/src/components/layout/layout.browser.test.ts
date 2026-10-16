import { createElement, type ReactNode } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { ALIGN, Inline, JUSTIFY, LAYOUT_ELEMENT, Stack } from "./layout.js";

/**
 * layout.browser.test.ts -- an Inline wraps where its room runs out unless
 * told to hold its line, both arrangements stand their items where they are
 * aligned, and one drawn as a list reads as a list without a list's indent.
 */

/** A box `width` pixels wide holding `children`. */
function box(width: number, children: ReactNode): React.JSX.Element {
  return createElement("div", { style: { width } }, children);
}

/** `count` blocks, each `width` pixels wide, named by their place. */
function blocks(count: number, width: number): React.JSX.Element[] {
  return Array.from({ length: count }, (_, index) =>
    createElement("span", { key: index, style: { flex: "none", width, height: 20 } }, index + 1),
  );
}

/** Each item's box, in order, or none where there is no arrangement to read. */
function boxesOf(within: Element | undefined, selector: string): DOMRect[] {
  return [...(within?.querySelectorAll(selector) ?? [])].map((each) =>
    each.getBoundingClientRect(),
  );
}

test("an Inline that runs out of room wraps onto a new line, and one told to hold its line keeps to it", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      box(150, createElement(Inline, { children: blocks(3, 60) })),
      box(150, createElement(Inline, { wrap: false, children: blocks(3, 60) })),
    ),
  );
  const [wrapping, held] = container.querySelectorAll(".luke-inline");
  const wrapped = boxesOf(wrapping, "span");
  const kept = boxesOf(held, "span");
  expect(wrapped[2]?.top).toBeGreaterThan(wrapped[0]?.top ?? 0);
  expect(new Set(kept.map((each) => each.top)).size).toBe(1);
});

test("items stand where the arrangement aligns them, along it and across it", async () => {
  const { container } = await mount(
    createElement(
      "div",
      null,
      box(300, createElement(Inline, { justify: JUSTIFY.END, children: blocks(2, 40) })),
      box(300, createElement(Stack, { align: ALIGN.CENTER, children: blocks(1, 40) })),
    ),
  );
  const [inline, stack] = [...container.querySelectorAll(".luke-inline, .luke-stack")];
  const lastInRow = boxesOf(inline, "span").at(-1);
  expect(lastInRow?.right).toBe(inline?.getBoundingClientRect().right);
  const centred = boxesOf(stack, "span")[0];
  const frame = stack?.getBoundingClientRect();
  expect(centred && (centred.left + centred.right) / 2).toBe(
    frame && (frame.left + frame.right) / 2,
  );
});

test("an Inline that holds its line breaks an unbroken word inside its item rather than painting past it", async () => {
  const { container } = await mount(
    box(
      150,
      createElement(Inline, {
        wrap: false,
        children: [
          createElement("span", { key: "a" }, "Model"),
          createElement("span", { key: "b" }, "acme/a-repository-whose-name-runs-long"),
        ],
      }),
    ),
  );
  const row = container.querySelector(".luke-inline")?.getBoundingClientRect();
  const long = container.querySelectorAll("span")[1];
  expect(long && long.scrollWidth <= long.clientWidth).toBe(true);
  expect(long?.getBoundingClientRect().right).toBeLessThanOrEqual(row?.right ?? 0);
});

test("a Stack drawn as a list reads as a list, with its items flush to its edge", async () => {
  const { container } = await mount(
    createElement(Stack, {
      as: LAYOUT_ELEMENT.UL,
      "aria-label": "Members",
      children: ["Ada", "Grace"].map((name) =>
        createElement(Stack, { key: name, as: LAYOUT_ELEMENT.LI, children: name }),
      ),
    }),
  );
  await expect.element(page.getByRole("list", { name: "Members" })).toHaveAttribute("role", "list");
  expect(page.getByRole("listitem").elements()).toHaveLength(2);
  const list = container.querySelector("ul")?.getBoundingClientRect();
  expect(container.querySelector("li")?.getBoundingClientRect().left).toBe(list?.left);
  expect(await accessibilityViolations(container)).toEqual([]);
});
