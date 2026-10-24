// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Announcer } from "../announcer/announcer.js";
import { Button } from "../button/button.js";
import { Switch } from "../switch/switch.js";
import { SettingsRow } from "./settings-row.js";

/**
 * settings-row.test.ts -- a row's words are its control's: its label names
 * the control, its description and a failed write describe it, and the
 * failure marks it invalid and is announced in the region that stood empty
 * before it arrived.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a fresh container in the document. */
function mount(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The words the elements an attribute's ids name say, in order, as a reader reads them. */
function wordsOf(element: Element, attribute: string): string {
  return (element.getAttribute(attribute) ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

/** A row whose switch's write is refused once pressed, as a settings write can be. */
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

test("the label's id names a control and the description describes it", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Launch at login",
      description: "Luke opens with the Mac.",
      children: (control) =>
        createElement("input", {
          type: "checkbox",
          "aria-labelledby": control.labelId,
          "aria-describedby": control["aria-describedby"],
          "aria-invalid": control["aria-invalid"],
        }),
    }),
  );
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox");
  expect(wordsOf(box, "aria-labelledby")).toBe("Launch at login");
  expect(wordsOf(box, "aria-describedby")).toBe("Luke opens with the Mac.");
  expect(box.hasAttribute("aria-invalid")).toBe(false);
});

test("a refused write marks the control invalid, describes it, and is announced as an alert as it arrives", () => {
  const container = mount(createElement(RefusedRow));
  mount(createElement(Announcer));
  const region = container.querySelector('[data-slot="field-error"]');
  expect(region?.textContent).toBe("");
  const control = container.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (control === null) throw new Error("no switch");
  expect(control.hasAttribute("aria-invalid")).toBe(false);
  act(() => control.click());
  expect(control.getAttribute("aria-invalid")).toBe("true");
  expect(wordsOf(control, "aria-describedby")).toBe(
    "Words the call hears stand under its video. The setting could not be saved.",
  );
  expect(container.querySelector('[data-slot="field-error"]')).toBe(region);
  expect(region?.textContent).toBe("The setting could not be saved.");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "The setting could not be saved.",
  );
  expect(document.querySelector('[role="status"]')?.textContent).toBe("");
});

test("an empty description and error say nothing, so the control is neither described nor invalid", () => {
  const container = mount(
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
  const button = container.querySelector("button");
  expect(button?.textContent).toBe("Sign out");
  expect(button?.hasAttribute("aria-describedby")).toBe(false);
  expect(container.textContent).toBe("Sign outSign out");
});

test("a leading mark stands in the row but names nothing: the label alone names the control", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "ada@example.com",
      leading: createElement("span", null, "A"),
      children: (control) =>
        createElement("input", { type: "checkbox", "aria-labelledby": control.labelId }),
    }),
  );
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox");
  expect(container.textContent).toContain("A");
  expect(wordsOf(box, "aria-labelledby")).toBe("ada@example.com");
});

test("an adornment rides the label's line but names nothing: the label alone names the control", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Theme",
      adornment: createElement("span", null, "Modified"),
      children: (control) =>
        createElement("input", { type: "checkbox", "aria-labelledby": control.labelId }),
    }),
  );
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox");
  expect(container.textContent).toContain("Modified");
  expect(wordsOf(box, "aria-labelledby")).toBe("Theme");
});

