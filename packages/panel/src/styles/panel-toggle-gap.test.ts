// @vitest-environment jsdom

import assert from "node:assert/strict";
import { IconButton, PROFILE, type Profile } from "@luke/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * panel-toggle-gap.test.ts -- the side panel's toggle, which stands on the
 * window at its top right rather than in a row, stands one gap after the
 * last control of the top row beneath it, the gap that row keeps between its
 * own controls: the plan's, an agent's, or the Inbox's toolbar, and the open
 * panel's bar, with the sidebar open or folded, the rows standing on the
 * window's frame over sheets a gap in from its edges, and in a narrow room;
 * and on the frame each row's first tab, and the toggle, stand on one line
 * with the edges of the sheets below them.
 * jsdom lays nothing out, so each length is read as the sheets declare it
 * (`testing/container-width.ts`) and measured from the window's right edge.
 * jsdom keeps a shorthand that names a custom property only as its rule's
 * text, so a side is read from the rules that reach the element, in the
 * order they are laid, which is the order they win in for these elements.
 */

beforeAll(() => {
  layContainersAt({});
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** Where each side's value stands in a box shorthand of one to four values. */
const SIDE_AT = {
  top: [0, 0, 0, 0],
  right: [0, 1, 1, 1],
  left: [0, 1, 1, 3],
} as const;

/** `value` as `element` reads it, every custom property it names spelled out, or its fallback where it names none. */
function resolved(element: Element, value: string): string {
  const style = getComputedStyle(element);
  return value.replace(
    /var\((--[\w-]+)(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g,
    (whole, name: string, fallback: string | undefined) => {
      const own = style.getPropertyValue(name).trim();
      if (own !== "") return resolved(element, own);
      return fallback === undefined ? whole : resolved(element, fallback);
    },
  );
}

/** A length in pixels from the `calc()` or bare pixel length every length these rows are built from spells out. */
function pixels(length: string): number {
  const sum = length.replace(/calc\(/g, "(").replace(/(-?[\d.]+)px/g, "$1");
  assert.match(sum, /^[\d.\s+\-*/()]+$/, length);
  // SAFETY: the expression is digits, arithmetic and parentheses alone, as the match above holds.
  return Number(new Function(`return ${sum};`)());
}

/**
 * The declarations of every rule reaching `element`, in the order they are
 * laid. Note that a selector jsdom cannot parse is passed over, because each
 * is a pseudo-element's (`::highlight`), which no element is.
 */
function reaching(element: Element): CSSStyleDeclaration[] {
  const styles: CSSStyleDeclaration[] = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      try {
        if (element.matches(rule.selectorText)) styles.push(rule.style);
      } catch {}
    }
  }
  return styles;
}

/** The value the last rule reaching `element` declares for `property`, in pixels, `0` where none does. */
function declared(element: Element, property: string): number {
  const values = reaching(element)
    .map((style) => style.getPropertyValue(property).trim())
    .filter((value) => value !== "");
  return pixels(resolved(element, values.at(-1) ?? "0"));
}

/** A side of a box `box`, margin or padding, as the last rule reaching `element` that sets it declares it, in pixels. */
function boxSide(element: Element, box: "margin" | "padding", side: keyof typeof SIDE_AT): number {
  const values = reaching(element).flatMap((style) => {
    const longhand = style.getPropertyValue(`${box}-${side}`).trim();
    if (longhand !== "") return [longhand];
    const parts = style.getPropertyValue(box).match(/calc\([^()]*(?:\([^()]*\)[^()]*)*\)|\S+/g);
    return parts === null ? [] : [parts[SIDE_AT[side][parts.length - 1] ?? 0] ?? "0"];
  });
  return pixels(resolved(element, values.at(-1) ?? "0"));
}

interface Shell {
  readonly profile: Profile;
  readonly room: "wide" | "narrow";
  readonly sidebarCollapsed: boolean;
  readonly panelOpen: boolean;
}

/** The shell as `desktop-shell.tsx` draws it with the toggle standing, and the row the toggle stands at the end of. */
function drawn({ profile, room, sidebarCollapsed, panelOpen }: Shell) {
  document.documentElement.setAttribute("data-luke-profile", profile);
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.room = room;
  shell.dataset.sidebarCollapsed = String(sidebarCollapsed);
  shell.dataset.sidebarOverlay = "closed";
  shell.dataset.panelToggle = "true";
  const main = shell.appendChild(document.createElement("main"));
  main.className = "desktop-main";
  const task = main.appendChild(document.createElement("div"));
  task.className = "desktop-task";
  task.dataset.panelOpen = String(panelOpen);
  const column = task.appendChild(document.createElement("div"));
  column.className = "desktop-task-main";
  const toolbar = column.appendChild(document.createElement("div"));
  toolbar.className = "luke-toolbar";
  // The plan's bar starts at its column's own edge (`TOOLBAR_INSET.COLUMN`), its tab leading it.
  toolbar.dataset.start = "column";
  const panel = task.appendChild(document.createElement("aside"));
  panel.className = "side-panel";
  const bar = panel.appendChild(document.createElement("div"));
  bar.className = "side-panel-bar";
  const controls = shell.appendChild(document.createElement("div"));
  controls.className = "title-bar-controls";
  controls.dataset.edge = "end";
  controls.innerHTML = renderToStaticMarkup(
    createElement(IconButton, { icon: null, label: "Show panel" }),
  );
  const toggle = controls.firstElementChild;
  assert.ok(toggle !== null);
  return { main, row: panelOpen ? bar : toolbar, controls, toggle };
}

/** The room between the row's last control and the toggle, and the gap the row keeps between its own controls. */
function gaps(shell: Shell): { beforeToggle: number; betweenControls: number } {
  const { main, row, controls, toggle } = drawn(shell);
  const rowEnd = boxSide(main, "margin", "right") + boxSide(row, "padding", "right");
  const toggleStart = declared(controls, "right") + declared(toggle, "width");
  return { beforeToggle: rowEnd - toggleStart, betweenControls: declared(row, "gap") };
}

const SHELLS: readonly Shell[] = [PROFILE.DESKTOP, PROFILE.WEB].flatMap((profile) => [
  ...[false, true].flatMap((sidebarCollapsed) =>
    [false, true].map((panelOpen) => ({
      profile,
      room: "wide" as const,
      sidebarCollapsed,
      panelOpen,
    })),
  ),
  { profile, room: "narrow" as const, sidebarCollapsed: true, panelOpen: false },
]);

test("the side panel's toggle stands one gap after the last control of the row beneath it, wherever it stands", () => {
  for (const shell of SHELLS) {
    const { beforeToggle, betweenControls } = gaps(shell);
    assert.ok(betweenControls > 0, JSON.stringify(shell));
    assert.equal(beforeToggle, betweenControls, JSON.stringify(shell));
    document.body.replaceChildren();
  }
});

test("on the frame the plan's tab and the panel's start on their sheets' edges, and the toggle ends on the panel's, or the page's while it is shut", () => {
  for (const profile of [PROFILE.DESKTOP, PROFILE.WEB]) {
    for (const panelOpen of [false, true]) {
      const shell = { profile, room: "wide" as const, sidebarCollapsed: false, panelOpen };
      const { main, row, controls } = drawn(shell);
      const where = JSON.stringify(shell);
      assert.equal(boxSide(row, "padding", "left"), 0, where);
      assert.equal(declared(controls, "right"), boxSide(main, "margin", "right"), where);
      document.body.replaceChildren();
    }
  }
});

test("on the frame with the sidebar folded, the plan's tab starts past the title bar's buttons, measured from the window's edge rather than its sheet's", () => {
  for (const profile of [PROFILE.DESKTOP, PROFILE.WEB]) {
    const shell = { profile, room: "wide" as const, sidebarCollapsed: true, panelOpen: false };
    const { main, row } = drawn(shell);
    const where = JSON.stringify(shell);
    const sheetGap = boxSide(main, "margin", "left");
    assert.ok(sheetGap > 0, where);
    assert.equal(
      sheetGap + boxSide(row, "padding", "left"),
      pixels(resolved(row, "var(--sidebar-toggle-clearance)")),
      where,
    );
    document.body.replaceChildren();
  }
});
