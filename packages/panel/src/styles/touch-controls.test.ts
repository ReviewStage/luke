// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  IconButton,
  LIST_ROW_ACTIONS,
  LIST_ROW_CURRENT,
  LIST_ROW_META,
  List,
  ListRow,
  MESSAGE_ACTIONS_PLACEMENT,
  MessageActions,
  type MessageActionsPlacement,
} from "@luke/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { Message, MessageAction, MessageContent } from "../ai-elements/message.js";
import { layContainersAt } from "../testing/container-width.js";

/**
 * touch-controls.test.ts -- a control the panel offers under the pointer
 * alone stands at rest on a screen with no hover, in the room it keeps
 * there, and with a mouse stays hidden until the pointer brings it. A list
 * row offering its acts to the row in hand keeps its metadata on a touch
 * screen, its acts in its menu, but for the open row, which shows them as
 * the hovered row does. A failed agent's tab keeps its mark rather than its
 * ×, a thread's event line keeps its time, and a transcript message's
 * actions stay hidden until the message is tapped. jsdom answers no media
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
  vi.unstubAllGlobals();
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
      className: "luke-tabs",
      children: [
        {
          className: "luke-tab",
          data: { selected: "false", closable: "true", marked: "false" },
          children: [
            { tag: "span", className: "luke-tab-button" },
            { className: "luke-tab-close" },
          ],
        },
      ],
    },
    control: ".luke-tab-close",
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
      className: "luke-toast",
      data: { action: "true" },
      children: [{ tag: "span", className: "luke-toast-dismiss" }],
    },
    control: ".luke-toast-dismiss",
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

test("on a touch screen a thread's event line, offering no tools, keeps its time", () => {
  layFor(true);
  const time = drawn(
    {
      className: "comment-event",
      children: [
        {
          className: "comment-head",
          children: [
            {
              tag: "span",
              className: "comment-head-end",
              children: [{ tag: "span", className: "comment-time" }],
            },
          ],
        },
      ],
    },
    ".comment-time",
  );

  assert.equal(getComputedStyle(time).opacity, "1");
});

test("on a touch screen a failed agent's tab keeps its mark rather than its ×", () => {
  layFor(true);
  const close = drawn(
    {
      className: "luke-tabs",
      children: [
        {
          className: "luke-tab",
          data: { selected: "false", closable: "true", marked: "true" },
          children: [
            { tag: "span", className: "luke-tab-end-mark" },
            { className: "luke-tab-close" },
          ],
        },
      ],
    },
    ".luke-tab-close",
  );

  assert.ok(faded(close));
});

/** A message drawn as the transcript draws it, its words and its actions set where `placement` says, worked by a finger. */
function tappableMessage(placement: MessageActionsPlacement) {
  layFor(true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(hover: none)" }));
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        Message,
        { from: "assistant" },
        createElement(MessageContent, null, "Rerunning the spec on WebKit."),
        createElement(
          MessageActions,
          { placement },
          createElement(MessageAction, { label: "Copy", onClick: () => undefined, children: "⧉" }),
        ),
      ),
    ),
  );
  const part = (selector: string) =>
    container.querySelector<HTMLElement>(selector) ?? assert.fail(selector);
  return {
    actions: () => part(".luke-message-actions"),
    tap: (selector: string) => act(() => part(selector).click()),
  };
}

for (const placement of Object.values(MESSAGE_ACTIONS_PLACEMENT)) {
  test(`on a touch screen a message's ${placement} actions stay hidden at rest, so the transcript is not a column of buttons, stand once the message is tapped, and go with another tap`, () => {
    const message = tappableMessage(placement);
    assert.ok(faded(message.actions()));
    assert.equal(getComputedStyle(message.actions()).pointerEvents, "none");

    message.tap(".message-content");
    assert.ok(standing(message.actions()), "a tap on the message shows them");
    message.tap("button");
    assert.ok(standing(message.actions()), "a tap on one of them keeps them");
    message.tap(".message-content");
    assert.ok(faded(message.actions()), "another tap on the message hides them");
  });
}

test("on a touch screen a press that ends a selection of a message's words leaves its actions as they were", () => {
  const message = tappableMessage(MESSAGE_ACTIONS_PLACEMENT.FLOATING);
  const words = document.querySelector(".message-content") ?? assert.fail("the words");
  window.getSelection()?.selectAllChildren(words);
  message.tap(".message-content");
  assert.ok(faded(message.actions()));
  window.getSelection()?.removeAllRanges();
});

/** An archived agent's row, whose menu a long press opens. */
function archivedAgent(): HTMLElement {
  return drawn(
    {
      tag: "ul",
      children: [{ tag: "li", className: "task-summary-archived-agent", data: { longPress: "" } }],
    },
    "li",
  );
}

test("on a touch screen holding an archived agent, whose menu a long press opens, selects none of its words, so iOS's selection does not race the menu's hold", () => {
  layFor(true);
  const item = archivedAgent();

  assert.equal(getComputedStyle(item).userSelect, "none");
  assert.equal(getComputedStyle(item).getPropertyValue("-webkit-user-select"), "none");
});

