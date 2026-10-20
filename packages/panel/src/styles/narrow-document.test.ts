// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * narrow-document.test.ts -- on a phone the page itself never scrolls: a
 * narrow room's sidebar drawer, open or put away, adds no height to the
 * document, however long the task list it holds, so the document stays the
 * stage's height and a finger drags no part of the app but its own
 * scrollers. The open drawer still scrolls its own list, and the desktop's
 * sidebar is clipped by its shell as before.
 *
 * jsdom lays nothing out, so the sheets are laid (`testing/container-width.ts`),
 * the stage is built in the markup its components draw, and whether a box can
 * reach the document is read from the boxes that clip it, as CSS decides
 * them: a box overflows into its containing block, which for a positioned box
 * is its nearest positioned (or transformed) ancestor rather than its parent,
 * so it passes every scroller and clip in between; it stops at the first box
 * on that chain that does not let its overflow show. A box that reaches the
 * initial containing block unclipped makes the document as tall as it runs.
 */

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

/** Whether a box is the containing block of the positioned boxes inside it. */
function containsPositioned(element: Element): boolean {
  const style = getComputedStyle(element);
  const positioned = style.position !== "" && style.position !== "static";
  const transformed = style.transform !== "" && style.transform !== "none";
  return positioned || transformed;
}

/** The box `element` overflows into: its parent, or for a positioned box its containing block, or none past the root. */
function overflowsInto(element: Element): Element | undefined {
  const position = getComputedStyle(element).position;
  if (position !== "absolute") return element.parentElement ?? undefined;
  for (let box = element.parentElement; box !== null; box = box.parentElement) {
    if (containsPositioned(box)) return box;
  }
  return undefined;
}

/** What a box does with what runs past its bottom; jsdom answers `visible` for `overflow-y` where a sheet names only the shorthand. */
function overflowY(element: Element): string {
  const style = getComputedStyle(element);
  if (style.overflowY !== "" && style.overflowY !== "visible") return style.overflowY;
  return style.overflow.split(" ").at(-1) || "visible";
}

/**
 * The first box that clips what runs past `element`'s bottom, walking the
 * chain of boxes it overflows into, or `undefined` where it reaches the
 * initial containing block, and so the document, unclipped.
 */
function clippedBy(element: Element): Element | undefined {
  for (let box = overflowsInto(element); box !== undefined; box = overflowsInto(box)) {
    if (box === document.documentElement || box === document.body) return undefined;
    if (overflowY(box) !== "visible") return box;
  }
  return undefined;
}

/** The stage at a room's width, its sidebar folded and the drawer `overlay` (closed, or open), its list a repository whose head carries visually hidden words, as a pinned one's does. */
function stage(room: "narrow" | "wide", overlay: "closed" | "open"): void {
  document.documentElement.setAttribute("data-luke-profile", "web");
  laid = layContainersAt({}, { touch: room === "narrow" });
  built(document.body, {
    className: "app-root",
    children: [
      {
        className: "app-stage",
        data: { surface: "desktop", capture: "false" },
        children: [
          {
            className: "desktop-stage",
            children: [
              {
                className: "desktop-shell",
                data: {
                  room,
                  sidebarCollapsed: "true",
                  sidebarOverlay: overlay,
                },
                children: [
                  {
                    tag: "aside",
                    className: "desktop-sidebar",
                    children: [
                      { className: "desktop-drag-strip" },
                      {
                        className: "sidebar-section",
                        children: [
                          {
                            className: "luke-scroll-area",
                            data: { axis: "vertical", size: "fill", fade: "both" },
                            children: [
                              {
                                className: "sidebar-section-body",
                                children: [
                                  {
                                    tag: "nav",
                                    className: "sidebar-group",
                                    children: [
                                      {
                                        className: "sidebar-repository",
                                        children: [
                                          {
                                            className: "sidebar-repository-header",
                                            children: [
                                              {
                                                tag: "button",
                                                className: "luke-nav-item",
                                                data: { variant: "head" },
                                                children: [
                                                  {
                                                    tag: "span",
                                                    className: "luke-nav-item-rest",
                                                    children: [
                                                      {
                                                        tag: "span",
                                                        className: "luke-nav-item-mark",
                                                        children: [
                                                          {
                                                            tag: "span",
                                                            className: "sidebar-repository-pinned",
                                                            children: [
                                                              {
                                                                tag: "span",
                                                                className: "luke-visually-hidden",
                                                              },
                                                            ],
                                                          },
                                                        ],
                                                      },
                                                    ],
                                                  },
                                                ],
                                              },
                                            ],
                                          },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  { tag: "main", className: "desktop-main" },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

test("a phone's put-away drawer adds no height to the page, however long its list", () => {
  stage("narrow", "closed");
  const words = the(".desktop-sidebar .luke-visually-hidden");
  assert.equal(getComputedStyle(words).position, "absolute", "the row's hidden words are placed");
  const clip = clippedBy(words);
  assert.ok(clip !== undefined, "something short of the document clips the drawer's list");
  assert.ok(the(".desktop-sidebar").contains(clip), "and it is the drawer or a box in it");
});

test("a phone's open drawer adds no height to the page and still scrolls its own list", () => {
  stage("narrow", "open");
  const clip = clippedBy(the(".desktop-sidebar .luke-visually-hidden"));
  assert.ok(clip !== undefined, "something short of the document clips the open drawer's list");
  const scroller = clippedBy(the(".desktop-sidebar .sidebar-repository"));
  assert.equal(
    scroller,
    the(".desktop-sidebar .luke-scroll-area"),
    "the list's rows run in its scroller",
  );
  assert.match(overflowY(scroller), /^(auto|scroll)$/, "and that scroller scrolls");
});

test("the desktop's sidebar is clipped by its shell, as before", () => {
  stage("wide", "closed");
  assert.equal(clippedBy(the(".desktop-sidebar .luke-visually-hidden")), the(".desktop-shell"));
});
