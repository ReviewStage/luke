// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { FormField } from "../form-field/form-field.js";
import { SettingsRow } from "../settings-row/settings-row.js";
import { TEXT_FIELD_AUTO_COMPLETE, TEXT_FIELD_TYPE, TextArea, TextField } from "./text-field.js";

/**
 * text-field.test.ts -- a text entry draws the value its caller holds and
 * hands every change back, answers Enter only when no input method is
 * composing, stays out of spell check and autofill where asked, holds its
 * form back while empty where required, hands a paste to a
 * caller that takes pasted files itself, inside a field is named, described, and marked invalid by
 * the field's words, and standing alone in a settings row is described by the row's words
 * and marked invalid while the row says its error.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** Types `value` into `field` as the page would hand it to React. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(field: HTMLElement, init: KeyboardEventInit): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** A name the caller holds, with a way to clear it and a count of Enters. */
function Name(): React.JSX.Element {
  const [name, setName] = useState("");
  const [enters, setEnters] = useState(0);
  return createElement(
    "div",
    null,
    createElement(TextField, {
      label: "Name",
      value: name,
      onChange: setName,
      onEnter: () => setEnters((count) => count + 1),
    }),
    createElement("button", { type: "button", onClick: () => setName("") }, "Clear"),
    createElement("output", { "data-name": name }, String(enters)),
  );
}

function fieldNamed(page: HTMLElement, name: string): HTMLInputElement {
  const field = page.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
  return field ?? assert.fail(`no field named ${name}`);
}

test("a text field draws what its caller holds and hands back every change", () => {
  const page = render(createElement(Name));
  const field = fieldNamed(page, "Name");
  type(field, "Ada");
  assert.equal(page.querySelector("output")?.getAttribute("data-name"), "Ada");
  act(() => page.querySelector("button")?.click());
  assert.equal(field.value, "");
});

test("Enter answers onEnter, except the Enter that commits an input method's composition", () => {
  const page = render(createElement(Name));
  const field = fieldNamed(page, "Name");
  press(field, { key: "Enter" });
  press(field, { key: "Enter", isComposing: true });
  press(field, { key: "Enter", keyCode: 229 });
  assert.equal(page.querySelector("output")?.textContent, "1");
});

test("Escape answers onEscape, except an input method's composing Escape, and every one reaches the window marked taken", () => {
  const escapes: string[] = [];
  const page = render(
    createElement(
      "div",
      null,
      createElement(TextField, {
        label: "Name",
        value: "",
        onChange: () => undefined,
        onEscape: () => escapes.push("name"),
      }),
      createElement(TextArea, {
        label: "Notes",
        value: "",
        onChange: () => undefined,
        onEscape: () => escapes.push("notes"),
      }),
    ),
  );
  const pageEscapes: KeyboardEvent[] = [];
  const listen = (event: KeyboardEvent) => pageEscapes.push(event);
  window.addEventListener("keydown", listen);
  const area = page.querySelector("textarea") ?? assert.fail("no text area");
  const presses: { field: HTMLElement; init: KeyboardEventInit }[] = [
    { field: fieldNamed(page, "Name"), init: {} },
    { field: area, init: {} },
    { field: area, init: { isComposing: true } },
    { field: area, init: { keyCode: 229 } },
  ];
  for (const { field, init } of presses) {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      field.dispatchEvent(event);
    });
  }
  window.removeEventListener("keydown", listen);
  assert.deepEqual(escapes, ["name", "notes"]);
  assert.deepEqual(
    pageEscapes.map((event) => event.defaultPrevented),
    [true, true, true, true],
    "every Escape reaches the window, marked taken",
  );
});

test("a text area holds the many lines its caller holds and hands back every change", () => {
  function Notes(): React.JSX.Element {
    const [notes, setNotes] = useState("");
    return createElement(
      "div",
      null,
      createElement(TextArea, { label: "Notes", value: notes, onChange: setNotes }),
      createElement("output", null, notes.split("\n").length),
    );
  }
  const page = render(createElement(Notes));
  const area = page.querySelector("textarea") ?? assert.fail("no text area");
  type(area, "One\nTwo");
  assert.equal(page.querySelector("output")?.textContent, "2");
  assert.equal(area.value, "One\nTwo");
});

test("a paste reaches a text area's caller, which may take it instead of the text", () => {
  function Note(): React.JSX.Element {
    const [taken, setTaken] = useState(0);
    return createElement(
      "div",
      null,
      createElement(TextArea, {
        label: "Note",
        value: "",
        onChange: () => undefined,
        grow: true,
        onPaste: (event) => {
          event.preventDefault();
          setTaken((count) => count + 1);
        },
      }),
      createElement("output", null, `${String(taken)} taken`),
    );
  }
  const page = render(createElement(Note));
  const area = page.querySelector("textarea") ?? assert.fail("no text area");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  act(() => {
    area.dispatchEvent(paste);
  });
  assert.equal(page.querySelector("output")?.textContent, "1 taken");
  assert.equal(paste.defaultPrevented, true);
});

