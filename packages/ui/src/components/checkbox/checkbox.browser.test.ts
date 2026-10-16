import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Checkbox } from "./checkbox.js";

/**
 * checkbox.browser.test.ts -- a press on the box, a press on its words, and
 * Space each hand the caller the value they ask for, a mixed box resolves to
 * checked, and an unavailable one changes nothing.
 */

/** A choice the caller holds, every change it was handed listed after it. */
function Signed({ mixed = false, disabled = false, start = false }): React.JSX.Element {
  const [signed, setSigned] = useState(start);
  const [heard, setHeard] = useState<boolean[]>([]);
  return createElement(
    "div",
    null,
    createElement(Checkbox, {
      checked: signed,
      mixed,
      disabled,
      onChange: (value: boolean) => {
        setSigned(value);
        setHeard((all) => [...all, value]);
      },
      children: "Include my name and email",
    }),
    createElement("output", null, heard.join(",")),
  );
}

function heard(): string | null | undefined {
  return document.querySelector("output")?.textContent;
}

test("the box, its words, and Space each hand the caller the value they ask for", async () => {
  await mount(createElement(Signed));
  const box = page.getByRole("checkbox", { name: "Include my name and email" });
  await box.click();
  await page.getByText("Include my name and email").click();
  await expect.element(box).toHaveFocus();
  await userEvent.keyboard(" ");
  expect(heard()).toBe("true,false,true");
  await expect.element(box).toBeChecked();
});

test("a mixed box reads as mixed and a press resolves it to checked", async () => {
  await mount(createElement(Signed, { mixed: true }));
  const box = page.getByRole("checkbox", { name: "Include my name and email" });
  await expect.element(box).toBePartiallyChecked();
  await box.click();
  expect(heard()).toBe("true");
});

test("a mixed box resolves to checked whether its caller last held it checked or not", async () => {
  await mount(createElement(Signed, { mixed: true, start: true }));
  await page.getByRole("checkbox", { name: "Include my name and email" }).click();
  expect(heard()).toBe("true");
});

test("an unavailable box changes nothing", async () => {
  await mount(createElement(Signed, { disabled: true }));
  const box = page.getByRole("checkbox", { name: "Include my name and email" });
  await expect.element(box).toBeDisabled();
  await box.click({ force: true });
  expect(heard()).toBe("");
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.DARK),
  surfaceAttributes(PROFILE.WEB, THEME.LIGHT),
]) {
  test(`a box passes the accessibility check at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(createElement(Signed), surface);
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}
