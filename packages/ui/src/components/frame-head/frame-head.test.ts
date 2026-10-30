// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { FrameHead, FramePlace } from "./frame-head.js";

/**
 * frame-head.test.ts -- a task's head names the task by its key and name in
 * a chip that opens it, says how many things wait on the reader in words
 * that agree with the count, takes a press on that count to go to them, and
 * says nothing of a count of none; and a place that is no task is named as
 * the page's heading, the places above it before it, each a press back.
 * Synthetic tasks.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** `element` drawn into the document. */
function draw(element: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const NOUN = { one: "needs you", many: "need you" } as const;

/** The head's button whose words are `words`. */
function press(head: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...head.querySelectorAll("button")].find((button) => button.textContent === words);
}

test("names the task by its key and name in a chip that opens it, and goes to what waits on a press", () => {
  const opened: string[] = [];
  const head = draw(
    createElement(FrameHead, {
      taskKey: "ACME-42",
      name: "Launch checklist",
      onOpen: () => opened.push("task"),
      waiting: { count: 3, noun: NOUN, onOpen: () => opened.push("inbox") },
    }),
  );
  act(() => press(head, "ACME-42Launch checklist")?.click());
  act(() => press(head, "3 need you")?.click());
  expect(opened).toEqual(["task", "inbox"]);
});

test("says one waiting thing in the singular, and nothing at all of none", () => {
  const one = draw(
    createElement(FrameHead, {
      name: "Launch checklist",
      onOpen: () => undefined,
      waiting: { count: 1, noun: NOUN, onOpen: () => undefined },
    }),
  );
  expect(press(one, "1 needs you")).toBeDefined();
  const none = draw(
    createElement(FrameHead, {
      name: "Launch checklist",
      onOpen: () => undefined,
      waiting: { count: 0, noun: NOUN, onOpen: () => undefined },
    }),
  );
  expect(none.textContent).toBe("Launch checklist");
});

test("names a place that is no task as the page's heading, the places above it before it, each a press back", () => {
  const back: string[] = [];
  const head = draw(
    createElement(FramePlace, {
      title: "Check the 2.14.0 deploy",
      trail: [
        { label: "Automations", onPress: () => back.push("automations") },
        { label: "Check each deploy", onPress: () => back.push("automation") },
      ],
    }),
  );
  act(() => press(head, "Check each deploy")?.click());
  expect(back).toEqual(["automation"]);
  expect(draw(createElement(FramePlace, { title: "Inbox" })).querySelector("h1")?.textContent).toBe(
    "Inbox",
  );
});
