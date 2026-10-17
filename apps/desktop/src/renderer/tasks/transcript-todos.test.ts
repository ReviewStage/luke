// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_TODO_STATUS, type CodingAgentTodos } from "@luke/features/coding-agent-wire";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TOOL_STATE } from "../ai-elements/tool";
import { TranscriptTodos } from "./transcript-blocks";

/**
 * transcript-todos.test.ts -- an agent's to-do list, as a call's row opens
 * onto it (the dock over the composer draws the same items): each item
 * says its words and its status, and a failed write says why. Synthetic
 * items.
 */

const TODOS: CodingAgentTodos["todos"] = [
  { content: "Read the record-write path", status: CODING_AGENT_TODO_STATUS.DONE },
  {
    content:
      "Append channel: send without waiting for the record write to land, and keep the order the turns were said in",
    status: CODING_AGENT_TODO_STATUS.IN_PROGRESS,
  },
  { content: "Run the store tests", status: CODING_AGENT_TODO_STATUS.PENDING },
];

/** The node drawn as `node` is, in a box of its own. */
function drawn(node: ReactNode): HTMLElement {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(createElement("div", null, node));
  return box;
}

/** A call's row opening onto the list, open. */
function transcriptList(errorText?: string): HTMLElement {
  return drawn(
    createElement(TranscriptTodos, {
      defaultOpen: true,
      state: errorText === undefined ? TOOL_STATE.OUTPUT_AVAILABLE : TOOL_STATE.OUTPUT_ERROR,
      subject: "1 of 3 done",
      todos: TODOS,
      errorText,
    }),
  );
}

/** Each item's glyph seat and words, in the list's order. */
function items(surface: HTMLElement): { seat: Element; words: Element; status: string }[] {
  return [...surface.querySelectorAll("li[data-todo-status]")].map((item) => {
    const [seat, words, ...rest] = item.children;
    assert.ok(seat !== undefined && words !== undefined, "an item is its glyph and its words");
    assert.equal(rest.length, 0, "an item holds nothing beside its glyph and its words");
    return { seat, words, status: item.getAttribute("data-todo-status") ?? "" };
  });
}

test("each to-do says its status", () => {
  for (const item of items(transcriptList())) {
    switch (item.status) {
      case CODING_AGENT_TODO_STATUS.DONE:
        assert.equal(item.seat.getAttribute("aria-label"), "Done");
        break;
      case CODING_AGENT_TODO_STATUS.IN_PROGRESS:
        assert.equal(item.seat.getAttribute("aria-label"), "In progress");
        break;
      case CODING_AGENT_TODO_STATUS.PENDING:
        assert.equal(item.seat.getAttribute("aria-label"), "Pending");
        break;
      default:
        assert.fail(`unknown status ${item.status}`);
    }
  }
});

test("each to-do says its words, in the list's order", () => {
  assert.deepEqual(
    items(transcriptList()).map((item) => item.words.textContent),
    TODOS.map((todo) => todo.content),
  );
});

test("a write that failed says why under its list", () => {
  const surface = transcriptList("The list could not be read.");
  assert.equal(items(surface).length, TODOS.length);
  assert.equal(surface.querySelector("[role='alert']")?.textContent, "The list could not be read.");
});
