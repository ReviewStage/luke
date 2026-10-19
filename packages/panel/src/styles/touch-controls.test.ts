// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  List,
  ListRow,
} from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * touch-controls.test.ts -- a control the panel offers under the pointer
 * alone stands at rest on a screen with no hover, in the room it keeps
 * there, and with a mouse stays hidden until the pointer brings it. A list
 * row offering its acts to the row in hand keeps its metadata on a touch
 * screen, its acts in its menu, but for the open row, which shows them as
 * the hovered row does. A failed agent's tab keeps its mark rather than its
 * ×, and a transcript's floating bar stays hidden. jsdom answers no media
 * query, so the sheets are laid for a touch screen or a mouse
 * (`testing/container-width.ts`), and each group is drawn in the markup its
 * component draws.
 */

/** The pieces a fixture's markup is built from: a tag, its classes, its data, and what stands in it. */
interface Piece {
  readonly tag?: string;
  readonly className?: string;
  readonly data?: Readonly<Record<string, string>>;
  readonly children?: readonly Piece[];
}

const roots: Root[] = [];
let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** Lays the sheets for a touch screen or a mouse. */
function layFor(touch: boolean): void {
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

/** Draws `piece` into the document, answering the element found by `selector` in it. */
function drawn(piece: Piece, selector: string): HTMLElement {
  const element = built(document.body, piece).querySelector<HTMLElement>(selector);
  assert.ok(element !== null, selector);
  return element;
}

/** Whether `element` is drawn to be seen and pressed: opaque, and it or what it holds to press taking the pointer. */
function standing(element: Element, press: Element = element): boolean {
  return (
    getComputedStyle(element).opacity === "1" && getComputedStyle(press).pointerEvents !== "none"
  );
}

/** Whether `element` is drawn faded out. */
function faded(element: Element): boolean {
  return getComputedStyle(element).opacity === "0";
}

/** Whether a row's metadata is drawn to be read. */
function readable(element: Element): boolean {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** A group of controls shown only under the pointer, each drawn in its component's markup. */
const HOVER_ONLY: readonly {
  name: string;
  piece: Piece;
  control: string;
  /** What in the control takes a press, where the control itself lets the pointer through. */
  press?: string;
}[] = [
  {
    name: "a repository header's ⋯ and +",
    piece: {
      className: "sidebar-repository-header",
      children: [{ tag: "span", className: "sidebar-repository-actions" }],
    },
    control: ".sidebar-repository-actions",
  },
  {
    name: "a tab's × other than the chosen tab's",
    piece: {
      className: "tab-strip",
      children: [
        {
          className: "tab",
          data: { selected: "false", closable: "true", marked: "false" },
          children: [{ tag: "span", className: "tab-button" }, { className: "tab-close" }],
        },
      ],
    },
    control: ".tab-close",
  },
  {
    name: "a plan section's byline",
    piece: {
      className: "plan-unit-attributed",
      children: [{ tag: "span", className: "plan-unit-byline", children: [{ tag: "button" }] }],
    },
    control: ".plan-unit-byline",
    press: ".plan-unit-byline > button",
  },
  {
    name: "a plan section's ⋯",
    piece: {
      className: "plan-unit-attributed",
      children: [{ tag: "span", className: "plan-unit-more" }],
    },
    control: ".plan-unit-more",
  },
  {
    name: "a block's comment button",
    piece: { className: "plan-body", children: [{ className: "comment-block-button" }] },
    control: ".comment-block-button",
  },
  {
    name: "a comment's tools",
    piece: {
      className: "comment-entry",
      children: [
        {
          className: "comment-head",
          children: [
            {
              tag: "span",
              className: "comment-head-end",
              children: [{ className: "comment-tools" }],
            },
          ],
        },
      ],
    },
    control: ".comment-tools",
  },
  {
    name: "a quiet Chat message's byline action",
    piece: {
      className: "chat-message",
      children: [
        {
          tag: "p",
          className: "chat-byline",
          children: [{ tag: "span", className: "chat-byline-action" }],
        },
      ],
    },
    control: ".chat-byline-action",
  },
  {
    name: "a toast's ×",
    piece: {
      tag: "li",
      className: "toast",
      data: { action: "true" },
      children: [{ tag: "span", className: "toast-dismiss" }],
    },
    control: ".toast-dismiss",
  },
  {
    name: "a sent message's actions",
    piece: {
      className: "transcript-message is-user",
      children: [{ className: "message-actions", data: { placement: "inline" } }],
    },
    control: ".message-actions",
  },
];

for (const { name, piece, control, press } of HOVER_ONLY) {
  test(`${name} stands at rest on a touch screen`, () => {
    layFor(true);
    const element = drawn(piece, control);
    assert.ok(standing(element, document.querySelector(press ?? control) ?? element));
  });

  test(`${name} stays hidden at rest with a mouse`, () => {
    layFor(false);
    assert.ok(faded(drawn(piece, control)));
  });
}

test("on a touch screen a comment's time gives its place to the tools, as under the pointer", () => {
  layFor(true);
  const time = drawn(
    {
      className: "comment-entry",
      children: [
        {
          tag: "span",
          className: "comment-head-end",
          children: [{ tag: "span", className: "comment-time" }, { className: "comment-tools" }],
        },
      ],
    },
    ".comment-time",
  );

  assert.ok(faded(time));
  assert.equal(getComputedStyle(time).pointerEvents, "none");
});

test("on a touch screen a failed agent's tab keeps its mark rather than its ×", () => {
  layFor(true);
  const close = drawn(
    {
      className: "tab-strip",
      children: [
        {
          className: "tab",
          data: { selected: "false", closable: "true", marked: "true" },
          children: [{ tag: "span", className: "tab-end-mark" }, { className: "tab-close" }],
        },
      ],
    },
    ".tab-close",
  );

  assert.ok(faded(close));
});

test("on a touch screen a transcript's floating actions stay hidden, so the transcript is not a column of buttons", () => {
  layFor(true);
  const bar = drawn(
    {
      className: "transcript-message",
      children: [{ className: "message-actions", data: { placement: "floating" } }],
    },
    ".message-actions",
  );

  assert.ok(faded(bar));
  assert.equal(getComputedStyle(bar).pointerEvents, "none");
});

/** Draws a list of rows offering Archive to the row in hand, their metadata where `metaAt` puts it, the first open; answers each row's acts and metadata. */
function drawRows(metaAt: (typeof LIST_ROW_META)[keyof typeof LIST_ROW_META]) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const row = (title: string, current: boolean) =>
    createElement(ListRow, {
      key: title,
      title,
      meta: "2m",
      metaAt,
      current: current ? LIST_ROW_CURRENT.PAGE : undefined,
      onPress: () => undefined,
      actionsAt: LIST_ROW_ACTIONS.HOVER,
      actions: createElement(IconButton, { icon: "×", label: `Archive ${title}` }),
    });
  act(() => root.render(createElement(List, null, row("Open", true), row("Other", false))));
  const rows = [...container.querySelectorAll(".luke-list-row")];
  return rows.map((each) => {
    const actions = each.querySelector(".luke-list-row-actions");
    const meta = each.querySelector(".luke-list-row-meta");
    assert.ok(actions !== null && meta !== null);
    return { actions, meta };
  });
}

for (const metaAt of [LIST_ROW_META.MIDDLE, LIST_ROW_META.TITLE]) {
  test(`on a touch screen a list row keeps its metadata at its ${metaAt} and its acts to its menu, but the open row, which shows its acts in the metadata's place`, () => {
    layFor(true);
    const [open, other] = drawRows(metaAt);
    assert.ok(open !== undefined && other !== undefined);

    assert.ok(standing(open.actions));
    assert.ok(!readable(open.meta));
    assert.ok(faded(other.actions));
    assert.equal(getComputedStyle(other.actions).pointerEvents, "none");
    assert.ok(readable(other.meta));
  });

  test(`with a mouse a list row with its metadata at its ${metaAt}, the open one too, keeps its acts hidden until the pointer brings them`, () => {
    layFor(false);
    for (const row of drawRows(metaAt)) {
      assert.ok(faded(row.actions));
      assert.ok(readable(row.meta));
    }
  });
}
