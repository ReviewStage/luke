// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, test } from "vitest";
import { EXAMPLES } from "./examples.js";

/**
 * press-feedback.test.ts -- every press a shared control takes answers with
 * its pulse. Each example the catalog draws is drawn afresh for each of its
 * pressables, and each is pressed as a pointer presses it: a control the
 * press reaches marks it, on itself, on a part of it, or on the card or row
 * around it, unless the control refuses the press. A new pressable that
 * plays nothing fails here, until it answers through `pulsePress` or is
 * named below as no press at all.
 *
 * A pressable is what the platform presses (a button, a link, a summary,
 * a checkbox) or what speaks as one (its role), and what React hands a
 * click of its own, which only React's props on the element can say, so
 * it reads them there. It is a shared component's when it wears a `luke-`
 * class, since every shared control does and an example's own scaffolding
 * does not.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** An observer of what jsdom never lays out or scrolls, which tells nothing. */
class StillObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

// Note that jsdom lays nothing out, so what watches the layout is given an
// observer that never hears a change, as a page that never moves would.
globalThis.ResizeObserver ??= StillObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= StillObserver as unknown as typeof IntersectionObserver;

/** What the platform presses, or what speaks as a control pressed. */
const PRESSABLE = [
  "button",
  "summary",
  "a[href]",
  "input[type='checkbox']",
  "input[type='radio']",
  "[role='button']",
  "[role='tab']",
  "[role='option']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='switch']",
  "[role='radio']",
  "[role='checkbox']",
].join(", ");

/** What a pressable answers its press with, while it plays. */
const PULSE = "data-pulse";

/**
 * Shared elements that hear a click and are no press of their own, each
 * with why: a pulse there would answer something no one pressed.
 */
const NO_PRESS = [
  // A dialog's backdrop, whose click asks it to close; a busy one nudges instead (`dialog.tsx`).
  "dialog.luke-dialog",
  // A fold's action stands in its summary only to keep its own press from folding it.
  ".luke-disclosure-action",
  // A portal's fence only keeps what the controls it holds took from the tree around it (`portal-fence.tsx`).
  ".luke-portal-fence",
  // A document's block, whose press puts a caret in its words to edit them, as a document editor does (`editable-block.tsx`).
  ".luke-editable-block",
  // Words a hint hangs from, whose tap shows the hint rather than pressing anything (`hint.tsx`).
  ".luke-one-line",
  "span.luke-inline-ref",
  // A turn of a conversation, whose tap on a touch screen shows its actions rather than pressing anything (`message.tsx`).
  ".luke-message",
  // A field's words, which a press places the caret in.
  "input:not([type='checkbox'], [type='radio'])",
  "textarea",
].join(", ");

const roots: Root[] = [];

afterEach(() => {
  clear();
});

/** Clears the page of every example drawn on it. */
function clear(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
}

/** Draws `Render` into a fresh container on the page. */
function draw(Render: () => React.JSX.Element): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Render)));
  return container;
}

/** The props React drew `element` with, where React drew it. */
function reactProps(element: Element): Record<string, unknown> | undefined {
  const key = Object.keys(element).find((name) => name.startsWith("__reactProps$"));
  return key === undefined ? undefined : (Reflect.get(element, key) as Record<string, unknown>);
}

/** Whether `element` wears one of the shared components' classes. */
function shared(element: Element): boolean {
  return [...element.classList].some((name) => name.startsWith("luke-"));
}

/** The shared pressables in `page`, in the page's order. */
function pressables(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>("*")].filter((element) => {
    if (!shared(element) || element.matches(NO_PRESS)) return false;
    return element.matches(PRESSABLE) || typeof reactProps(element)?.onClick === "function";
  });
}

/** Whether `element` refuses a press, as an unavailable control does. */
function refuses(element: HTMLElement): boolean {
  return (
    element.matches(":disabled, [aria-disabled='true'], [inert] *, [inert]") ||
    element.closest("fieldset:disabled") !== null
  );
}

/** A description of `element` a failure can be found by. */
function named(element: HTMLElement): string {
  const words = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
  return `<${element.localName} class="${element.className}"> "${words.slice(0, 40)}"`;
}

/** Presses `element` as a pointer does, with `chord` held: down, up, and the click. */
function press(element: HTMLElement, chord: boolean): void {
  const init = { bubbles: true, cancelable: true, button: 0, metaKey: chord, ctrlKey: chord };
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerdown", init));
    element.dispatchEvent(new MouseEvent("mousedown", init));
    element.dispatchEvent(new MouseEvent("pointerup", init));
    element.dispatchEvent(new MouseEvent("mouseup", init));
    element.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
  });
}

/** Whether a pulse began on `element`, on a part of it, or around it, among `records`. */
function pulsed(element: HTMLElement, records: MutationRecord[]): boolean {
  return records.some((record) => {
    const target = record.target;
    if (!(target instanceof Element) || target.getAttribute(PULSE) === null) return false;
    return target.contains(element) || element.contains(target);
  });
}

/** Presses `element` plainly, then with ⌘ held where a plain press played nothing, as words that open on the chord do. */
function answers(element: HTMLElement): boolean {
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: [PULSE] });
  try {
    press(element, false);
    if (pulsed(element, observer.takeRecords())) return true;
    if (!element.isConnected) return false;
    press(element, true);
    return pulsed(element, observer.takeRecords());
  } finally {
    observer.disconnect();
  }
}

// Note that a link's click would ask jsdom to navigate, which it cannot.
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a[href]") !== null) {
    event.preventDefault();
  }
});

/** What tells one kind of pressable from another: its element, its role, and its shared classes. */
function kindOf(element: HTMLElement): string {
  const classes = [...element.classList].filter((name) => name.startsWith("luke-")).sort();
  return [element.localName, element.getAttribute("role") ?? "", ...classes].join(" ");
}

/** Where in `page`'s order the first pressable of each kind stands that takes a press. */
function firstOfEachKind(page: HTMLElement): number[] {
  const kinds = new Map<string, number>();
  for (const [at, element] of pressables(page).entries()) {
    const kind = kindOf(element);
    if (!kinds.has(kind) && !refuses(element)) kinds.set(kind, at);
  }
  return [...kinds.values()];
}

// Note that each example is a test of its own, so the guard's time grows by
// one example's per example added rather than against one test's timeout.
describe.each(EXAMPLES)("$id", (example) => {
  test("every kind of shared pressable it draws pulses when pressed", () => {
    const silent: string[] = [];
    for (const at of firstOfEachKind(draw(example.Render))) {
      // Note that each is pressed on a page drawn afresh, so no press before it has opened, closed, or moved it.
      clear();
      const element = pressables(draw(example.Render))[at];
      if (element === undefined) continue;
      if (!answers(element)) silent.push(named(element));
    }
    assert.deepEqual(silent, [], "these pressables play no pulse when pressed");
  });
});

test("the catalog draws enough kinds of shared pressable to press", () => {
  let counted = 0;
  for (const example of EXAMPLES) {
    counted += firstOfEachKind(draw(example.Render)).length;
    clear();
  }
  assert.ok(counted > 50, `only ${counted} pressables were pressed`);
});
