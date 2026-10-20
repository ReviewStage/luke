// @vitest-environment jsdom

import assert from "node:assert/strict";
import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { NavItem, SearchField } from "@luke/ui";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { SwitchRow } from "./settings/switch-row.js";
import { Shortcut } from "./shortcut.js";
import { layContainersAt, shown } from "./testing/container-width.js";

/**
 * touch-hints.test.ts -- under a finger, a touch screen's (no hover, a
 * coarse pointer), no keyboard chord is drawn as a hint: not a hover's or a
 * button's chord, not a sidebar row's, whose count stays in its place, not
 * a search field's summons, and not the command palette's foot of keys;
 * a chord that is a row's whole value still is. A switch's row on a phone
 * keeps its switch beside its words. With a mouse each stands as before.
 * jsdom lays nothing out, so the stylesheets are laid for each device and
 * width (`testing/container-width.ts`). Synthetic throughout.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A settings row's width on a 390px phone, the screen less the page's and the card's insets. */
const PHONE_ROW = 342;

const CHORD = { key: SHORTCUT_KEY.K } as const;

const ignore = () => undefined;

const roots: Root[] = [];

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  laid?.remove();
  laid = undefined;
});

/** Draws `element` into the document. */
function mount(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The element `selector` finds in `within`, which must stand there. */
function found(within: ParentNode, selector: string): Element {
  const element = within.querySelector(selector);
  assert.ok(element !== null, `${selector} stands`);
  return element;
}

/** What each hint draws on the device given: a chord, a sidebar row's chord, a row's count beside its chord, a search field's chord, the palette's foot, and a value chord. */
function hintsOn(touch: boolean) {
  laid = layContainersAt({}, { touch });
  const page = mount(
    createElement(
      "div",
      null,
      createElement(Shortcut, { chord: CHORD, className: "tooltip-chord" }),
      createElement(
        "div",
        { className: "home-row" },
        createElement(NavItem, {
          shortcut: createElement(Shortcut, { chord: CHORD }),
          onClick: ignore,
          children: "Home",
        }),
      ),
      createElement(NavItem, {
        shortcut: createElement(Shortcut, { chord: CHORD }),
        count: { value: 3 },
        onClick: ignore,
        children: "Inbox",
      }),
      createElement(SearchField, {
        label: "Search settings",
        value: "",
        onChange: ignore,
        shortcut: createElement(Shortcut, { chord: CHORD }),
      }),
      createElement(
        "div",
        { className: "command-palette-footer" },
        createElement(Shortcut, { chord: CHORD }),
        "Open",
      ),
      createElement(
        "div",
        { className: "value-row" },
        createElement(Shortcut, { chord: CHORD, className: "shortcut-value", spoken: true }),
      ),
    ),
  );
  return {
    chord: shown(found(page, ".tooltip-chord")),
    rowChord: shown(found(page, ".home-row .luke-nav-item-shortcut")),
    rowCount: shown(found(page, ".luke-nav-item-count")),
    fieldChord: shown(found(page, ".luke-search-field .shortcut")),
    paletteFoot: shown(found(page, ".command-palette-footer")),
    value: shown(found(page, ".value-row .shortcut")),
  };
}

test("under a finger no chord is drawn as a hint, a row's count stays, and a chord that is a row's value still stands", () => {
  assert.deepEqual(hintsOn(true), {
    chord: false,
    rowChord: false,
    rowCount: true,
    fieldChord: false,
    paletteFoot: false,
    value: true,
  });
});

test("with a mouse every chord stands as before", () => {
  assert.deepEqual(hintsOn(false), {
    chord: true,
    rowChord: true,
    rowCount: true,
    fieldChord: true,
    paletteFoot: true,
    value: true,
  });
});

test("on a phone a switch's row keeps its switch beside its words rather than under them", () => {
  laid = layContainersAt({ "luke-settings-row": PHONE_ROW }, { touch: true });
  const page = mount(
    createElement(SwitchRow, {
      label: "Line numbers",
      detail: "In File tabs and diffs alike.",
      checked: true,
      onChange: ignore,
    }),
  );
  assert.notEqual(getComputedStyle(found(page, ".luke-settings-row-line")).flexDirection, "column");
});
