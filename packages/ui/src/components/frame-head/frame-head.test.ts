// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { FrameHead, FramePlace } from "./frame-head.js";

/**
 * frame-head.test.ts -- a task's head names the task by its path, the tasks
 * it is a child of then the task, each by its name and key and a press that
 * opens it, the task current; and a place that is no task is named as the
 * page's heading, the places above it before it, each a press back.
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

/** The head's button whose words are `words`. */
function press(head: HTMLElement, words: string): HTMLButtonElement | undefined {
  return [...head.querySelectorAll("button")].find((button) => button.textContent === words);
}

test("names a child task by its path, its parent then the task, each by name and key and a press that opens it", () => {
  const opened: string[] = [];
  const head = draw(
    createElement(FrameHead, {
      ancestors: [{ name: "Launch", taskKey: "ACME-40", onOpen: () => opened.push("parent") }],
      task: { name: "Launch checklist", taskKey: "ACME-42", onOpen: () => opened.push("task") },
    }),
  );
  act(() => press(head, "Launch checklistACME-42")?.click());
  act(() => press(head, "LaunchACME-40")?.click());
  expect(opened).toEqual(["task", "parent"]);
  expect(head.querySelector("[aria-current='page']")?.textContent).toBe("Launch checklistACME-42");
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
