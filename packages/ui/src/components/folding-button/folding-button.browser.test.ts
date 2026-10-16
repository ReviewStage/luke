import { createElement, Fragment, type ReactElement } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { PlusIcon } from "../../face/glyphs.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { FoldingButton, type FoldingButtonHint } from "./folding-button.js";

/**
 * folding-button.browser.test.ts -- a folding button under a toolbar that
 * folds it is a square around its glyph, still named by its words, and
 * raises them in its hint; drawn, its words name it and its hint raises
 * nothing; and busy, folded or not, it is named by what it is doing and
 * refuses its press.
 */

/** A stand-in hint, saying what the button hands it beside the button. */
const Hint: FoldingButtonHint = ({ label, children }) =>
  createElement(Fragment, null, children, createElement("output", null, label ?? "none"));

/** A toolbar, folded or not, holding one folding button. */
function toolbar(folded: boolean, button: ReactElement): ReactElement {
  return createElement(
    "div",
    { style: folded ? { "--luke-fold": "folded" } : undefined },
    createElement("div", null, button),
  );
}

/** An Add button, hinted by the stand-in. */
function add(): ReactElement {
  return createElement(FoldingButton, { label: "Add", icon: createElement(PlusIcon), hint: Hint });
}

function hinted(): string | null | undefined {
  return document.querySelector("output")?.textContent;
}

test("folded, it is a square around its glyph, still named by its words, and raises them in its hint", async () => {
  const { container } = await mount(toolbar(true, add()));
  const button = page.getByRole("button", { name: "Add" });
  await expect.poll(hinted).toBe("Add");
  const box = button.element().getBoundingClientRect();
  expect(box.width).toBe(box.height);
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("drawn, its words name it and its hint raises nothing", async () => {
  await mount(toolbar(false, add()));
  const button = page.getByRole("button", { name: "Add" });
  await expect.element(button).toBeVisible();
  await expect.poll(hinted).toBe("none");
  const box = button.element().getBoundingClientRect();
  expect(box.width).toBeGreaterThan(box.height);
});

test.each([
  ["folded", true],
  ["drawn", false],
])("busy and %s, it is named by what it is doing and refuses its press", async (_, folded) => {
  let presses = 0;
  await mount(
    toolbar(
      folded,
      createElement(FoldingButton, {
        label: "Run now",
        icon: createElement(PlusIcon),
        busy: "Running",
        onClick: () => {
          presses += 1;
        },
      }),
    ),
  );
  await page.getByRole("button", { name: "Running" }).click({ force: true });
  expect(presses).toBe(0);
});
