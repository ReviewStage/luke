import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { PlusIcon } from "../../face/glyphs.js";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { BUTTON_VARIANT, Button, IconButton } from "./button.js";

/**
 * button.browser.test.ts -- a button is pressed alike by pointer, Enter, and
 * Space; an unavailable one refuses its press and leaves the tab order
 * unless it keeps the keyboard to say why; a busy one refuses its press,
 * keeps its width, and is named by what it is doing; and a glyph alone is
 * named by its label.
 */

/** A button that counts its presses, beside the count, with `busy` and `disabled` as given. */
function Counter(props: {
  busy?: boolean;
  disabled?: boolean;
  focusableWhenDisabled?: boolean;
}): React.JSX.Element {
  const [presses, setPresses] = useState(0);
  return createElement(
    "div",
    null,
    createElement(Button, {
      ...props,
      variant: BUTTON_VARIANT.PRIMARY,
      busyLabel: "Saving",
      onClick: () => setPresses((count) => count + 1),
      children: "Save",
    }),
    createElement("output", null, String(presses)),
  );
}

function count(): string | null | undefined {
  return document.querySelector("output")?.textContent;
}

test("a button is pressed alike by pointer, Enter, and Space", async () => {
  await mount(createElement(Counter));
  const button = page.getByRole("button", { name: "Save" });
  await button.click();
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  expect(count()).toBe("3");
});

test("a disabled button leaves the tab order and refuses its press", async () => {
  await mount(
    createElement(
      "div",
      null,
      createElement(Counter, { disabled: true }),
      createElement("input", { "aria-label": "After" }),
    ),
  );
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("After");
  await page.getByRole("button", { name: "Save" }).click({ force: true });
  expect(count()).toBe("0");
});

test("an unavailable button that keeps the keyboard is focused but refuses its press", async () => {
  await mount(createElement(Counter, { disabled: true, focusableWhenDisabled: true }));
  await userEvent.keyboard("{Tab}");
  const button = page.getByRole("button", { name: "Save" });
  await expect.element(button).toHaveFocus();
  await expect.element(button).toHaveAttribute("aria-disabled", "true");
  await userEvent.keyboard("{Enter}");
  await button.click({ force: true });
  expect(count()).toBe("0");
});

test("a busy button refuses its press, keeps its width, and is named by what it is doing", async () => {
  const { container } = await mount(createElement(Counter));
  const idleWidth = container.querySelector("button")?.getBoundingClientRect().width;
  await mount(createElement(Counter, { busy: true }));
  const busy = page.getByRole("button", { name: "Saving" });
  await expect.element(busy).toHaveAttribute("aria-busy", "true");
  await busy.click({ force: true });
  expect(document.querySelectorAll("output")[1]?.textContent).toBe("0");
  expect(busy.element().getBoundingClientRect().width).toBe(idleWidth);
});

test("a glyph alone is named by its label, and a toggle says whether it stands on", async () => {
  const { container } = await mount(
    createElement(IconButton, { icon: createElement(PlusIcon), label: "New plan", pressed: true }),
  );
  await expect
    .element(page.getByRole("button", { name: "New plan", pressed: true }))
    .toBeInTheDocument();
  expect(await accessibilityViolations(container)).toEqual([]);
});

const SURFACES = [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
];

for (const surface of SURFACES) {
  const at = `${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`;
  test(`every look passes the accessibility check at ${at}, enabled, unavailable, and busy`, async () => {
    const { container } = await mount(
      createElement(
        "div",
        null,
        Object.values(BUTTON_VARIANT).flatMap((variant) => [
          createElement(Button, { key: `${variant}-on`, variant, children: variant }),
          createElement(Button, {
            key: `${variant}-off`,
            variant,
            disabled: true,
            children: variant,
          }),
          createElement(Button, {
            key: `${variant}-busy`,
            variant,
            busy: true,
            busyLabel: `${variant} busy`,
            children: variant,
          }),
        ]),
      ),
      surface,
    );
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}

test("a busy button's ring holds still for a visitor to the site who asked for reduced motion", async () => {
  await mount(
    createElement(Button, { busy: true, busyLabel: "Saving", children: "Save" }),
    surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
  );
  const button = page.getByRole("button", { name: "Saving" }).element();
  expect(getComputedStyle(button, "::after").animationPlayState).toBe("running");
  await commands.emulateReducedMotion(true);
  expect(getComputedStyle(button, "::after").animationPlayState).toBe("paused");
});
