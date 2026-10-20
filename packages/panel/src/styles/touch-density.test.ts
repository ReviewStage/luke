// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BUTTON_SIZE, IconButton, INLINE_EDIT_LOOK, InlineEdit } from "@luke/ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * touch-density.test.ts -- on a coarse pointer the panel is drawn at the
 * site's full density and every small target takes a finger's press, while
 * a mouse keeps what it had. A compact web root (the web app's) takes the
 * site's full roles on a touch screen, 44px controls and 16px words, so a
 * field never makes iOS zoom, and keeps its compact ones with a mouse; the
 * desktop's roles stand as they are. A sidebar row's mark, a section's ⋯,
 * a plan's task box, read or edited, the plan byline's person and time,
 * and a toolbar's glyph button each take a press at least 44px across around
 * what they draw on a touch screen; a close beside the words it closes, the
 * tab's × and a toast's, a press 44px tall and no wider than it draws, so a
 * near miss on the label closes nothing; a resize edge one across both
 * columns' gutters; and none takes one past its own box with a mouse. jsdom answers no media query,
 * no `var()`, and no pseudo-element, so the sheets are laid for the device
 * (`testing/container-width.ts`) and a `::before` hit area is read from the
 * rules laid that match the element, its lengths resolved from the root.
 */

/** The least a finger's press is taken across, in pixels. */
const FINGER = 44;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  for (const name of ["data-luke-profile", "data-luke-density", "data-luke-theme"]) {
    document.documentElement.removeAttribute(name);
  }
});

/** Lays the sheets for a touch screen or a mouse under a root wearing the surface given. */
function layFor(touch: boolean, surface: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(surface)) {
    document.documentElement.setAttribute(name, value);
  }
  laid = layContainersAt({}, { touch });
}

/** A role as the root resolves it. */
function role(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Every style rule laid in the document, those inside a block included. */
function styleRules(): CSSStyleRule[] {
  const walk = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => {
      if (rule instanceof CSSStyleRule) return [rule];
      return rule instanceof CSSGroupingRule ? walk(rule.cssRules) : [];
    });
  return [...document.styleSheets].flatMap((sheet) => walk(sheet.cssRules));
}

/** The declarations of the `::before` rules that match `element`, the later rule's winning. */
function before(element: Element): Map<string, string> {
  const declared = new Map<string, string>();
  for (const rule of styleRules()) {
    const matching = rule.selectorText
      .split(",")
      .map((part) => part.trim())
      .some((part) => part.endsWith("::before") && element.matches(part.slice(0, -8)));
    if (!matching) continue;
    for (const name of [...rule.style]) declared.set(name, rule.style.getPropertyValue(name));
  }
  return declared;
}

/** A length with every `var()` in it read off the root, through as many as it names. */
function resolved(length: string): string {
  const once = length.replace(/var\((--[\w-]+)\)/g, (_, name: string) => role(name));
  return once === length ? once : resolved(once);
}

/** The least a length spans in pixels: a `max()` its largest pixel term, a `calc()` of a count times a length their product; nothing for one that names no pixels. */
function leastPixels(length: string | undefined): number | undefined {
  if (length === undefined) return undefined;
  const words = resolved(length);
  const product = /calc\((\d+) \* (\d+(?:\.\d+)?)px\)/.exec(words);
  if (product !== null) return Number(product[1]) * Number(product[2]);
  const pixels = [...words.matchAll(/(\d+(?:\.\d+)?)px/g)].map(([, value]) => Number(value));
  return pixels.length === 0 ? undefined : Math.max(...pixels);
}

/** Whether `element` draws a box of its own past it to take presses with. */
function hitArea(element: Element): Map<string, string> | undefined {
  const area = before(element);
  return area.get("content") === undefined || area.get("position") !== "absolute"
    ? undefined
    : area;
}

/** Whether `element` takes a press a finger's width across, and as tall, around what it draws. */
function takesFinger(element: Element): boolean {
  const area = hitArea(element);
  return (
    area !== undefined &&
    (leastPixels(area.get("width")) ?? 0) >= FINGER &&
    (leastPixels(area.get("height")) ?? 0) >= FINGER
  );
}

/** How wide a resize edge takes a press, in pixels, where it runs its whole height; nothing where it draws no box of its own. */
function edgeReach(edge: Element): number | undefined {
  const area = hitArea(edge);
  if (area === undefined || !/^0(px)?$/.test(area.get("top") ?? "")) return undefined;
  return /^0(px)?$/.test(area.get("bottom") ?? "") ? leastPixels(area.get("width")) : undefined;
}

/** Draws `node` into a container wearing `className`, answering the container. */
function drawn(node: ReactNode, className = ""): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  container.className = className;
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return container;
}

/** `html` laid in the document as the component draws it, answering the element `selector` finds in it. */
function markup(html: string, selector: string): Element {
  const container = document.body.appendChild(document.createElement("div"));
  container.innerHTML = html;
  return container.querySelector(selector) ?? assert.fail(`${selector} is drawn`);
}

