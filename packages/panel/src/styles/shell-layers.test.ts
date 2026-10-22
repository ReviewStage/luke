// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * shell-layers.test.ts -- the sidebar floating open over the work column, a
 * phone's drawer or the desktop's peek, draws over everything the column
 * raises inside it: its toolbar, its tab strip with the chosen tab pinned
 * in it, and a menu hung from the strip's "+". jsdom paints nothing, so the
 * sheets are laid (`testing/container-width.ts`), the shell is built in the
 * markup its components draw, and each box's place in the shell's paint
 * order is read from the stacking contexts around it, as the cascade
 * computes them.
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

/** Whether a box makes a stacking context of its own, by the properties the panel's sheets set. */
function stacks(element: Element): boolean {
  const style = getComputedStyle(element);
  const positioned = style.position !== "" && style.position !== "static";
  const raised = style.zIndex !== "" && style.zIndex !== "auto";
  return (positioned && raised) || style.isolation === "isolate";
}

/**
 * Where a box paints among the shell's layers: the `z-index` of the
 * outermost stacking context around it inside the shell, which is the
 * place everything inside that context takes there, and its place in the
 * document among boxes on the same level, the later painting over.
 */
function layer(element: HTMLElement, shell: HTMLElement) {
  let outermost: HTMLElement = element;
  for (
    let box: HTMLElement | null = element;
    box !== null && box !== shell;
    box = box.parentElement
  ) {
    if (stacks(box)) outermost = box;
  }
  const z = Number.parseInt(getComputedStyle(outermost).zIndex, 10);
  const order = [...shell.querySelectorAll("*")];
  return { z: Number.isNaN(z) ? 0 : z, at: order.indexOf(outermost) };
}

/** Whether `top` paints over `under` in the shell. */
function over(top: HTMLElement, under: HTMLElement, shell: HTMLElement): boolean {
  const a = layer(top, shell);
  const b = layer(under, shell);
  return a.z > b.z || (a.z === b.z && a.at > b.at);
}

/** The plans' shell in the room given, its folded sidebar floating as `overlay` says, over a task's column with its tabs and an open "+" menu. */
function shell(room: string, overlay: string): HTMLElement {
  return built(document.body, {
    className: "desktop-shell",
    data: { room, sidebarCollapsed: "true", sidebarOverlay: overlay },
    children: [
      { tag: "aside", className: "desktop-sidebar" },
      {
        tag: "main",
        className: "desktop-main",
        children: [
          {
            className: "desktop-task-main",
            children: [
              {
                tag: "header",
                className: "desktop-toolbar",
                children: [
                  {
                    className: "desktop-toolbar-heading main-tabs",
                    children: [
                      {
                        className: "tab-strip",
                        children: [
                          { className: "tab", data: { selected: "true" } },
                          { className: "tab", data: { selected: "false" } },
                        ],
                      },
                      {
                        className: "tab-add-anchor",
                        children: [
                          {
                            className: "luke-anchored-popover",
                            children: [{ className: "searchable-menu tab-add-menu" }],
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
  });
}

for (const [where, room, overlay, touch] of [
  ["a phone's drawer", "narrow", "open", true],
  ["the desktop's peeked sidebar", "wide", "peek", false],
] as const) {
  test(`${where} draws over the task's toolbar, its strip, the chosen tab pinned in it, and a menu hung from its "+"`, () => {
    document.documentElement.setAttribute("data-luke-profile", touch ? "web" : "desktop");
    laid = layContainersAt({}, { touch });
    const root = shell(room, overlay);
    const sidebar = the(".desktop-sidebar");
    for (const selector of [
      ".desktop-toolbar",
      ".tab-strip",
      '.tab[data-selected="true"]',
      ".tab-add-menu",
    ]) {
      assert.ok(over(sidebar, the(selector), root), `the sidebar draws over ${selector}`);
    }
  });
}
