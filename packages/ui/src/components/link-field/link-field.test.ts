// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { LinkField } from "./link-field.js";

/**
 * link-field.test.ts -- the popover a link is written in: it opens with the
 * caret in its field, holding the link already there; Enter hands its
 * owner the address typed, trimmed, and Escape gives up; Open and Remove
 * stand only beside a link already there, each told when pressed.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** What a test's field told its owner, in order. */
type Told = string[];

/** The field over words linked to `href`, or none. */
function mount(href?: string): { popover: HTMLElement; field: HTMLInputElement; told: Told } {
  const told: Told = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(LinkField, {
        href,
        onApply: (typed) => told.push(`apply ${typed}`),
        onCancel: () => told.push("cancel"),
        onOpen: () => told.push("open"),
        onRemove: () => told.push("remove"),
      }),
    ),
  );
  const field = container.querySelector("input");
  if (field === null) throw new Error("the field is drawn");
  return { popover: container, field, told };
}

/** Types `words` into `field` as a person would, replacing what it holds. */
function type(field: HTMLInputElement, words: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses `key` in `field`. */
function key(field: HTMLInputElement, key: string): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The names of the popover's buttons. */
function buttons(popover: HTMLElement): string[] {
  return [...popover.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );
}

test("words not linked yet open an empty field, named and holding the caret, with no Open or Remove", () => {
  const { popover, field } = mount();
  expect(field.getAttribute("aria-label")).toBe("Link");
  expect(field.placeholder).toBe("Paste or type a link");
  expect(field.value).toBe("");
  expect(document.activeElement).toBe(field);
  expect(buttons(popover)).toEqual([]);
});

test("Enter hands the owner the address typed, its ends trimmed", () => {
  const { field, told } = mount();
  type(field, "  https://example.com/a ");
  key(field, "Enter");
  expect(told).toEqual(["apply https://example.com/a"]);
});

test("Escape gives up", () => {
  const { field, told } = mount("https://example.com");
  type(field, "https://elsewhere.dev");
  key(field, "Escape");
  expect(told).toEqual(["cancel"]);
});

test("a link already there opens in the field, with Open and Remove beside it", () => {
  const { popover, field, told } = mount("https://example.com");
  expect(field.value).toBe("https://example.com");
  expect(buttons(popover)).toEqual(["Open link", "Remove link"]);
  for (const button of popover.querySelectorAll("button")) act(() => button.click());
  expect(told).toEqual(["open", "remove"]);
});
