// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFILE, type Profile } from "@luke/ui";
import { afterEach, beforeAll, test } from "vitest";

/** The traffic lights' width, which only the desktop's window reserves room for. */
const TRAFFIC_LIGHTS_END = "79px";

beforeAll(() => {
  const sheet = document.createElement("style");
  // The shell's sheet first, as index.css lays it: the title bar's row and its names are its.
  sheet.textContent = ["shell.css", "desktop.css"]
    .map((name) => readFileSync(`${__dirname}/${name}`, "utf8"))
    .join("\n");
  document.head.append(sheet);
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** The panel's sheets that declare a drag region. */
const DRAG_SHEETS = [
  "call.css",
  "shell.css",
  "desktop.css",
  "sign-in.css",
  "tasks.css",
  "tooltip.css",
];

/**
 * Every rule of those sheets that declares a drag region, in order, read from
 * their text: jsdom's CSSOM drops `-webkit-app-region`, which no browser but
 * Electron's draws.
 */
const DRAG_RULES = DRAG_SHEETS.flatMap((name) => {
  const text = readFileSync(`${__dirname}/${name}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector = "", body = ""]) => {
    const region = /-webkit-app-region:\s*([\w-]+)/.exec(body)?.[1];
    return region === undefined ? [] : [{ selector: selector.trim(), region }];
  });
});

/** The drag region `element` is drawn with, from the last rule that reaches it; every such rule is of one specificity's step. */
function dragRegion(element: Element): string | undefined {
  return DRAG_RULES.findLast((rule) => element.matches(rule.selector))?.region;
}

/** `value` as `element` draws it, every custom property it names spelled out. */
function resolved(element: Element, value: string): string {
  const style = getComputedStyle(element);
  return value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => {
    const own = style.getPropertyValue(name).trim();
    return own === "" ? whole : resolved(element, own);
  });
}

/** The folded shell's title bar and the toolbar beside it, under a root drawn at `profile`. */
function foldedShell(profile: Profile) {
  document.documentElement.setAttribute("data-luke-profile", profile);
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.sidebarCollapsed = "true";
  const main = shell.appendChild(document.createElement("main"));
  main.className = "desktop-main";
  const toolbar = main.appendChild(document.createElement("div"));
  toolbar.className = "desktop-toolbar";
  const controls = shell.appendChild(document.createElement("div"));
  controls.className = "title-bar-controls";
  return { controls, toolbar };
}

test("on the web profile the title bar's buttons start at the column's inset, as in full screen, and nothing clears the traffic lights", () => {
  const { controls, toolbar } = foldedShell(PROFILE.WEB);
  const left = resolved(controls, getComputedStyle(controls).left);
  // jsdom computes no padding drawn from a custom property, so this reads the clearance the folded toolbar pads by.
  const toolbarStart = resolved(toolbar, "var(--sidebar-toggle-clearance)");

  assert.equal(left, resolved(controls, "var(--column-inset)"));
  assert.ok(!toolbarStart.includes(TRAFFIC_LIGHTS_END), toolbarStart);
  assert.ok(toolbarStart.includes(left), "the folded toolbar still clears the buttons");
});

test("on the desktop profile the title bar's buttons stand past the traffic lights", () => {
  const { controls, toolbar } = foldedShell(PROFILE.DESKTOP);

  assert.ok(resolved(controls, getComputedStyle(controls).left).includes(TRAFFIC_LIGHTS_END));
  assert.ok(resolved(toolbar, "var(--sidebar-toggle-clearance)").includes(TRAFFIC_LIGHTS_END));
});

test("only the desktop profile drags the window by its toolbar and title-bar row, and a button on them keeps its presses", () => {
  const drawn = (profile: Profile) => {
    const { toolbar } = foldedShell(profile);
    const button = toolbar.appendChild(document.createElement("button"));
    button.className = "toolbar-button";
    const strip = document.body.appendChild(document.createElement("div"));
    strip.className = "desktop-drag-strip";
    return [toolbar, button, strip].map(dragRegion);
  };

  assert.deepEqual(drawn(PROFILE.DESKTOP), ["drag", "no-drag", "drag"]);
  document.body.replaceChildren();
  assert.deepEqual(drawn(PROFILE.WEB), [undefined, undefined, undefined]);
});
