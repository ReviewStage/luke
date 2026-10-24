// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { MessageActions } from "./message.js";
import { MESSAGE_LINE_ALIGN, MessageLine } from "./message-line.js";

/**
 * message-line.test.ts -- the line under a message reads who sent it, when,
 * then its actions, whichever of them the message has; a message with none
 * has no line, and the time is a call's day and clock.
 */

/** Oct 14, 2026, 3:42 PM, on the machine's own clock. */
const AT = new Date(2026, 9, 14, 15, 42).getTime();

/** The line's markup, as a page would draw it, parsed. */
function drawn(props: Parameters<typeof MessageLine>[0]): HTMLElement | null {
  const page = new DOMParser().parseFromString(
    renderToStaticMarkup(createElement(MessageLine, props)),
    "text/html",
  );
  return page.querySelector<HTMLElement>(".luke-message-line");
}

const ACTIONS = createElement(MessageActions, null, "Copy");

test("a line reads who sent it, then when, then its actions", () => {
  const line = drawn({ sender: "Ada", at: AT, actions: ACTIONS });
  assert.deepEqual(
    [...(line?.children ?? [])].map((part) => part.className),
    ["luke-message-line-sender", "luke-message-line-time", "luke-message-actions"],
  );
  assert.equal(line?.querySelector(".luke-message-line-sender")?.textContent, "Ada");
  assert.match(line?.querySelector(".luke-message-line-time")?.textContent ?? "", /·.*3:42/u);
});

test("a message from the reader names no one, so its time stands without a dot before it", () => {
  const line = drawn({ at: AT, actions: ACTIONS });
  assert.equal(line?.querySelector(".luke-message-line-sender"), null);
  assert.doesNotMatch(line?.textContent ?? "", /·/u);
});

test("a message with no sender, no time and no actions has no line", () => {
  assert.equal(drawn({ sender: null, actions: false }), null);
});

test("a received message's line keeps to the column's left", () => {
  assert.equal(drawn({ sender: "Ada", align: MESSAGE_LINE_ALIGN.START })?.dataset.align, "start");
  assert.equal(drawn({ sender: "Ada" })?.dataset.align, "end");
});
