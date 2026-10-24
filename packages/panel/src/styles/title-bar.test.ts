// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PROFILE, type Profile } from "@luke/ui";
import { afterEach, beforeAll, test } from "vitest";

/** The traffic lights' width, which only the desktop's window reserves room for. */
const TRAFFIC_LIGHTS_END = "79px";

beforeAll(() => {
  const sheet = document.createElement("style");
  // `@luke/ui`'s scale and profiles' roles first, then the shell's sheet, as index.css lays them: the title bar's row and its names are the shell's.
  sheet.textContent = [
    "../../../ui/src/tokens/scale.css",
    "../../../ui/src/tokens/profiles.css",
    "shell.css",
    "desktop.css",
  ]
    .map((name) => readFileSync(`${__dirname}/${name}`, "utf8"))
    .join("\n");
  document.head.append(sheet);
});

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
  document.documentElement.removeAttribute("data-full-screen");
});

/** The panel's sheets that declare a drag region. */
const DRAG_SHEETS = ["call.css", "shell.css", "desktop.css", "tasks.css"];

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

/**
 * The element that declares the custom property `name` as `element` reads it:
 * the furthest ancestor reading the same words, since a custom property
 * inherits as its declarer computed it, its own `var()`s read there.
 */
function declarer(element: Element, name: string): Element {
  const own = getComputedStyle(element).getPropertyValue(name);
  const parent = element.parentElement;
  return parent !== null && getComputedStyle(parent).getPropertyValue(name) === own
    ? declarer(parent, name)
    : element;
}

/** `var(--name)` as `element` draws it in pixels, each custom property it names read where it is declared. */
function pixels(element: Element, name: string): number {
  const at = declarer(element, name);
  const words = getComputedStyle(at)
    .getPropertyValue(name)
    .trim()
    .replace(/var\((--[\w-]+)\)/g, (_, inner: string) => `${pixels(at, inner)}px`);
  return arithmetic(words.replace(/calc/g, "").replace(/px/g, ""));
}

/** The value of a sum of products of numbers in brackets, as a `calc()` of pixels spells one. */
function arithmetic(words: string): number {
  const tokens = words.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? [];
  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = sum();
      at++;
      return inner;
    }
    if (token === "-") return -factor();
    return Number(token);
  };
  const product = (): number => {
    let value = factor();
    while (tokens[at] === "*" || tokens[at] === "/") {
      value = tokens[at++] === "*" ? value * factor() : value / factor();
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      value = tokens[at++] === "+" ? value + product() : value - product();
    }
    return value;
  };
  return sum();
}

/** The shell's work column and the title bar's buttons over it, folded or not, under a root drawn at `profile`. */
function shellWith(profile: Profile, collapsed: boolean) {
  document.documentElement.setAttribute("data-luke-profile", profile);
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  shell.dataset.sidebarCollapsed = String(collapsed);
  const main = shell.appendChild(document.createElement("main"));
  main.className = "desktop-main";
  const controls = shell.appendChild(document.createElement("div"));
  controls.className = "title-bar-controls";
  return { main, controls };
}

/** Where the middle of the work column's top row stands below the window's top: the sheet's gap above it and half the row over its hairline. */
function rowMiddle(main: Element): number {
  return pixels(main, "--sheet-gap") + (pixels(main, "--desktop-bar-height") - 1) / 2;
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

test("on the desktop profile the sheet's top row keeps the one bar height, its middle level with the traffic lights and the title bar's buttons", () => {
  const { main, controls } = shellWith(PROFILE.DESKTOP, false);
  const root = document.documentElement;
  const lights = pixels(root, "--traffic-lights-middle");
  const bar = pixels(main, "--desktop-bar-height");
  const room = (bar - 1 - pixels(root, "--luke-control-height")) / 2;

  assert.equal(bar, pixels(root, "--desktop-bar-height"));
  assert.ok(room >= pixels(root, "--luke-space-8"), `${room}px above and below a control`);
  assert.equal(rowMiddle(main), lights);
  assert.equal(pixels(controls, "--title-bar-middle"), lights);
});

test("folded on the desktop profile the row at the window's top grows to stay centred on the traffic lights", () => {
  const { main, controls } = shellWith(PROFILE.DESKTOP, true);
  const lights = pixels(document.documentElement, "--traffic-lights-middle");

  assert.equal(pixels(main, "--sheet-gap"), 0);
  assert.equal(rowMiddle(main), lights);
  assert.equal(pixels(controls, "--title-bar-middle"), lights);
});

test("folded with no traffic lights, in full screen or on the web, the row keeps the one bar height and the title bar's buttons come up to its middle", () => {
  for (const profile of [PROFILE.DESKTOP, PROFILE.WEB]) {
    if (profile === PROFILE.DESKTOP)
      document.documentElement.setAttribute("data-full-screen", "true");
    const { main, controls } = shellWith(profile, true);
    const bar = pixels(document.documentElement, "--desktop-bar-height");

    assert.equal(pixels(main, "--desktop-bar-height"), bar, profile);
    assert.equal(pixels(controls, "--title-bar-middle"), rowMiddle(main), profile);
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-full-screen");
  }
});
