// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PANE_FLOAT, type PaneFloat, useFloatDismiss, useHoverPane } from "./hover-pane";

/**
 * A pane that floats as the sidebar does, drawn through the module's two
 * hooks alone: its toggle opens it, its edge peeks it, and its one row is
 * a choice. A menu it raised stands beside it, and the work beside it
 * holds a button of its own.
 */
function Floating(): React.JSX.Element {
  const [state, onState] = useState<PaneFloat>(PANE_FLOAT.CLOSED);
  const float = { state, onState };
  const keep = useFloatDismiss(float);
  const pane = useHoverPane(float, {
    focusAt: (held) => held.querySelector("button"),
    stays: ".toggle",
  });
  const choose = pane.chosen(() => undefined);
  return createElement(
    "div",
    { "data-state": state },
    createElement(
      "button",
      {
        type: "button",
        className: "toggle",
        onPointerDown: keep,
        onClick: () => onState(state === PANE_FLOAT.OPEN ? PANE_FLOAT.CLOSED : PANE_FLOAT.OPEN),
      },
      "Toggle",
    ),
    createElement("div", { className: "edge", onPointerEnter: () => onState(PANE_FLOAT.PEEK) }),
    createElement(
      "aside",
      {
        ref: pane.ref,
        onPointerDown: keep,
        onPointerLeave: pane.onPointerLeave,
        onKeyDown: pane.onKeyDown,
      },
      createElement("button", { type: "button", className: "row", onClick: choose }, "Row"),
    ),
    // A menu the pane raised, which stands outside it, as a portal's does.
    createElement("div", { role: "menu", className: "menu" }),
    createElement(
      "main",
      null,
      createElement("button", { type: "button", className: "work" }, "Work"),
    ),
  );
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function mount(): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root?.render(createElement(Floating)));
  return host;
}

function part(page: HTMLElement, selector: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(selector);
  assert.ok(found, `${selector} is drawn`);
  return found;
}

function standing(page: HTMLElement): string | undefined {
  return page.querySelector<HTMLElement>("[data-state]")?.dataset.state;
}

function pressDown(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

/** The pointer crossing from `from` onto `to`, as React hears an enter and a leave. */
function pointerCross(from: Element, to: Element): void {
  act(() => {
    from.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: to }));
    to.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: from }));
  });
}

function pressEscape(target: Element): KeyboardEvent {
  const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(press);
  });
  return press;
}

test("a pane opened from away takes the keyboard where it says, and Escape in it puts it away and hands the keyboard back", () => {
  const page = mount();
  const toggle = part(page, ".toggle");
  toggle.focus();
  act(() => toggle.click());
  assert.equal(standing(page), PANE_FLOAT.OPEN);
  assert.ok(document.activeElement === part(page, ".row"), "the keyboard lands in the pane");

  const press = pressEscape(part(page, ".row"));
  assert.deepEqual([standing(page), press.defaultPrevented], [PANE_FLOAT.CLOSED, true]);
  assert.ok(document.activeElement === toggle, "the keyboard is back on the toggle");
});

test("an open pane stays for a press in it or on its toggle's press, and goes at a press outside it or once a choice in it is made", () => {
  const page = mount();
  act(() => part(page, ".toggle").click());
  pressDown(part(page, "aside"));
  assert.equal(standing(page), PANE_FLOAT.OPEN);
  pressDown(part(page, "main"));
  assert.equal(standing(page), PANE_FLOAT.CLOSED);

  act(() => part(page, ".toggle").click());
  act(() => part(page, ".row").click());
  assert.equal(standing(page), PANE_FLOAT.CLOSED);
});

test("a peek goes once the pointer leaves it, though not for the box it stays for, and Escape from the work under it puts it away", () => {
  const page = mount();
  const aside = part(page, "aside");
  const work = part(page, ".work");
  pointerCross(work, part(page, ".edge"));
  assert.equal(standing(page), PANE_FLOAT.PEEK);
  pointerCross(aside, part(page, ".toggle"));
  assert.equal(standing(page), PANE_FLOAT.PEEK, "its toggle is no way out");
  pointerCross(aside, work);
  assert.equal(standing(page), PANE_FLOAT.CLOSED);

  pointerCross(work, part(page, ".edge"));
  work.focus();
  const press = pressEscape(work);
  assert.deepEqual([standing(page), press.defaultPrevented], [PANE_FLOAT.CLOSED, true]);
});

test("the press on the toggle that opens the pane is no press inside it when the next press, outside, comes", () => {
  const page = mount();
  const toggle = part(page, ".toggle");
  pressDown(toggle);
  act(() => toggle.click());
  assert.equal(standing(page), PANE_FLOAT.OPEN);
  pressDown(part(page, "main"));
  assert.equal(standing(page), PANE_FLOAT.CLOSED);
});

test("a press in a peek leaves it a peek, gone once the pointer leaves, though not for a menu it raised", () => {
  const page = mount();
  const aside = part(page, "aside");
  const work = part(page, ".work");
  pointerCross(work, part(page, ".edge"));
  pressDown(aside);
  assert.equal(standing(page), PANE_FLOAT.PEEK, "the press opens nothing past the peek");
  pointerCross(aside, part(page, ".menu"));
  assert.equal(standing(page), PANE_FLOAT.PEEK, "a menu it raised is no way out");
  pointerCross(aside, work);
  assert.equal(standing(page), PANE_FLOAT.CLOSED);
});

test("a pane opened from away holds the keyboard against Tab until Escape hands it back", () => {
  const page = mount();
  const toggle = part(page, ".toggle");
  toggle.focus();
  act(() => toggle.click());
  // jsdom walks no focus for Tab, so the walk out is the key, then the focus it lands.
  act(() => {
    part(page, ".row").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    part(page, ".work").focus();
  });
  assert.ok(
    document.activeElement === part(page, ".row"),
    "the keyboard is brought back into the pane",
  );
  pressEscape(part(page, ".row"));
  assert.ok(document.activeElement === toggle, "Escape hands it back");
});
