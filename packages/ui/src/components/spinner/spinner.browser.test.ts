import { createElement } from "react";
import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { BusyLabel, Spinner, SpinnerRegion } from "./spinner.js";

/**
 * spinner.browser.test.ts -- a wait is said to a reader from a status line
 * that stands before it shows; a busy control's words give way to the ring
 * without the control changing width, and the control is named by what it
 * is doing; and the ring holds still for reduced motion.
 */

test("a wait's status line stands empty until it shows, and then says the wait", async () => {
  const { container } = await mount(
    createElement(Spinner, { label: "Loading transcript", shown: false }),
  );
  const status = page.getByRole("status");
  await expect.element(status).toBeInTheDocument();
  expect(status.element().textContent).toBe("");
  await mount(createElement(SpinnerRegion, { label: "Loading transcript" }));
  await expect.element(page.getByRole("status").nth(1)).toHaveTextContent("Loading transcript");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a busy control keeps its width, its words hidden under the ring, and is named by what it is doing", async () => {
  function Check({ busy }: { busy: boolean }): React.JSX.Element {
    return createElement(
      "div",
      { style: { display: "flex", gap: 8 } },
      createElement(
        "button",
        { type: "button", "data-test": "check" },
        createElement(BusyLabel, {
          busy,
          label: "Checking for updates",
          children: "Check for updates",
        }),
      ),
      createElement(Button, { variant: BUTTON_VARIANT.OUTLINE, children: "Beside it" }),
    );
  }
  const { container: idle } = await mount(createElement(Check, { busy: false }));
  const { container: busy } = await mount(createElement(Check, { busy: true }));
  const widthOf = (within: HTMLElement) =>
    within.querySelector("[data-test]")?.getBoundingClientRect().width;
  const besideOf = (within: HTMLElement) =>
    within.querySelectorAll("button")[1]?.getBoundingClientRect().left;
  expect(widthOf(busy)).toBe(widthOf(idle));
  expect(besideOf(busy)).toBe(besideOf(idle));
  await expect
    .element(page.getByRole("button", { name: "Checking for updates" }))
    .toBeInTheDocument();
});

test("the ring holds still for a visitor to the site who asked for reduced motion", async () => {
  const { container } = await mount(
    createElement(Spinner, { label: "Loading" }),
    surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
  );
  const ring = container.querySelector(".luke-spinner-ring");
  expect(ring && getComputedStyle(ring).animationPlayState).toBe("running");
  await commands.emulateReducedMotion(true);
  expect(ring && getComputedStyle(ring).animationPlayState).toBe("paused");
});
