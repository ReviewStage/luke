import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { PROFILE, surfaceAttributes, THEME } from "../tokens/surface.js";
import { accessibilityViolations, mount } from "./browser.js";

/**
 * browser.browser.test.ts -- the browser project drives a page as a person
 * does, with trusted keys and presses in a real Chromium, and its
 * accessibility check names a control a reader could not use.
 */

/** A one-field form whose button says what was typed, as a reader would meet one. */
function NameForm(): React.JSX.Element {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | undefined>(undefined);
  return createElement(
    "form",
    { onSubmit: (event: React.FormEvent) => event.preventDefault() },
    createElement(
      "label",
      null,
      "Name ",
      createElement("input", {
        value: name,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value),
      }),
    ),
    createElement("button", { type: "button", onClick: () => setSaved(name) }, "Save"),
    createElement("p", { role: "status" }, saved === undefined ? "" : `Saved ${saved}`),
  );
}

test("the keyboard walks a form in reading order, types into the field it is on, and presses the button", async () => {
  const { container } = await mount(createElement(NameForm));
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(container.querySelector("input"));
  await userEvent.keyboard("Luke");
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement).toBe(container.querySelector("button"));
  await userEvent.keyboard("{Enter}");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved Luke");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a page is drawn at the profile and theme it is mounted at, in the shared tokens", async () => {
  await mount(createElement("p", null, "Words"), surfaceAttributes(PROFILE.WEB, THEME.LIGHT));
  const root = getComputedStyle(document.documentElement);
  expect(root.getPropertyValue("--luke-control-height").trim()).toBe("44px");
  expect(root.colorScheme).toBe("light");
});

test("the accessibility check names a field nothing labels", async () => {
  const { container } = await mount(createElement("input", { type: "text" }));
  expect(await accessibilityViolations(container)).toContain("label");
});
