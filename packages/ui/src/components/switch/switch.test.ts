// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Switch, SwitchMark } from "./switch.js";

/**
 * switch.test.ts -- a switch is a control of its own, named by its label,
 * toggled by a press, and described by the words its caller points it at;
 * its drawing alone, inside a row that is the switch, is hidden from a
 * reader and takes no press of its own.
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

function switchNamed(page: HTMLElement, name: string): HTMLElement {
  return (
    page.querySelector<HTMLElement>(`[role="switch"][aria-label="${name}"]`) ??
    assert.fail(`no switch named ${name}`)
  );
}

/** A switch whose state the caller holds. */
function Notify(): React.JSX.Element {
  const [on, setOn] = useState(false);
  return createElement(Switch, {
    checked: on,
    label: "Notify when an agent finishes",
    onChange: setOn,
  });
}

test("a switch is named by its label and each press asks for the other state", () => {
  const page = render(createElement(Notify));
  const control = switchNamed(page, "Notify when an agent finishes");
  act(() => control.click());
  assert.equal(control.getAttribute("aria-checked"), "true");
  act(() => control.click());
  assert.equal(control.getAttribute("aria-checked"), "false");
});

test("the drawing alone is hidden from a reader, and the row around it is the switch", () => {
  function Row(): React.JSX.Element {
    const [on, setOn] = useState(true);
    return createElement(
      "button",
      { type: "button", role: "menuitemcheckbox", "aria-checked": on, onClick: () => setOn(!on) },
      "Archive runs",
      createElement(SwitchMark, { checked: on }),
    );
  }
  const page = render(createElement("div", { role: "menu" }, createElement(Row)));
  assert.equal(page.querySelectorAll('[role="switch"]').length, 0);
  const row = page.querySelector<HTMLElement>('[role="menuitemcheckbox"]') ?? assert.fail("no row");
  assert.equal(row.querySelectorAll(':not([aria-hidden="true"]) > [aria-hidden="true"]').length, 1);
  act(() => row.click());
  assert.equal(row.getAttribute("aria-checked"), "false");
});

test("a switch is described by the words its caller points it at, by either name", () => {
  const page = render(
    createElement(
      "div",
      null,
      createElement("p", { id: "alerts-note" }, "Sends one notice an hour."),
      createElement(Switch, {
        checked: true,
        label: "Alerts",
        onChange: () => undefined,
        "aria-describedby": "alerts-note",
      }),
      createElement(Switch, {
        checked: true,
        label: "Digest",
        onChange: () => undefined,
        describedBy: "alerts-note",
      }),
    ),
  );
  for (const name of ["Alerts", "Digest"]) {
    const described = switchNamed(page, name).getAttribute("aria-describedby") ?? "";
    assert.equal(document.getElementById(described)?.textContent, "Sends one notice an hour.");
  }
});
