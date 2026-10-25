// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  DIFF_FONT,
  DIFF_INDICATORS,
  DIFF_LAYOUT,
  DIFF_LINE_HEIGHT,
  INLINE_DIFF,
} from "@luke/settings/diff-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { sideBundles } from "../bundle-loader.js";
import {
  type DiffLook,
  type DiffViewModule,
  GAP_CONTROL,
  GAP_CONTROL_ATTRIBUTE,
} from "../diff-view/contract.js";
import { diffView } from "../diff-view/index.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { onSideBundles } from "../testing/side-bundles.js";
import { type DiffListEntry, PierreDiffList } from "./diff-list.js";

/**
 * diff-list.test.ts -- Files changed's list while its bundle is still on its
 * way: the place says the changes are being read, as the tab does while it
 * reads them, rather than standing empty, and stays busy until the list
 * has drawn its first file. The bundle is the real one, held back until the
 * test lets it land, as a slow connection holds it on the web.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOOK: DiffLook = {
  layout: DIFF_LAYOUT.UNIFIED,
  indicators: DIFF_INDICATORS.BARS,
  inlineDiff: INLINE_DIFF.WORD_ALT,
  backgrounds: true,
  lineNumbers: true,
  wrap: false,
  themes: { dark: "github-dark-default", light: "github-light-default" },
  font: DIFF_FONT.SF_MONO,
  fontSize: "11.5",
  lineHeight: DIFF_LINE_HEIGHT.NORMAL,
  ligatures: false,
};

const ENTRY: DiffListEntry = {
  path: "src/members/invite.ts",
  patch: [
    "diff --git a/src/members/invite.ts b/src/members/invite.ts",
    "--- a/src/members/invite.ts",
    "+++ b/src/members/invite.ts",
    "@@ -1,1 +1,2 @@",
    " const a = 1;",
    "+const b = 2;",
  ].join("\n"),
  collapsed: false,
  lead: false,
  expandable: false,
  header: "invite.ts",
  notes: [],
};

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Lets the bundle's import land, and Pierre's next two frames, in which it draws the list. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
    for (let frame = 0; frame < 2; frame += 1) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
    }
  });
}

test("while the diff bundle is on its way the list says the changes are being read, and is busy until it has drawn a file", async () => {
  const held = Promise.withResolvers<DiffViewModule>();
  const bundles = sideBundles({ diffView: () => held.promise });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        onSideBundles(
          bundles,
          createElement(PierreDiffList, {
            entries: [ENTRY],
            look: LOOK,
            door: { current: null },
            onTopFile: () => {},
            boxRef: () => {},
          }),
        ),
      ),
    ),
  );
  await settle();
  const list = () => container.querySelector(".diff-list");
  assert.equal(container.querySelector('[role="status"]')?.textContent, "Reading changes");
  assert.equal(list()?.getAttribute("aria-busy"), "true");
  assert.equal(container.querySelector("[data-diff-list-scroller]"), null);

  held.resolve(diffView);
  await settle();
  assert.equal(container.querySelector('[role="status"]'), null);
  assert.ok(container.querySelector("[data-diff-list-scroller] .diff-list-head-slot"));
  assert.equal(list()?.getAttribute("aria-busy"), null, "busy no longer once a file is drawn");
});

test("a gap control's hint, once the pointer presses or leaves, is drawn through its exit and goes when the exit has finished", async () => {
  const motion = new EventTarget();
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value(this: HTMLElement) {
      return this.hasAttribute("data-leaving") ? [motion] : [];
    },
  });
  try {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        onRegistry(
          AtomRegistry.make(),
          onSideBundles(
            sideBundles({ diffView: async () => diffView }),
            createElement(PierreDiffList, {
              entries: [ENTRY],
              look: LOOK,
              door: { current: null },
              onTopFile: () => {},
              boxRef: () => {},
            }),
          ),
        ),
      ),
    );
    await settle();
    const gap = document.createElement("button");
    gap.setAttribute(GAP_CONTROL_ATTRIBUTE, GAP_CONTROL.ALL);
    gap.setAttribute("aria-label", "Show 12 hidden lines");
    container.querySelector(".diff-list")?.append(gap);
    const pill = () => document.querySelector('[role="tooltip"]');

    restOn(gap);
    assert.equal(pill()?.textContent, "Show 12 hidden lines");
    assert.equal(pill()?.hasAttribute("data-leaving"), false);

    act(() => {
      gap.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    assert.equal(pill()?.hasAttribute("data-leaving"), true, "the pill fades rather than snaps");
    act(() => {
      motion.dispatchEvent(new Event("finish"));
    });
    assert.equal(pill(), null, "and goes once its exit has played");
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  }
});
