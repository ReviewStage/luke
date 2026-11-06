// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { EMAIL_CHIP_STATE, type EmailChip, EmailChipsField } from "../../index.js";

/**
 * email-chips-field.test.ts -- words typed become chips at a comma, or at a
 * space once they hold an address, and a pasted list lands whole; Backspace in empty words takes the last address
 * back to edit; an address sent stands with no ×; and why an address is
 * wrong is its chip's hint, which describes it to a reader.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** Stands in for the browser's ResizeObserver, which jsdom lacks, since a chip's words measure whether they are cut short. */
class StandInResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** A field whose caller splits words at spaces and commas and holds the chips, as a form would. */
function Held({ start }: { start: readonly EmailChip[] }): React.JSX.Element {
  const [chips, setChips] = useState(start);
  const [typed, setTyped] = useState("");
  return createElement(EmailChipsField, {
    chips,
    typed,
    onTyped: setTyped,
    label: "Invite",
    placeholder: "name@example.com",
    onAdd: (typed: string) =>
      setChips((now) => [
        ...now,
        ...typed
          .split(/[\s,]+/u)
          .filter((one) => one !== "")
          .map((one) => ({
            id: one,
            words: one,
            typed: one,
            state: one.includes("@") ? EMAIL_CHIP_STATE.DRAFT : EMAIL_CHIP_STATE.BAD,
            reason: one.includes("@") ? undefined : "Not an email address",
          })),
      ]),
    onRemove: (id: string) => setChips((now) => now.filter((chip) => chip.id !== id)),
  });
}

function render(start: readonly EmailChip[] = []): HTMLInputElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Held, { start })));
  const words = container.querySelector("input");
  assert.ok(words instanceof HTMLInputElement);
  return words;
}

/** Types `value` into the words as React hears a keystroke. */
function type(words: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(words, value);
    words.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function chipWords(): string[] {
  return [...document.querySelectorAll(".ui-chip-name")].map((one) => one.textContent ?? "");
}

test("a comma ends an address, a space only once the words hold one, and a pasted list lands in one press", () => {
  const words = render();
  type(words, "Dana ");
  assert.deepEqual(chipWords(), [], "a name typed before its address stays whole");
  type(words, "dana@acme.dev,");
  assert.deepEqual(chipWords(), ["dana@acme.dev"]);
  assert.equal(words.value, "");

  // A list pasted over words selected replaces them, rather than landing beside them.
  type(words, "theo@acme");
  words.setSelectionRange(0, words.value.length);
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(paste, { clipboardData: { getData: () => "theo@acme.dev priya@acme.dev" } });
  act(() => words.dispatchEvent(paste));
  assert.deepEqual(chipWords(), ["dana@acme.dev", "theo@acme.dev", "priya@acme.dev"]);
});

test("Backspace in empty words takes the last address back to edit, but never one already sent", () => {
  const sent: EmailChip = {
    id: "sent",
    words: "dana@acme.dev",
    typed: "dana@acme.dev",
    state: EMAIL_CHIP_STATE.SENT,
  };
  const words = render([sent]);
  type(words, "theo@acme.de ");
  act(() => words.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
  assert.deepEqual(chipWords(), ["dana@acme.dev"]);
  assert.equal(words.value, "theo@acme.de");

  type(words, "");
  act(() => words.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })));
  assert.deepEqual(chipWords(), ["dana@acme.dev"]);
  assert.equal(document.querySelector('[aria-label="Remove dana@acme.dev"]'), null);
});

test("why an address is wrong is its chip's description, and no line under the field", () => {
  const words = render();
  type(words, "dana,");
  const chip = [...document.querySelectorAll("button")].find((each) => each.textContent === "dana");
  const describedBy = chip?.getAttribute("aria-describedby");
  assert.ok(describedBy !== null && describedBy !== undefined, "the chip's words are described");
  assert.equal(document.getElementById(describedBy)?.textContent, "Not an email address");
  assert.equal(
    words.getAttribute("aria-describedby"),
    null,
    "the words typed carry no reason of their own",
  );

  const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove dana"]');
  act(() => remove?.click());
  assert.equal(
    document.activeElement,
    words,
    "the caret comes back to the words once the chip is lifted",
  );
});
