// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FolderIcon } from "../../face/glyphs.js";
import type { FoldingButtonHint } from "../folding-button/folding-button.js";
import {
  BREADCRUMB_POPUP,
  BREADCRUMBS_VARIANT,
  type BreadcrumbHint,
  Breadcrumbs,
  type Crumb,
} from "./breadcrumbs.js";

/**
 * breadcrumbs.test.ts -- a path is one landmark under its name holding its
 * crumbs in order, the page the reader stands on said to be current; a
 * crumb with no press is words and no button; a press is handed the crumb
 * pressed; a crumb that opens something says what and whether it stands
 * open; a crumb's own name stands over its words and its hint raises its
 * words; a crumb's glyph is hidden from a reader, who hears its words, and
 * its card hangs from the app's hint, a crumb with no press's included; and
 * a toolbar's way back is a button named by its words.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom's stand-in observer for the way back's fold: jsdom lays nothing out, so nothing ever reports a resize. */
class SilentResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", SilentResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Draws a path of `crumbs` and hands back what it was drawn into. */
function draw(props: Parameters<typeof Breadcrumbs>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Breadcrumbs, props)));
  return container;
}

/** The button a reader knows by `name`. */
function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (each) => (each.getAttribute("aria-label") ?? each.textContent) === name,
  );
  if (found === undefined) throw new Error(`no button named ${name}`);
  return found;
}

test("a path is one named landmark listing its crumbs in order, the current one said to be", () => {
  const container = draw({
    label: "Path",
    crumbs: [
      { label: "acme/relay", onPress: () => undefined },
      { label: "src", onPress: () => undefined },
      { label: "index.ts", current: true, onPress: () => undefined },
    ],
  });
  const nav = container.querySelector("nav");
  expect(nav?.getAttribute("aria-label")).toBe("Path");
  const items = [...(nav?.querySelectorAll("ol > li") ?? [])];
  expect(items.map((item) => item.textContent)).toEqual(["acme/relay", "src", "index.ts"]);
  const current = [...container.querySelectorAll("[aria-current]")];
  expect(current.map((each) => [each.textContent, each.getAttribute("aria-current")])).toEqual([
    ["index.ts", "page"],
  ]);
});

test("a crumb with no press is words, and a pressed crumb is handed itself", () => {
  const pressed: HTMLElement[] = [];
  const container = draw({
    label: "Path",
    crumbs: [
      { label: "Tasks", onPress: (crumb) => pressed.push(crumb) },
      { label: "Launch", current: true },
    ],
  });
  expect([...container.querySelectorAll("button")].map((each) => each.textContent)).toEqual([
    "Tasks",
  ]);
  const tasks = button(container, "Tasks");
  act(() => tasks.click());
  expect(pressed).toEqual([tasks]);
});

test("a crumb that opens a dialog says so, and whether it stands open", () => {
  const crumbs = (expanded: boolean): Crumb[] => [
    { label: "src", popup: BREADCRUMB_POPUP.DIALOG, expanded, onPress: () => undefined },
  ];
  const container = draw({ label: "Path", crumbs: crumbs(false) });
  expect(button(container, "src").getAttribute("aria-haspopup")).toBe("dialog");
  expect(button(container, "src").getAttribute("aria-expanded")).toBe("false");
  act(() => roots[0]?.render(createElement(Breadcrumbs, { label: "Path", crumbs: crumbs(true) })));
  expect(button(container, "src").getAttribute("aria-expanded")).toBe("true");
});

test("a crumb's own name stands over its words, and the app's hint raises its hint", () => {
  const hinted: (string | undefined)[] = [];
  const Hint: FoldingButtonHint = ({ label, children }) => {
    hinted.push(label);
    return children;
  };
  const container = draw({
    label: "Path",
    hint: Hint,
    crumbs: [
      { label: "…", name: "Folders: packages/db", hint: "packages/db", onPress: () => undefined },
    ],
  });
  expect(button(container, "Folders: packages/db").textContent).toBe("…");
  expect(hinted).toContain("packages/db");
});

test("a crumb's glyph is decoration, and the app's hint hangs its card, a crumb with no press's too", () => {
  const Hint: BreadcrumbHint = ({ card, children }) =>
    createElement(
      "span",
      null,
      children,
      card === undefined ? null : createElement("aside", null, card),
    );
  const container = draw({
    label: "Path",
    hint: Hint,
    crumbs: [
      {
        label: "Nightly flake sweep",
        glyph: createElement(FolderIcon),
        hint: "Nightly flake sweep",
        card: "Runs every night at 02:00",
      },
      {
        label: "Quarantine the flaky test",
        glyph: createElement(FolderIcon),
        card: "Agent · Working",
        onPress: () => undefined,
      },
    ],
  });
  const agent = button(container, "Quarantine the flaky test");
  expect(agent.textContent).toBe("Quarantine the flaky test");
  expect(agent.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
  const cards = [...container.querySelectorAll("aside")].map((each) => each.textContent);
  expect(cards).toEqual(["Runs every night at 02:00", "Agent · Working"]);
});

test("a toolbar's way back is a button named by its words, answering a press", () => {
  const pressed: string[] = [];
  const container = draw({
    label: "Path",
    variant: BREADCRUMBS_VARIANT.TITLE,
    crumbs: [
      { label: "Issues", icon: createElement(FolderIcon), onPress: () => pressed.push("back") },
      { label: "REL-1", current: true },
    ],
  });
  act(() => button(container, "Issues").click());
  expect(pressed).toEqual(["back"]);
  expect(container.querySelector("[aria-current='page']")?.textContent).toBe("REL-1");
});