test("what a row grows below its line is read after the row's words, and its error after that", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Anthropic",
      error: "The key was refused.",
      below: () => createElement("input", { "aria-label": "Anthropic API key" }),
      children: () => createElement(Button, { children: "Add key" }),
    }),
  );
  const words = container.textContent ?? "";
  const field = container.querySelector('input[aria-label="Anthropic API key"]');
  const error = container.querySelector('[data-slot="field-error"]');
  if (field === null || error === null) throw new Error("no field or error");
  expect(words.indexOf("Add key")).toBeLessThan(words.indexOf("The key was refused."));
  expect(field.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a control as wide as the row stands under its words, named by the label and described as one at its end is", () => {
  const container = mount(
    createElement(SettingsRow, {
      label: "Avatar",
      description: "Who Luke appears as on video.",
      error: "The setting could not be saved.",
      below: (control) =>
        createElement("fieldset", {
          "aria-labelledby": control.labelId,
          "aria-describedby": control["aria-describedby"],
          "aria-invalid": control["aria-invalid"],
        }),
    }),
  );
  const group = container.querySelector("fieldset");
  if (group === null) throw new Error("no fieldset");
  expect(wordsOf(group, "aria-labelledby")).toBe("Avatar");
  expect(wordsOf(group, "aria-describedby")).toBe(
    "Who Luke appears as on video. The setting could not be saved.",
  );
  expect(group.getAttribute("aria-invalid")).toBe("true");
  // It follows the words in reading order, and before the error that describes it.
  const words = container.querySelector(".luke-settings-row-description");
  const error = container.querySelector('[data-slot="field-error"]');
  if (words === null || error === null) throw new Error("no words or error");
  expect(words.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(group.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

/** A switch's row whose words label its switch, holding the switch's state as a settings write would. */
function LabelledSwitchRow({ adornment }: { adornment?: string | undefined }): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  return createElement(SettingsRow, {
    label: "Show captions",
    description: "Words the call hears stand under its video.",
    adornment,
    labelsControl: true,
    children: (control) =>
      createElement(Switch, {
        id: control.controlId,
        checked,
        label: "Show captions",
        describedBy: control["aria-describedby"],
        onChange: setChecked,
      }),
  });
}

test("a press on a switch row's words sets its switch, as a press on the switch does, with or without an adornment", () => {
  for (const adornment of [undefined, "Modified"]) {
    const container = mount(createElement(LabelledSwitchRow, { adornment }));
    const control = container.querySelector<HTMLButtonElement>('button[role="switch"]');
    const words = [...container.querySelectorAll("*")].find(
      (element) => element.children.length === 0 && element.textContent === "Show captions",
    );
    if (control === null || !(words instanceof HTMLElement)) throw new Error("no row");
    act(() => words.click());
    expect(control.getAttribute("aria-checked")).toBe("true");
    act(() => words.click());
    expect(control.getAttribute("aria-checked")).toBe("false");
  }
});

/** The body of the rule block that opens with `prelude`, braces matched, from the row's stylesheet. */
function blockOf(prelude: string): string {
  const css = readFileSync(join(import.meta.dirname, "settings-row.css"), "utf8");
  const start = css.indexOf(prelude);
  if (start === -1) throw new Error(`no ${prelude} in the row's stylesheet`);
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at += 1) {
    if (css[at] === "{") depth += 1;
    if (css[at] === "}") depth -= 1;
    if (depth === 0) return css.slice(css.indexOf("{", start) + 1, at);
  }
  throw new Error(`${prelude} is never closed`);
}

// jsdom lays nothing out, so what a phone's width does to a row's head is read from the rules the
// browser applies there; the picture of it is the polish capture's `settings-integrations` at 390.
test("under 380px a row's end stays on the name's line and wraps below it only where it cannot fit, never stacking", () => {
  const narrow = blockOf("@container luke-settings-row (width < 380px)");
  expect(narrow).not.toMatch(/flex-direction:\s*column/);
  expect(narrow).toMatch(/\.luke-settings-row-line\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("under 380px a name is cut to one line and fades where it is cut, while the description still wraps", () => {
  const narrow = blockOf("@container luke-settings-row (width < 380px)");
  const label = /\.luke-settings-row-label:not\([^{]*\{([^}]*)\}/.exec(narrow)?.[1] ?? "";
  expect(label).toMatch(/white-space:\s*nowrap/);
  expect(label).toMatch(/mask-image:\s*linear-gradient/);
  expect(narrow).not.toMatch(/\.luke-settings-row-description[^{]*\{[^}]*nowrap/);
});
