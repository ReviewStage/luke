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
 * panel's bar, with the sidebar open, where the work is a sheet a gap in
 * from the window's edge, or folded, where it is not, and in a narrow room.
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
const RIGHT_OF = [0, 1, 1, 1] as const;

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

/** A length in pixels from a sum of pixel lengths, `calc()` or bare, which is every length these rows are built from. */
function pixels(length: string): number {
  const terms = length
    .replace(/calc\(|\)/g, " ")
    .trim()
    .split(/\s+/);
  let sum = 0;
  let sign = 1;
  for (const term of terms) {
    if (term === "+" || term === "-") {
      sign = term === "+" ? 1 : -1;
      continue;
    }
    const value = /^(-?[\d.]+)(px)?$/.exec(term);
    assert.ok(value?.[1] !== undefined && (value[2] === "px" || Number(value[1]) === 0), length);
    sum += sign * Number(value[1]);
  }
  return sum;
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

/** The right side of a box `side`, margin or padding, as the last rule reaching `element` that sets it declares it, in pixels. */
function rightSide(element: Element, side: "margin" | "padding"): number {
  const values = reaching(element).flatMap((style) => {
    const longhand = style.getPropertyValue(`${side}-right`).trim();
    if (longhand !== "") return [longhand];
    const parts = style.getPropertyValue(side).match(/calc\([^()]*(?:\([^()]*\)[^()]*)*\)|\S+/g);
    return parts === null ? [] : [parts[RIGHT_OF[parts.length - 1] ?? 1] ?? "0"];
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
  const rowEnd = rightSide(main, "margin") + rightSide(row, "padding");
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
