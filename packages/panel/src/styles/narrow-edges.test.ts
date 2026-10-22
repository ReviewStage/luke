// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * narrow-edges.test.ts -- nothing a task draws at its column's right edge
 * stands past it on a phone. In a narrow room the task's tab strip and the
 * side panel's each take a row of their own under their bar's buttons, from
 * the column's inset to its other, so the strip scrolls within the column
 * and the buttons stay in the row above; a wide room keeps them in the bar's
 * one row. On the web a document ends a finger's gutter short of its column,
 * whether or not a thread stands on it, a line's comment count stands in
 * that gutter with a finger's press inside the column, ending where it ends
 * however many figures it holds, and an open thread on the narrowest phone
 * stays within the document; the desktop keeps the inset it had. jsdom lays nothing out
 * and answers no `var()`, so the sheets are laid for the device
 * (`testing/container-width.ts`), each piece is built in the markup its
 * component draws, and its lengths are resolved from the roles it reads.
 */

/** The least a finger's press is taken across, in pixels. */
const FINGER = 44;

/** The share of an em a figure of the label's face takes at most. */
const FIGURE_EM = 0.6;

/** The pieces a fixture's markup is built from: a tag, its classes, its data, and what stands in it. */
interface Piece {
  readonly tag?: string;
  readonly className?: string;
  readonly data?: Readonly<Record<string, string>>;
  readonly children?: readonly Piece[];
}

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** Lays the sheets for a touch screen or a mouse under a root wearing the profile given. */
function layFor(profile: string, touch: boolean): void {
  document.documentElement.setAttribute("data-luke-profile", profile);
  laid = layContainersAt({}, { touch });
}

/** Builds `piece` into `parent`, answering the element. */
function built(parent: Element, piece: Piece): HTMLElement {
  const element = parent.appendChild(document.createElement(piece.tag ?? "div"));
  if (piece.className !== undefined) element.className = piece.className;
  for (const [key, value] of Object.entries(piece.data ?? {})) element.dataset[key] = value;
  for (const child of piece.children ?? []) built(element, child);
  return element;
}

/** The element `selector` names in what was built, which must stand. */
function the(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  assert.ok(element !== null, `${selector} stands`);
  return element;
}

/** A length with every `var()` in it read off `element`, through as many as it names. */
function resolved(element: Element, length: string): string {
  const once = length.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
    getComputedStyle(element).getPropertyValue(name).trim(),
  );
  return once === length ? once : resolved(element, once);
}

/** A length of pixels `element` declares, its roles resolved and its `calc()` worked out. */
function pixels(element: Element, length: string): number {
  const sum = resolved(element, length).replace(/calc/g, "").replace(/px/g, "");
  assert.match(sum, /^[\d\s.+\-*/()]+$/, `${length} is a sum of pixels`);
  return Number(new Function(`return (${sum});`)());
}

/** The shell in the room given, its task's column and its side panel standing full screen, each bar with its tabs and its actions. */
function shell(room: string): void {
  const bar = (className: string, tabs: string, actions: string): Piece => ({
    className,
    children: [{ className: tabs, children: [{ className: "tab-strip" }] }, { className: actions }],
  });
  built(document.body, {
    className: "desktop-shell",
    data: { room, sidebarCollapsed: "true", panelToggle: "true" },
    children: [
      {
        className: "desktop-task-main",
        children: [
          bar("desktop-toolbar", "desktop-toolbar-heading main-tabs", "desktop-toolbar-actions"),
        ],
      },
      {
        tag: "aside",
        className: "side-panel",
        data: { fullScreen: "true" },
        children: [bar("side-panel-bar", "side-panel-tabs", "toolbar-tab-actions")],
      },
    ],
  });
}

/** The bars that hold a task's tabs, each by what the developer calls it, with its tabs and what follows them. */
const BARS = [
  ["the task's column", ".desktop-toolbar", ".main-tabs"],
  ["the side panel", ".side-panel-bar", ".side-panel-tabs"],
] as const;

/** Where a bar's row of tabs starts and ends from the column's edges: the bar's padding and the row's margin together. */
function tabRowInsets(bar: Element, tabs: Element) {
  const style = getComputedStyle(bar);
  const row = getComputedStyle(tabs);
  return {
    start: pixels(bar, style.paddingLeft) + pixels(tabs, row.marginLeft),
    end: pixels(bar, style.paddingRight) + pixels(tabs, row.marginRight),
  };
}

