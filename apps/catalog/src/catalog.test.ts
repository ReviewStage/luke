// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Catalog, readView } from "./catalog.js";

/**
 * catalog.test.ts -- an address that asks for a width frames its example at
 * that width, and every other way to change the view keeps it; an address
 * that asks for none, or for one out of range, draws the example at the
 * stage's own width. jsdom lays nothing out, so the frame's width is read
 * from the style the page gives it.
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

/** The catalog drawn into the page at the view `address` asks for. */
function open(address: string): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Catalog, { view: readView(address) })));
  return container;
}

/** The frame the example is drawn in, if the page frames it. */
function frameOf(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>("main .catalog-width-frame");
}

test("an example asked for at 390 is framed at 390 pixels", () => {
  const page = open("?example=badges&profile=web&theme=light&width=390");
  const frame = frameOf(page);
  assert.ok(frame, "the example is framed");
  assert.equal(frame.style.inlineSize, "390px");
  assert.ok(frame.textContent?.length, "the example draws inside the frame");
});

test("every other way to change the view keeps the width", () => {
  const page = open("?example=badges&width=390");
  const links = [...page.querySelectorAll<HTMLAnchorElement>("nav a, [aria-label=Theme] a")];
  assert.ok(links.length > 2);
  for (const link of links) {
    assert.equal(new URLSearchParams(link.search).get("width"), "390", link.href);
  }
  const field = page.querySelector<HTMLInputElement>("input[name=width]");
  assert.equal(field?.value, "390");
});

test("an address naming no width, or one out of range, draws no frame", () => {
  for (const address of [
    "?example=badges",
    "?example=badges&width=12",
    "?example=badges&width=wide",
  ]) {
    const page = open(address);
    assert.equal(frameOf(page), null, address);
    assert.ok(page.querySelector("main")?.textContent?.includes("Badges"), address);
    act(() => roots.pop()?.unmount());
    page.remove();
  }
});

test("a width typed and applied submits it with the rest of the view", () => {
  const page = open("?example=badges&profile=web&theme=light&width=390");
  const field = page.querySelector<HTMLInputElement>("input[name=width]");
  assert.ok(field);
  // React tracks a field's value through the element's own setter, so a typed value goes in through it, as a keystroke's would.
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, "414");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const apply = [...page.querySelectorAll("button")].find(
    (button) => button.textContent === "Apply",
  );
  assert.ok(apply);
  // jsdom cannot navigate, so the submission is read where the browser would send it, from the form's own data.
  const form = apply.form;
  assert.ok(form);
  let submitted: URLSearchParams | undefined;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitted = new URLSearchParams(
      [...new FormData(form)].map(([name, value]) => [name, String(value)]),
    );
  });
  act(() => apply.click());
  assert.equal(submitted?.get("width"), "414");
  assert.equal(submitted?.get("example"), "badges");
  assert.equal(submitted?.get("profile"), "web");
  assert.equal(submitted?.get("theme"), "light");
  assert.equal(form.method, "get");
});
