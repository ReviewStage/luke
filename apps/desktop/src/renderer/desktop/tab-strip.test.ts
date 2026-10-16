// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { layContainersAt } from "#testing/container-width";
import { onRegistry } from "#testing/copy-feedback";
import { relayout } from "#testing/resize-observer";
import { Tab, TabStrip } from "./tab-strip";

/**
 * tab-strip.test.ts -- a strip too narrow for its tabs keeps every one in
 * reach: the tabs it cuts short are not drawn as slivers at its edge, and a
 * chevron after it counts and lists them, choosing one choosing its tab. The
 * plan's column and the side panel draw this one strip, so this holds for
 * both. jsdom lays nothing out, so each test lays the strip and its tabs out
 * itself, as a row of tabs of one width. Synthetic throughout.
 */

/** The tabs a plan's column might hold, the first chosen as the strip is drawn. */
const LABELS = [
  "Teammate invitations",
  "Invite expiry job",
  "Withdraw an invite",
  "Audit retries",
  "Sweep stale invites",
] as const;

/** Each tab's width, as laid out, in CSS pixels. */
const TAB_WIDTH = 100;

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** A strip of the tabs above, choosing the one pressed, each but the first closing. */
function Strip(): ReactNode {
  const [chosen, choose] = useState(0);
  return createElement(TabStrip, {
    label: "Tabs",
    children: LABELS.map((label, at) =>
      createElement(Tab, {
        key: label,
        icon: createElement("svg"),
        label,
        selected: at === chosen,
        onSelect: () => choose(at),
        onClose: at === 0 ? undefined : ignore,
      }),
    ),
  });
}

/** Lays the strip out `width` pixels wide, its tabs in a row from its start, each `TAB_WIDTH` wide. */
function layOut(width: number): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".tab-strip")) return DOMRect.fromRect({ x: 0, width, height: 30 });
    const strip = this.closest(".tab-strip");
    if (!this.matches(".tab") || strip === null) return DOMRect.fromRect();
    const at = [...strip.querySelectorAll(".tab")].indexOf(this);
    return DOMRect.fromRect({ x: at * TAB_WIDTH - strip.scrollLeft, width: TAB_WIDTH, height: 30 });
  });
}

/** The strip drawn `width` pixels wide, with the window's stylesheets laid. */
async function drawnAt(width: number): Promise<HTMLElement> {
  layContainersAt({});
  layOut(width);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(Strip))));
  act(() => relayout());
  return container;
}

/** The chevron that lists the tabs cut short, if one is drawn. */
function chevron(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label$="more tabs"]');
}

/** The tab whose label is `label`. */
function tab(container: HTMLElement, label: string): HTMLElement {
  return (
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (each) => each.querySelector(".tab-label")?.textContent === label,
    ) ?? assert.fail(`${label}'s tab stands`)
  );
}

/** Whether a tab is drawn, rather than left out of sight at the strip's edge. */
function drawn(container: HTMLElement, label: string): boolean {
  const pill = tab(container, label).closest(".tab") ?? assert.fail("the tab has its pill");
  return getComputedStyle(pill).opacity !== "0";
}

test("a strip that holds every tab draws each of them and no chevron", async () => {
  const strip = await drawnAt(LABELS.length * TAB_WIDTH);
  assert.equal(chevron(strip), null);
  assert.deepEqual(
    LABELS.filter((label) => drawn(strip, label)),
    [...LABELS],
  );
});

test("a strip too narrow for its tabs draws only those it shows whole, and a chevron counts the rest", async () => {
  const strip = await drawnAt(250);
  assert.equal(chevron(strip)?.getAttribute("aria-label"), "3 more tabs");
  assert.deepEqual(
    LABELS.filter((label) => drawn(strip, label)),
    ["Teammate invitations", "Invite expiry job"],
  );
});

test("the chevron lists the tabs cut short in the strip's order, and choosing one chooses its tab and hands it focus", async () => {
  const strip = await drawnAt(250);
  act(() => chevron(strip)?.click());
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  assert.deepEqual(
    items.map((item) => item.querySelector(".plan-menu-label")?.textContent),
    ["Withdraw an invite", "Audit retries", "Sweep stale invites"],
  );

  act(() => items[1]?.click());
  assert.equal(tab(strip, "Audit retries").getAttribute("aria-selected"), "true");
  assert.equal(document.activeElement, tab(strip, "Audit retries"));
});
