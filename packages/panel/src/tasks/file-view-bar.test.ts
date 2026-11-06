// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { FileViewBar } from "./file-view.js";

const PAGE = "https://github.com/acme/relay/pull/42/files";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function barOver(github: { href: string; open: (url: string) => void } | undefined): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(FileViewBar, { lead: null, github, menu: null }),
      ),
    ),
  );
  return container;
}

test("Open on GitHub is a link to the page, which the window opens itself rather than the browser following it", () => {
  const opened: string[] = [];
  const bar = barOver({ href: PAGE, open: (url) => opened.push(url) });

  const link = bar.querySelector<HTMLAnchorElement>('a[aria-label="Open on GitHub"]');
  assert.equal(link?.getAttribute("href"), PAGE);
  assert.equal(bar.querySelector('button[aria-label="Open on GitHub"]'), null);
  const clicked = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    link?.dispatchEvent(clicked);
  });
  assert.equal(clicked.defaultPrevented, true);
  assert.deepEqual(opened, [PAGE]);
});

test("Open on GitHub stands dimmed, and is no link, while the page it opens is not known", () => {
  const bar = barOver(undefined);

  const button = bar.querySelector<HTMLButtonElement>('button[aria-label="Open on GitHub"]');
  assert.equal(button?.disabled, true);
  assert.equal(bar.querySelector('a[aria-label="Open on GitHub"]'), null);
});
