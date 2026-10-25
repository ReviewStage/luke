// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { NOT_FOUND_THING, NotFound, Toolbar, type ToolbarProps } from "./toolbar.js";

/**
 * toolbar.test.ts -- a workspace's bar reads its lead, its title as the
 * page's heading, the tag after it, and its actions, in that order, drawing
 * only the slots that say something, and its actions end it even with no
 * title; a page with a parent leads its heading with its trail, each
 * place a press back to it and the page's own name last, words that are no
 * press, said to be the current page; and a place that is not found keeps
 * its bar above the words saying so.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

/** Draws `element` into the page and answers the box it stands in. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** Draws a bar holding `props` and answers its banner. */
function bar(props: ToolbarProps): HTMLElement {
  return draw(createElement(Toolbar, props)).querySelector("header") ?? assert.fail("no bar");
}

/** The text of each of the bar's own parts, in the order they stand. */
function parts(banner: HTMLElement): string[] {
  return [...banner.children].map((part) => part.textContent ?? "");
}

test("the bar reads its lead, its title, the tag after it, and its actions, in that order", () => {
  const banner = bar({
    lead: createElement("span", null, "Back"),
    title: "New thread",
    tag: createElement("span", null, "Experiment"),
    actions: createElement("span", null, "Discard"),
  });

  assert.deepEqual(parts(banner), ["Back", "New threadExperiment", "Discard"]);
  const heading = banner.querySelector("h1") ?? assert.fail("no heading");
  assert.equal(heading.textContent, "New thread");
});

test("a bar draws only the slots that say something, and its actions end it with no title", () => {
  const banner = bar({
    lead: false,
    title: "",
    tag: null,
    actions: createElement("span", null, "New"),
  });

  assert.deepEqual(parts(banner), ["", "New"]);
  assert.equal(banner.querySelector("h1"), null);
  assert.equal(banner.lastElementChild?.textContent, "New");
});

test("a title that is more than words stands in the title's place as given", () => {
  const banner = bar({
    title: createElement("input", { "aria-label": "Name", defaultValue: "Inbox" }),
  });

  assert.equal(banner.querySelector("h1"), null);
  assert.equal(banner.querySelector<HTMLInputElement>("input[aria-label='Name']")?.value, "Inbox");
});

test("a trail leads the heading with each place above the page, the page's own name last and no press", () => {
  // jsdom lacks the ResizeObserver a folding way back measures its fold by, and lays nothing out to measure.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const pressed: string[] = [];
  const banner = bar({
    title: "Nightly triage",
    trail: [
      { label: "Workspace", onPress: () => pressed.push("Workspace") },
      {
        label: "Automations",
        icon: createElement("svg"),
        onPress: () => pressed.push("Automations"),
      },
    ],
  });
  const path = banner.querySelector("nav") ?? assert.fail("no trail");
  const crumbs = [...path.querySelectorAll("li")];

  assert.equal(path.getAttribute("aria-label"), "Path");
  assert.deepEqual(
    crumbs.map((crumb) => crumb.textContent),
    ["Workspace", "Automations", "Nightly triage"],
  );
  const current = crumbs.at(-1) ?? assert.fail("no current page");
  assert.equal(current.querySelector("[aria-current='page']")?.textContent, "Nightly triage");
  assert.equal(current.querySelector("button, a"), null);
  for (const crumb of crumbs.slice(0, -1)) {
    act(() => (crumb.querySelector("button") ?? assert.fail("no press")).click());
  }
  assert.deepEqual(pressed, ["Workspace", "Automations"]);
});

test("a place not found keeps its bar, its way back pressable, above the words saying so", () => {
  let backed = false;
  const region = draw(
    createElement(NotFound, {
      thing: NOT_FOUND_THING.AUTOMATION,
      bar: {
        lead: createElement(
          "button",
          { type: "button", onClick: () => (backed = true) },
          "Automations",
        ),
      },
    }),
  );
  const page = region.querySelector("section") ?? assert.fail("no page");
  const banner = page.firstElementChild;

  assert.equal(banner?.tagName, "HEADER");
  assert.match(page.textContent ?? "", /Not found/);
  assert.match(
    page.textContent ?? "",
    /This automation doesn't exist, or you don't have access to it\./,
  );
  const way = banner?.querySelector("button") ?? assert.fail("no way back");
  act(() => way.click());
  assert.ok(backed);
});

test("a not-found state under a bar already drawn draws no second bar", () => {
  const region = draw(createElement(NotFound, { thing: NOT_FOUND_THING.TASK }));

  assert.equal(region.querySelector("header"), null);
  assert.match(region.textContent ?? "", /This task doesn't exist/);
});

test("a document's trail leads its bar, and its name joins the trail as the current page only once its header has scrolled away", () => {
  // jsdom lacks the ResizeObserver a folding way back measures its fold by.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const trail = [{ label: "Automations", icon: createElement("svg"), onPress: () => undefined }];
  const crumbs = (shown: boolean): string[] => {
    const banner = bar({ trail, pickUp: { name: "Nightly triage", shown } });
    return [...banner.querySelectorAll("nav li")].map((crumb) => crumb.textContent ?? "");
  };

  assert.deepEqual(crumbs(false), ["Automations"]);
  document.body.replaceChildren();
  assert.deepEqual(crumbs(true), ["Automations", "Nightly triage"]);
});

test("a document's trail stands alone while its name is not yet read", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  const banner = bar({
    trail: [{ label: "Automations", icon: createElement("svg"), onPress: () => undefined }],
    pickUp: { name: "", shown: false },
  });

  assert.deepEqual(
    [...banner.querySelectorAll("nav li")].map((crumb) => crumb.textContent),
    ["Automations"],
  );
});