test("with a mouse an archived agent's words still select, to be copied", () => {
  layFor(false);
  assert.notEqual(getComputedStyle(archivedAgent()).userSelect, "none");
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

for (const metaAt of [LIST_ROW_META.MIDDLE, LIST_ROW_META.TITLE]) {
  test(`a list row with its metadata at its ${metaAt} lays out alike with its acts shown or not: they stand in its end's track, the metadata keeps its box, and the title its room`, () => {
    layFor(true);
    drawRows(metaAt);
    const [open, other] = [...document.querySelectorAll<HTMLElement>(".luke-list-row")];
    assert.ok(open !== undefined && other !== undefined);
    const laidOut = (row: Element) => {
      const style = (selector: string) =>
        getComputedStyle(row.querySelector(selector) ?? assert.fail(selector));
      const head = row.querySelector(".luke-list-row-head");
      return {
        acts: style(".luke-list-row-actions").gridColumn,
        end: style(".luke-list-row-end").gridColumn,
        meta: style(".luke-list-row-meta").display,
        press: style(".luke-list-row-main").paddingInlineEnd,
        head: head === null ? undefined : getComputedStyle(head).paddingInlineEnd,
      };
    };
    assert.ok(standing(open.querySelector(".luke-list-row-actions") ?? assert.fail("acts")));
    assert.equal(laidOut(open).acts, laidOut(open).end);
    assert.deepEqual(
      laidOut(open),
      laidOut(other),
      "the open row, its acts shown, lays out as the other",
    );
  });
}

/** The track of a row's grid that `selector`'s part of it is drawn in. */
function trackOf(row: Element, selector: string): string {
  return getComputedStyle(row.querySelector(selector) ?? assert.fail(selector)).gridColumn;
}

/** Draws one row offering Pin and Done to the row in hand, its metadata where `metaAt` puts it, under its title a preview and an attachment, its menu open where `menuOpen` says; answers its item. */
function drawHoverRow(
  metaAt: (typeof LIST_ROW_META)[keyof typeof LIST_ROW_META],
  menuOpen = false,
): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        List,
        null,
        createElement(ListRow, {
          title: "Apply Scandinavian design across app",
          description: "Can you take a look before the release?",
          attachments: createElement("span", null, "▤"),
          meta: "2m",
          metaAt,
          menuOpen,
          onPress: () => undefined,
          actionsAt: LIST_ROW_ACTIONS.HOVER,
          actions: [
            createElement(IconButton, { key: "pin", icon: "⌖", label: "Pin" }),
            createElement(IconButton, { key: "done", icon: "✓", label: "Done" }),
          ],
        }),
      ),
    ),
  );
  return container.querySelector<HTMLElement>(".luke-list-row") ?? assert.fail("row");
}

for (const metaAt of [LIST_ROW_META.MIDDLE, LIST_ROW_META.TITLE]) {
  test(`a list row with its metadata at its ${metaAt} stands its hover acts in its metadata's track beside its words, never in the words' own`, () => {
    layFor(false);
    const row = drawHoverRow(metaAt);
    const words = metaAt === LIST_ROW_META.TITLE ? ".luke-list-row-title" : ".luke-list-row-text";

    assert.equal(trackOf(row, ".luke-list-row-actions"), trackOf(row, ".luke-list-row-end"));
    assert.notEqual(trackOf(row, ".luke-list-row-actions"), trackOf(row, words));
    assert.equal(
      getComputedStyle(row.querySelector(".luke-list-row-actions") ?? assert.fail("acts")).gridRow,
      "1",
    );
  });
}

test("a list row with its metadata on its title's line keeps that line's end for its hover acts, its preview and attachments running the words' track and the end's whole under both", () => {
  layFor(false);
  const row = drawHoverRow(LIST_ROW_META.TITLE);
  const across = `${trackOf(row, ".luke-list-row-title")}-start / ${trackOf(row, ".luke-list-row-end")}-end`;

  assert.equal(trackOf(row, ".luke-list-row-description"), across);
  assert.equal(trackOf(row, ".luke-list-row-attachments"), across);
});

/** Draws `drawRows`'s list, answering its open row. */
function drawOpenRow(): Element {
  drawRows(LIST_ROW_META.MIDDLE);
  return document.querySelector(".luke-list-row") ?? assert.fail("the open row");
}

for (const touch of [false, true]) {
  test(`a list row's acts shown ${touch ? "on a touch screen, the open row's" : "with a mouse, its menu open"} draw nothing behind them and fade none of the row's words, so whatever the row stands on shows through`, () => {
    layFor(touch);
    const row = touch ? drawOpenRow() : drawHoverRow(LIST_ROW_META.TITLE, true);
    const acts = row.querySelector(".luke-list-row-actions") ?? assert.fail("acts");
    assert.ok(standing(acts));

    assert.equal(getComputedStyle(acts).backgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(getComputedStyle(acts).backgroundImage, "none");
    for (const part of row.querySelectorAll(".luke-list-row-main, .luke-list-row-main *")) {
      assert.equal(getComputedStyle(part).maskImage, "none", part.className);
    }
  });
}

/** The properties a `transition` moves, each named first in its comma-separated part. */
function transitioned(style: CSSStyleDeclaration): string[] {
  return style.transition
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .toSorted();
}

test("with a mouse a list row's metadata and its acts trade places on opacity and transform alone, the acts sliding in from a step past the end", () => {
  layFor(false);
  const atRest = drawHoverRow(LIST_ROW_META.MIDDLE);
  const inHand = drawHoverRow(LIST_ROW_META.MIDDLE, true);
  const style = (row: Element, selector: string) =>
    getComputedStyle(row.querySelector(selector) ?? assert.fail(selector));

  assert.equal(style(atRest, ".luke-list-row-end").opacity, "1");
  assert.ok(faded(atRest.querySelector(".luke-list-row-actions") ?? assert.fail("acts")));
  assert.notEqual(style(atRest, ".luke-list-row-actions").transform, "none");
  assert.equal(style(inHand, ".luke-list-row-end").opacity, "0");
  assert.equal(style(inHand, ".luke-list-row-actions").opacity, "1");
  assert.equal(style(inHand, ".luke-list-row-actions").transform, "none");
  for (const selector of [".luke-list-row-end", ".luke-list-row-actions"]) {
    assert.deepEqual(transitioned(style(atRest, selector)), ["opacity", "transform"], selector);
  }
});