/** The button drawn in `container`. */
function buttonIn(container: Element): HTMLButtonElement {
  const button = container.querySelector("button");
  assert.ok(button !== null, "a button is drawn");
  return button;
}

/** The panel's small targets as their components draw them, each by what the developer calls it. */
function smallTargets(): ReadonlyMap<string, Element> {
  const compact = (label: string) =>
    createElement(IconButton, { icon: "·", label, size: BUTTON_SIZE.COMPACT });
  return new Map<string, Element>([
    ["a sidebar row's mark", buttonIn(drawn(compact("Pin"), "sidebar-task"))],
    [
      "a section's ⋯",
      buttonIn(drawn(createElement(IconButton, { icon: "⋯", label: "More" }), "plan-unit-more")),
    ],
    [
      "a plan's task box",
      markup(
        '<ul class="markdown"><li class="task-list-item"><label class="task-list-box"><input type="checkbox"></label></li></ul>',
        ".task-list-box",
      ),
    ],
    [
      "a task box in the plan's editor",
      markup(
        '<ul class="plan-document-text"><li data-checked="false"><label><input type="checkbox"></label><div></div></li></ul>',
        "label",
      ),
    ],
    [
      "the plan byline's person",
      markup(
        '<p class="plan-byline"><span class="actor-line">Created by <button class="luke-inline-ref" data-actor-ref="">you</button></span></p>',
        "[data-actor-ref]",
      ),
    ],
    [
      "the plan byline's time",
      markup(
        '<p class="plan-byline"><span class="actor-line">Last edited · <button class="luke-text-button">2h ago</button></span></p>',
        ".luke-text-button",
      ),
    ],
    [
      "a toolbar's glyph button",
      buttonIn(
        drawn(
          createElement(IconButton, { icon: "+", label: "New tab" }),
          "desktop-toolbar-actions",
        ),
      ),
    ],
  ]);
}

/** The closes that stand beside the words they close, each by what the developer calls it. */
function closes(): ReadonlyMap<string, Element> {
  const compact = (label: string) =>
    createElement(IconButton, { icon: "×", label, size: BUTTON_SIZE.COMPACT });
  const tab = document.body.appendChild(document.createElement("div"));
  tab.className = "tab";
  tab.dataset.marked = "false";
  const close = drawn(compact("Close Plan"), "tab-close");
  tab.append(close);
  const toast = document.body.appendChild(document.createElement("li"));
  toast.className = "toast";
  const dismiss = drawn(compact("Dismiss"), "toast-dismiss");
  toast.append(dismiss);
  return new Map([
    ["the tab's ×", buttonIn(close)],
    ["a toast's ×", buttonIn(dismiss)],
  ]);
}

/** The resize edges, each by what the developer calls it. */
function resizeEdges(): ReadonlyMap<string, Element> {
  const edge = (className: string) => {
    const element = document.body.appendChild(document.createElement("div"));
    element.className = className;
    return element;
  };
  return new Map([
    ["the sidebar's resize edge", edge("sidebar-resize")],
    ["the side panel's resize edge", edge("side-panel-resize")],
  ]);
}

test("a compact web root takes the site's full density on a touch screen: 44px controls and menu rows, 16px words", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  assert.equal(role("--luke-control-height"), "44px");
  assert.equal(role("--luke-menu-row-height"), "44px");
  assert.equal(role("--luke-type-body-size"), "16px");
});

test("a compact web root keeps its compact density with a mouse", () => {
  layFor(false, { "data-luke-profile": "web", "data-luke-density": "compact" });
  assert.equal(role("--luke-control-height"), "32px");
  assert.equal(role("--luke-menu-row-height"), "32px");
  assert.equal(role("--luke-type-body-size"), "14px");
});

test("the desktop with a mouse keeps its own density", () => {
  layFor(false, { "data-luke-profile": "desktop" });
  assert.equal(role("--luke-control-height"), "30px");
  assert.equal(role("--luke-menu-row-height"), "32px");
  assert.equal(role("--luke-type-body-size"), "13px");
});

test("on a touch screen each small target takes a press a finger's width across", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  for (const [name, target] of smallTargets()) {
    assert.equal(takesFinger(target), true, `${name} takes a finger's press`);
  }
});

test("on a touch screen a tab's × and a toast's × take a finger's height and no more width than they draw, so a tap on the label's end within 10px closes nothing", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  for (const [name, close] of closes()) {
    const area = hitArea(close);
    assert.ok(area !== undefined, `${name} takes a press past what it draws`);
    assert.ok((leastPixels(area.get("height")) ?? 0) >= FINGER, `${name} is a finger's height`);
    assert.equal(area.get("width"), "100%", `${name} reaches no further sideways than it draws`);
  }
});

test("on a touch screen a resize edge takes a press across both columns' gutters and no further, over no row", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  const gutters = 2 * (leastPixels(role("--column-inset")) ?? 0);
  for (const [name, edge] of resizeEdges()) {
    assert.equal(edgeReach(edge), gutters, `${name} spans the gutters`);
    assert.ok(gutters >= 24, `${name} keeps the 24px floor`);
  }
});