test("a text entry asked not to is left out of the system's spell check, and is checked otherwise", () => {
  const page = render(
    createElement(
      "div",
      null,
      createElement(TextField, {
        label: "Name",
        value: "",
        onChange: () => undefined,
        spellCheck: false,
      }),
      createElement(TextArea, {
        label: "Code",
        value: "",
        onChange: () => undefined,
        spellCheck: false,
      }),
      createElement(TextField, { label: "Note", value: "", onChange: () => undefined }),
    ),
  );
  assert.equal(fieldNamed(page, "Name").getAttribute("spellcheck"), "false");
  assert.equal(page.querySelector("textarea")?.getAttribute("spellcheck"), "false");
  assert.equal(fieldNamed(page, "Note").getAttribute("spellcheck"), null);
});

test("a field asked to is left out of the system's autofill, and is the browser's to fill otherwise", () => {
  const page = render(
    createElement(
      "div",
      null,
      createElement(TextField, {
        label: "API key",
        type: TEXT_FIELD_TYPE.PASSWORD,
        autoComplete: TEXT_FIELD_AUTO_COMPLETE.OFF,
        value: "",
        onChange: () => undefined,
      }),
      createElement(TextField, { label: "Note", value: "", onChange: () => undefined }),
    ),
  );
  assert.equal(fieldNamed(page, "API key").autocomplete, "off");
  assert.equal(fieldNamed(page, "Note").getAttribute("autocomplete"), null);
});

test("a required field holds back the form it stands in while it is empty, and a field not required does not", () => {
  const submitted: string[] = [];
  const form = (name: string, required: boolean) =>
    createElement(
      "form",
      {
        "aria-label": name,
        onSubmit: (event: React.FormEvent) => {
          event.preventDefault();
          submitted.push(name);
        },
      },
      createElement(TextField, { label: name, required, value: "", onChange: () => undefined }),
    );
  const page = render(createElement("div", null, form("Address", true), form("Note", false)));

  for (const each of page.querySelectorAll("form")) act(() => each.requestSubmit());

  assert.deepEqual(submitted, ["Note"]);
  assert.equal(fieldNamed(page, "Address").validity.valueMissing, true);
});

test("inside a field, a text entry is named, described, and marked invalid by the field's words", () => {
  const page = render(
    createElement(FormField, {
      label: "Workspace name",
      description: "Everyone sees it.",
      error: "Give it a name.",
      children: (field) =>
        createElement(TextField, { field, value: "", onChange: () => undefined }),
    }),
  );
  const field = page.querySelector("input") ?? assert.fail("no field");
  assert.equal(page.querySelector(`label[for="${field.id}"]`)?.textContent, "Workspace name");
  const described = (field.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  assert.equal(described, "Everyone sees it. Give it a name.");
  assert.equal(field.getAttribute("aria-invalid"), "true");
});

test("a text entry standing alone in a settings row is described by the row's description", () => {
  const page = render(
    createElement(SettingsRow, {
      label: "Rules file",
      description: "Read from the base branch.",
      children: (control) =>
        createElement(TextField, {
          label: "Rules file",
          describedBy: control["aria-describedby"],
          value: "",
          onChange: () => undefined,
        }),
    }),
  );
  const field = page.querySelector("input") ?? assert.fail("no field");
  const describedBy = field.getAttribute("aria-describedby") ?? assert.fail("not described");
  assert.equal(document.getElementById(describedBy)?.textContent, "Read from the base branch.");
});

test("a text entry standing alone in a settings row reports itself invalid while the row shows an error, and not otherwise", () => {
  const row = (error: string | undefined) =>
    createElement(SettingsRow, {
      label: "Schedule",
      error,
      children: (control) => [
        createElement(TextField, {
          key: "cron",
          label: "Cron",
          describedBy: control["aria-describedby"],
          invalid: control["aria-invalid"],
          value: "every night",
          onChange: () => undefined,
        }),
        createElement(TextArea, {
          key: "note",
          label: "Note",
          describedBy: control["aria-describedby"],
          invalid: control["aria-invalid"],
          value: "",
          onChange: () => undefined,
        }),
      ],
    });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(row(undefined)));
  const entries = [
    container.querySelector("input") ?? assert.fail("no field"),
    container.querySelector("textarea") ?? assert.fail("no text area"),
  ];
  for (const entry of entries) assert.equal(entry.getAttribute("aria-invalid"), null);

  act(() => root.render(row("That isn't a schedule Luke can read.")));
  for (const entry of entries) assert.equal(entry.getAttribute("aria-invalid"), "true");

  act(() => root.render(row(undefined)));
  for (const entry of entries) assert.equal(entry.getAttribute("aria-invalid"), null);
});

test("a text entry is named by its field or by a label of its own, and never by neither", () => {
  // @ts-expect-error A text entry with neither a field nor a label would stand unnamed.
  createElement(TextField, { value: "", onChange: () => undefined });
  // @ts-expect-error A text area with neither a field nor a label would stand unnamed.
  createElement(TextArea, { value: "", onChange: () => undefined });
});
