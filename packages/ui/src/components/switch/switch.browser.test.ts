import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { PROFILE, surfaceAttributes, THEME } from "../../tokens/surface.js";
import { Switch, SwitchMark } from "./switch.js";

/**
 * switch.browser.test.ts -- a switch is a control of its own, named by its
 * label and toggled alike by pointer, Space, and Enter; its drawing alone,
 * inside a row that is the switch, is hidden from a reader and takes no
 * press of its own; and an app's attributes for finding it reach its button.
 */

/** The attribute an app's search lands on, as the desktop's settings search hands it. */
const SEARCH_ANCHOR = { "data-search-anchor": "notify" } satisfies Record<string, string>;

/** A switch whose state the caller holds. */
function Notify(): React.JSX.Element {
  const [on, setOn] = useState(false);
  return createElement(Switch, {
    ...SEARCH_ANCHOR,
    checked: on,
    label: "Notify when an agent finishes",
    onChange: setOn,
  });
}

test("a switch is named by its label and toggled alike by pointer, Space, and Enter", async () => {
  await mount(createElement(Notify));
  const control = page.getByRole("switch", { name: "Notify when an agent finishes" });
  await control.click();
  await expect.element(control).toBeChecked();
  await userEvent.keyboard(" ");
  await expect.element(control).not.toBeChecked();
  await userEvent.keyboard("{Enter}");
  await expect.element(control).toBeChecked();
  await expect.element(control).toHaveAttribute("data-search-anchor", "notify");
});

test("the drawing alone is hidden from a reader, and the row around it is the switch", async () => {
  function Row(): React.JSX.Element {
    const [on, setOn] = useState(true);
    return createElement(
      "button",
      { type: "button", role: "menuitemcheckbox", "aria-checked": on, onClick: () => setOn(!on) },
      "Archive runs",
      createElement(SwitchMark, { checked: on }),
    );
  }
  const { container } = await mount(createElement("div", { role: "menu" }, createElement(Row)));
  expect(page.getByRole("switch").elements()).toHaveLength(0);
  const row = page.getByRole("menuitemcheckbox", { name: "Archive runs" });
  await row.click();
  await expect.element(row).toHaveAttribute("aria-checked", "false");
  expect(container.querySelector('[aria-hidden="true"]')?.getAttribute("data-checked")).toBe(
    "false",
  );
});

for (const surface of [
  surfaceAttributes(PROFILE.DESKTOP, THEME.LIGHT),
  surfaceAttributes(PROFILE.WEB, THEME.DARK),
]) {
  test(`a switch passes the accessibility check at ${surface["data-luke-profile"]} ${surface["data-luke-theme"]}`, async () => {
    const { container } = await mount(
      createElement(
        "div",
        null,
        createElement(Switch, { checked: true, label: "On", onChange: () => undefined }),
        createElement(Switch, {
          checked: false,
          label: "Off",
          onChange: () => undefined,
          disabled: true,
        }),
      ),
      surface,
    );
    expect(await accessibilityViolations(container)).toEqual([]);
  });
}
