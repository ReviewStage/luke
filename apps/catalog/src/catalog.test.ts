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
  return page.querySelector<HTMLElement>("main .catalog-frame");
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
