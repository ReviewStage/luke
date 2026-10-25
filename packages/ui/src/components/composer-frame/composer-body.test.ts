// @vitest-environment jsdom

import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AttachmentChip } from "../attachment-chip/attachment-chip.js";
import { ComposerBody } from "./composer-body.js";
import { ComposerFoot } from "./composer-foot.js";
import { COMPOSER_ELEMENT, ComposerFrame } from "./composer-frame.js";

/**
 * composer-body.test.ts -- a message box holds its files over its words, as
 * the sent message draws them, so the keyboard reaches a file before the
 * field and the field before the foot.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Whether `first` comes before `then` in the document, which is the order Tab walks them in. */
function before(first: Element, then: Element): boolean {
  return (first.compareDocumentPosition(then) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The one element `selector` finds, which the test fails without. */
function only(container: HTMLElement, selector: string): Element {
  const found = container.querySelector(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

test("a box's attached files stand before its field, and its field before its send", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(ComposerFrame, {
        as: COMPOSER_ELEMENT.FORM,
        children: createElement(
          Fragment,
          null,
          createElement(ComposerBody, {
            files: createElement(AttachmentChip, {
              name: "inbox.png",
              onRemove: () => undefined,
            }),
            children: createElement("textarea", { "aria-label": "Message" }),
          }),
          createElement(ComposerFoot, { send: { label: "Send", empty: false } }),
        ),
      }),
    ),
  );
  const remove = only(container, '[aria-label="Remove inbox.png"]');
  const field = only(container, '[aria-label="Message"]');
  const send = only(container, '[aria-label="Send"]');
  expect(before(remove, field)).toBe(true);
  expect(before(field, send)).toBe(true);
});