test("in a narrow room a task's tabs take a row of their own under the bar's buttons, from the column's inset to its other, and the buttons keep the row above at its end", () => {
  layFor("web", true);
  shell("narrow");
  const inset = pixels(document.body, "var(--column-inset)");
  for (const [name, barSelector, tabsSelector] of BARS) {
    const bar = the(barSelector);
    const tabs = the(`${barSelector} > ${tabsSelector}`);
    assert.equal(getComputedStyle(bar).flexWrap, "wrap", `${name}'s bar wraps`);
    assert.equal(getComputedStyle(tabs).order, "1", `${name}'s tabs stand after its buttons`);
    assert.deepEqual(tabRowInsets(bar, tabs), { start: inset, end: inset }, `${name}'s tab row`);
    const buttons = tabs.nextElementSibling ?? assert.fail(`${name}'s buttons follow its tabs`);
    assert.equal(
      getComputedStyle(buttons).marginLeft,
      "auto",
      `${name}'s buttons stand at its end`,
    );
    assert.equal(getComputedStyle(the(`${tabsSelector} .tab-strip`)).overflowX, "auto");
  }
});

test("in a wide room a task's tabs stand in the bar's one row, beside its buttons", () => {
  layFor("web", false);
  shell("wide");
  for (const [name, barSelector, tabsSelector] of BARS) {
    assert.notEqual(getComputedStyle(the(barSelector)).flexWrap, "wrap", `${name}'s bar`);
    assert.notEqual(getComputedStyle(the(`${barSelector} > ${tabsSelector}`)).order, "1");
  }
});

/** A plan's document with its body, and a line's comment count in the body's layer. */
function planDocument(): void {
  built(document.body, {
    className: "desktop-document",
    children: [
      {
        className: "plan-document-body",
        children: [
          {
            className: "plan-body",
            children: [
              {
                className: "comment-layer",
                children: [{ tag: "span", className: "comment-count" }],
              },
            ],
          },
        ],
      },
    ],
  });
}

/** The widest a count of one or two figures draws: its edges, its insets, its glyph, the gap, and its figures. */
function countWidth(count: Element, figures: number): number {
  const length = (name: string) => pixels(count, `var(${name})`);
  return (
    2 +
    2 * length("--luke-control-inset") +
    length("--luke-control-icon") +
    length("--luke-icon-gap") +
    figures * FIGURE_EM * length("--luke-type-label-size")
  );
}

/** Where a line's comment count ends, past the document's end, in pixels: its `right` turned about. */
function countEnd(count: Element): number {
  return -pixels(count, getComputedStyle(count).right);
}

for (const touch of [true, false]) {
  test(`on the web with ${touch ? "a finger" : "a mouse"} a document ends a finger's gutter short of its column, and a line's comment count stands in it, its press inside the column and a longer one growing in toward the words`, () => {
    layFor("web", touch);
    planDocument();
    const body = the(".plan-document-body");
    const gutter = pixels(body, getComputedStyle(body).paddingRight);
    assert.ok(gutter >= FINGER, `the gutter, ${gutter}px, holds a finger's target`);
    const count = the(".comment-count");
    const end = countEnd(count);
    assert.ok(
      end < gutter,
      `the count ends inside the column, ${gutter - end}px short of its edge`,
    );
    // A finger's press is taken across the count's middle, at least a finger wide.
    const middle = end - countWidth(count, 1) / 2;
    const reach = Math.max(countWidth(count, 1), FINGER) / 2;
    assert.ok(middle - reach >= 0, "a count of one figure takes its press past the words");
    assert.ok(middle + reach <= gutter, "a count of one figure takes its press inside the column");
  });
}

/** A line's open thread, which floats under its count over the document. */
function openThread(): HTMLElement {
  built(the(".comment-layer"), { className: "comment-float" });
  return the(".comment-float");
}

/** The narrowest phone a test lays a document out on, in CSS pixels. */
const SMALL_PHONE = 320;

test("on the web a line's open thread on the narrowest phone stands within the document rather than start past its other edge", () => {
  layFor("web", true);
  planDocument();
  const body = the(".plan-document-body");
  const page = getComputedStyle(body);
  const width =
    SMALL_PHONE - pixels(body, "var(--luke-page-inset)") - pixels(body, page.paddingRight);
  const float = openThread();
  const style = getComputedStyle(float);
  const card = Math.min(
    pixels(float, style.width),
    pixels(float, style.maxWidth.replace("100%", `${width}px`)),
  );
  const end = width - pixels(float, style.right);
  assert.ok(end - card >= 0, `the card starts ${end - card}px from the document's start`);
});

test("the desktop's documents add no gutter at their end, keeping the page's inset", () => {
  layFor("desktop", false);
  planDocument();
  const body = the(".plan-document-body");
  // Note that jsdom drops the shorthand the page's inset is set by, so what is read is that nothing else sets the end.
  assert.ok(pixels(body, getComputedStyle(body).paddingRight) < FINGER, "no gutter at its end");
});
