// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_TODO_STATUS, type CodingAgentTodos } from "@luke/features/coding-agent-wire";
import { TerminalIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { TOOL_STATE, ToolLine } from "../ai-elements/tool";
import { TranscriptTodos } from "./transcript-blocks";

/**
 * transcript-todos.test.ts -- an agent's to-do list, as a call's row opens
 * onto it (the dock over the composer draws the same items): each item wears its
 * status's glyph, the one in progress the working mark a running call
 * wears, and an item's words stand in a box of their own beside the glyph,
 * so a wrapped line hangs under the words rather than under the glyph.
 * Synthetic items.
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

test("each to-do wears its status's glyph, the one in progress a running call's working mark", () => {
  const runningCall = drawn(
    createElement(ToolLine, {
      state: TOOL_STATE.INPUT_AVAILABLE,
      icon: createElement(TerminalIcon),
      label: "Ran",
      subject: "pnpm test",
    }),
  );
  const workingMark = runningCall.querySelector(".state-glyph svg")?.outerHTML;
  assert.ok(workingMark?.includes("working-mark"), "a running call wears the working mark");
  for (const item of items(transcriptList())) {
    const glyph = item.seat.querySelector(".state-glyph > svg");
    assert.ok(glyph !== null, `a ${item.status} item's glyph stands in the shared seat`);
    switch (item.status) {
      case CODING_AGENT_TODO_STATUS.DONE:
        assert.equal(item.seat.getAttribute("aria-label"), "Done");
        assert.ok(glyph.classList.contains("lucide-circle-check"));
        break;
      case CODING_AGENT_TODO_STATUS.IN_PROGRESS:
        assert.equal(item.seat.getAttribute("aria-label"), "In progress");
        assert.equal(glyph.outerHTML, workingMark);
        break;
      case CODING_AGENT_TODO_STATUS.PENDING:
        assert.equal(item.seat.getAttribute("aria-label"), "Pending");
        assert.ok(glyph.classList.contains("lucide-circle"));
        break;
      default:
        assert.fail(`unknown status ${item.status}`);
    }
  }
});

test("an item's words stand in a box of their own beside its glyph, so a wrapped line hangs under them", () => {
  const drawnItems = items(transcriptList());
  assert.deepEqual(
    drawnItems.map((item) => item.words.textContent),
    TODOS.map((todo) => todo.content),
  );
  for (const item of drawnItems) {
    assert.equal(item.seat.textContent, "", "the glyph's seat holds no words to wrap under it");
  }
});

test("a write that failed says why under its list", () => {
  const surface = transcriptList("The list could not be read.");
  assert.equal(items(surface).length, TODOS.length);
  assert.equal(surface.querySelector("[role='alert']")?.textContent, "The list could not be read.");
});