test("with a mouse no small target or resize edge takes a press past what it draws", () => {
  layFor(false, { "data-luke-profile": "desktop" });
  for (const [name, target] of [...smallTargets(), ...closes(), ...resizeEdges()]) {
    assert.equal(hitArea(target), undefined, `${name} draws no hit area`);
  }
});

/** iOS zooms the page into a field whose words are smaller than this, in pixels, the moment it is focused. */
const NO_ZOOM = 16;

/** The fields a finger renames or types in, each drawn over 14px words as the panel's rows are, by what the developer calls it. */
function fields(): ReadonlyMap<string, HTMLInputElement | HTMLTextAreaElement> {
  const inline = (look: (typeof INLINE_EDIT_LOOK)[keyof typeof INLINE_EDIT_LOOK]) => {
    const container = drawn(
      createElement(InlineEdit, {
        value: "Plan",
        label: "Rename",
        editing: true,
        look,
        onEnd: () => undefined,
      }),
    );
    container.style.fontSize = "14px";
    return container.querySelector("input") ?? assert.fail("the field is drawn");
  };
  const address = drawn(createElement("input", { type: "url" }), "browser-view-address");
  const comment = drawn(createElement("textarea", { className: "comment-text" }), "comment-card");
  return new Map<string, HTMLInputElement | HTMLTextAreaElement>([
    ["a tab's rename", inline(INLINE_EDIT_LOOK.WELL)],
    ["a workspace's or an integration's rename", inline(INLINE_EDIT_LOOK.INPUT)],
    ["a list row's rename", inline(INLINE_EDIT_LOOK.FIELD)],
    [
      "a Browser tab's address",
      address.querySelector("input") ?? assert.fail("the address is drawn"),
    ],
    [
      "a comment's field",
      comment.querySelector("textarea") ?? assert.fail("the comment's field is drawn"),
    ],
  ]);
}

test("on a touch screen every field takes at least 16px words, so focusing it never zooms the page", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  for (const [name, field] of fields()) {
    const size = leastPixels(getComputedStyle(field).fontSize) ?? 0;
    assert.ok(size >= NO_ZOOM, `${name} is ${size}px`);
  }
});

test("with a mouse a field keeps the size it had: the type it stands in, or its own role's", () => {
  layFor(false, { "data-luke-profile": "desktop" });
  const before = new Map([
    ["a tab's rename", "14px"],
    ["a workspace's or an integration's rename", "14px"],
    ["a list row's rename", role("--luke-type-body-size")],
    ["a Browser tab's address", role("--luke-type-caption-size")],
    ["a comment's field", "13px"],
  ]);
  for (const [name, field] of fields()) {
    assert.equal(
      resolved(getComputedStyle(field).fontSize),
      before.get(name),
      `${name} keeps its size`,
    );
  }
});

/** Builds `markup` into the body, answering the element `selector` names in it. */
function built(markup: string, selector: string): HTMLElement {
  const holder = document.body.appendChild(document.createElement("div"));
  holder.innerHTML = markup;
  return holder.querySelector<HTMLElement>(selector) ?? assert.fail(`${selector} is built`);
}

/** The presses drawn only under the pointer on a desktop, each by what the developer calls it. */
function pointerOnlyPresses(): ReadonlyMap<string, HTMLElement> {
  return new Map([
    [
      "an archived agent's Unarchive",
      built(
        '<ul><li class="task-summary-archived-agent"><span class="task-summary-row"></span><span class="task-summary-marks"><button>Unarchive</button></span></li></ul>',
        ".task-summary-marks",
      ),
    ],
    [
      "a fold's chevron",
      built(
        '<button class="luke-nav-item" aria-expanded="false"><span class="luke-nav-item-glyph"><span class="luke-nav-item-icon"></span><span class="luke-nav-item-chevron"></span></span></button>',
        ".luke-nav-item-chevron",
      ),
    ],
    [
      "a list row's chevron",
      built(
        '<div class="luke-list-row"><span class="luke-list-row-chevron"></span></div>',
        ".luke-list-row-chevron",
      ),
    ],
    [
      "the pinned summary's chevron",
      built(
        '<div class="task-summary" data-mode="column"><span class="task-summary-chevron"><button>Collapse</button></span></div>',
        ".task-summary-chevron",
      ),
    ],
    [
      "the summary card's chevron",
      built(
        '<div class="task-summary-card"><span class="task-summary-collapse"><button>Collapse</button></span></div>',
        ".task-summary-collapse",
      ),
    ],
  ]);
}

test("on a touch screen nothing a finger can press stands invisible: an archived agent's Unarchive and every chevron show at rest", () => {
  layFor(true, { "data-luke-profile": "web", "data-luke-density": "compact" });
  for (const [name, press] of pointerOnlyPresses()) {
    assert.equal(getComputedStyle(press).opacity, "1", `${name} shows`);
  }
});

test("with a mouse those presses still wait for the pointer", () => {
  layFor(false, { "data-luke-profile": "desktop" });
  for (const [name, press] of pointerOnlyPresses()) {
    assert.equal(getComputedStyle(press).opacity, "0", `${name} waits`);
  }
});
