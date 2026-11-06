// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Button, PROFILE, type Profile, TextLink } from "@repo/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

function drawnAt(profile: Profile, element: ReactElement): HTMLElement {
  laid ??= layContainersAt(
    {},
    { only: ["@repo/ui/tokens.css", "./base.css", "@repo/ui/styles.css", "tailwind.css"] },
  );
  const surface = document.body.appendChild(document.createElement("div"));
  surface.dataset.uiProfile = profile;
  const root = createRoot(surface);
  roots.push(root);
  act(() => root.render(element));
  return surface;
}

function cursorOf(element: Element): string {
  const style = getComputedStyle(element);
  const named = /^var\((--[\w-]+)\)$/u.exec(style.cursor)?.[1];
  return named === undefined ? style.cursor : style.getPropertyValue(named).trim();
}

function the(surface: HTMLElement, selector: string): HTMLElement {
  return surface.querySelector<HTMLElement>(selector) ?? assert.fail(selector);
}

test("a button gives the Mac's arrow in the desktop's window and the pointing hand on the web", () => {
  const button = createElement(Button, { onClick: () => undefined, children: "Save" });
  assert.equal(cursorOf(the(drawnAt(PROFILE.DESKTOP, button), "button")), "default");
  assert.equal(cursorOf(the(drawnAt(PROFILE.WEB, button), "button")), "pointer");
});

test("a link to a page keeps the pointing hand in the desktop's window", () => {
  const link = createElement(TextLink, {
    href: "https://example.com/docs",
    children: "Read the docs",
  });
  assert.equal(cursorOf(the(drawnAt(PROFILE.DESKTOP, link), "a")), "pointer");
});
