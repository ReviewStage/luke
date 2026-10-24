// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_TODO_STATUS, type CodingAgentTodos } from "@luke/features/coding-agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { TranscriptTodosDock } from "./transcript-blocks.js";

/**
 * transcript-todos-dock.test.ts -- the docked to-do list says how far it
 * has got with counts that roll as they change; an item that changes where
 * it stands while drawn has its glyph arrive, and a list drawn as it stands
 * is still; its line leads with its chevron. Synthetic list.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Todos = CodingAgentTodos["todos"];

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A list of three steps, the first `done` of them done and the next in progress. */
function steps(done: number): Todos {
  return ["Read the store", "Write the migration", "Ship it"].map((content, index) => ({
    content,
    status:
      index < done
        ? CODING_AGENT_TODO_STATUS.DONE
        : index === done
          ? CODING_AGENT_TODO_STATUS.IN_PROGRESS
          : CODING_AGENT_TODO_STATUS.PENDING,
  }));
}

/** The dock drawn into the page, and a way to draw it again as the agent writes the list anew. */
function docked(todos: Todos): { view: HTMLElement; to: (next: Todos) => void } {
  const view = document.body.appendChild(document.createElement("div"));
  const root = createRoot(view);
  roots.push(root);
  const draw = (list: Todos) =>
    act(() => root.render(createElement(TranscriptTodosDock, { todos: list, focus: undefined })));
  draw(todos);
  return { view, to: draw };
}

/** The items whose glyph arrived, by their words and where they stand. */
function arrived(view: HTMLElement): string[] {
  return [...view.querySelectorAll(".todo-item")]
    .filter((item) => item.querySelector(".luke-glyph-slot[data-arrival]") !== null)
    .map((item) => `${item.textContent ?? ""}:${item.getAttribute("data-todo-status") ?? ""}`);
}

test("a list drawn as it stands is still, and says how far it has got", () => {
  const { view } = docked(steps(1));
  act(() => (view.querySelector("summary") ?? assert.fail("the dock's line")).click());
  assert.equal(view.querySelectorAll(".todo-item").length, 3, "the list stands open");
  assert.ok(view.textContent?.includes("1 of 3 done"), view.textContent ?? "");
  assert.deepEqual(arrived(view), []);
  assert.equal(view.querySelector(".luke-rolling-number-digit[data-roll]"), null);
});

test("a step done springs its check in, the next taken up arrives, and the count rolls", () => {
  const { view, to } = docked(steps(1));
  const head = view.querySelector("summary") ?? assert.fail("the dock's line");
  act(() => head.click());
  assert.equal(view.querySelectorAll(".todo-item").length, 3, "the list stands open");
  to(steps(2));
  assert.deepEqual(arrived(view), ["Write the migration:done", "Ship it:in_progress"]);
  assert.ok(view.textContent?.includes("2 of 3 done"), view.textContent ?? "");
  const rolled = view.querySelector(".luke-rolling-number-digit[data-roll]");
  assert.equal(rolled?.textContent, "2");
  assert.equal(rolled?.getAttribute("data-roll"), "up");
  const mark = view.querySelector(
    '.todo-item[data-todo-status="done"] > .luke-glyph-slot[data-arrival="check"]',
  );
  assert.equal(mark?.getAttribute("aria-label"), "Done");
});

test("the dock's line leads with its fold's chevron, as every fold's line does, turned down once it stands open", () => {
  const { view } = docked(steps(1));
  const head = view.querySelector("summary") ?? assert.fail("the dock's line");
  const lead = () => head.firstElementChild ?? assert.fail("the line's first mark");
  assert.ok(lead().classList.contains("luke-disclosure-turn"), head.innerHTML);
  assert.equal(lead().getAttribute("data-open"), "false");
  act(() => head.click());
  assert.equal(lead().getAttribute("data-open"), "true");
});
