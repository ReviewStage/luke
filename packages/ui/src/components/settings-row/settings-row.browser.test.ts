import { createElement, useState } from "react";
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { accessibilityViolations, mount } from "../../testing/browser.js";
import { Button } from "../button/button.js";
import { Switch } from "../switch/switch.js";
import { SettingsRow } from "./settings-row.js";

/**
 * settings-row.browser.test.ts -- a row's controls stand beside its words
 * until the row is narrower than 380px and below them from there, a long
 * label wraps beside its controls rather than pushing them out of the row,
 * and the row's words name, describe, and announce what went wrong with
 * the control it holds.
 */

const LONG_LABEL =
  "Archive a coding agent's run once its pull request merges into the default branch of acme/a-repository-whose-name-runs-long";

/** A row `width` pixels wide whose one control is a button. */
function rowAt(width: number, label: string): React.JSX.Element {
  return createElement(
    "div",
    { style: { width } },
    createElement(SettingsRow, {
      label,
      description: "Runs that finished stop showing in Factory.",
      children: () => createElement(Button, { children: "Choose" }),
    }),
  );
}

/** The boxes of a mounted row's words, its controls, and the row itself. */
function boxes(container: HTMLElement) {
  const box = (selector: string) => {
    const found = container.querySelector(selector);
    if (found === null) throw new Error(`no ${selector}`);
    return found.getBoundingClientRect();
  };
  return {
    row: box(".luke-settings-row"),
    copy: box(".luke-settings-row-copy"),
    label: box(".luke-settings-row-label"),
    control: box("button"),
  };
}

/** A row whose switch's write fails once pressed, as a settings write is refused. */
function RefusedRow(): React.JSX.Element {
  const [error, setError] = useState<string | undefined>(undefined);
  return createElement(SettingsRow, {
    label: "Show captions",
    description: "Words the call hears stand under its video.",
    error,
    children: (control) =>
      createElement(Switch, {
        checked: false,
        label: "Show captions",
        describedBy: control["aria-describedby"],
        "aria-invalid": control["aria-invalid"],
        onChange: () => setError("The setting could not be saved."),
      }),
  });
}

test("at 380px and wider the controls stand beside the words, at the row's end", async () => {
  for (const width of [560, 380]) {
    const { container } = await mount(rowAt(width, "Launch at login"));
    const { row, copy, control } = boxes(container);
    expect(control.left).toBeGreaterThanOrEqual(copy.right);
    expect(control.top).toBeLessThan(copy.bottom);
    expect(control.right).toBeLessThan(row.right);
    expect(row.right - control.right).toBe(copy.left - row.left);
  }
});

test("narrower than 380px, by a whole pixel or a fraction of one, the controls drop below the words, to the row's end", async () => {
  for (const width of [379, 379.5]) {
    const { container } = await mount(rowAt(width, "Launch at login"));
    const { row, copy, control } = boxes(container);
    expect(control.top).toBeGreaterThanOrEqual(copy.bottom);
    expect(row.right - control.right).toBeCloseTo(copy.left - row.left);
  }
});

test("a long label wraps beside its controls, which stay whole inside the row", async () => {
  const short = boxes((await mount(rowAt(480, "Launch at login"))).container);
  const { container } = await mount(rowAt(480, LONG_LABEL));
  const { row, label, control } = boxes(container);
  expect(label.height).toBeGreaterThan(short.label.height);
  expect(label.right).toBeLessThanOrEqual(control.left);
  expect(control.right).toBeLessThanOrEqual(row.right);
  expect(container.querySelector("button")?.scrollWidth).toBe(
    container.querySelector("button")?.clientWidth,
  );
});

test("an unbroken word in a narrow row breaks inside the row rather than painting past it", async () => {
  const { container } = await mount(
    rowAt(240, "acme/a-repository-whose-name-runs-long-and-longer-still"),
  );
  const { row, label } = boxes(container);
  expect(label.right).toBeLessThanOrEqual(row.right);
  expect(container.querySelector(".luke-settings-row")?.scrollWidth).toBe(
    container.querySelector(".luke-settings-row")?.clientWidth,
  );
});

test("the label's id names a control and the description describes it", async () => {
  await mount(
    createElement(SettingsRow, {
      label: "Launch at login",
      description: "Luke opens with the Mac.",
      children: (control) =>
        createElement("input", {
          type: "checkbox",
          "aria-labelledby": control.labelId,
          "aria-describedby": control["aria-describedby"],
        }),
    }),
  );
  const box = page.getByRole("checkbox", { name: "Launch at login" });
  await expect.element(box).toHaveAccessibleDescription("Luke opens with the Mac.");
  await expect.element(box).not.toHaveAttribute("aria-invalid");
});

test("a failed write describes the control and is announced as it arrives", async () => {
  const { container } = await mount(createElement(RefusedRow));
  const region = container.querySelector('[aria-live="polite"]');
  expect(region?.textContent).toBe("");
  const control = page.getByRole("switch", { name: "Show captions" });
  await expect.element(control).not.toBeInvalid();
  await control.click();
  await expect.element(control).toBeInvalid();
  await expect
    .element(control)
    .toHaveAccessibleDescription(
      "Words the call hears stand under its video. The setting could not be saved.",
    );
  expect(container.querySelector('[aria-live="polite"]')).toBe(region);
  expect(region?.textContent).toBe("The setting could not be saved.");
  expect(await accessibilityViolations(container)).toEqual([]);
});

test("a row with no description and no error describes its control with nothing", async () => {
  const { container } = await mount(
    createElement(SettingsRow, {
      label: "Sign out",
      description: "",
      error: null,
      children: (control) =>
        createElement(Button, {
          "aria-describedby": control["aria-describedby"],
          children: "Sign out",
        }),
    }),
  );
  const button = page.getByRole("button", { name: "Sign out" });
  await expect.element(button).not.toHaveAttribute("aria-describedby");
  expect(container.querySelectorAll("p").length).toBe(1);
  expect(await accessibilityViolations(container)).toEqual([]);
});
