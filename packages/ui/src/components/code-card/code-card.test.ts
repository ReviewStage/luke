// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CodeCard } from "./code-card.js";

/**
 * code-card.test.ts -- a code card names its lines in its header with a
 * Copy named "Copy code"; a block over 40 lines shows its first 40 over
 * "Show all", which shows the rest and then offers "Show less"; Copy copies
 * the whole block however it stands; and the lines the host coloured keep
 * their runs' colours, cut as the block is. Synthetic code.
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

function draw(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

/** A block of `count` numbered lines. */
function block(count: number): string {
  return Array.from({ length: count }, (_, at) => `const line${at + 1} = ${at + 1};`).join("\n");
}

/** The lines the card shows now. */
function shownLines(): string[] {
  const body = document.querySelector("pre") ?? expect.fail("No code body");
  return (body.textContent ?? "").split("\n");
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent) === name,
  );
}

function press(name: string): void {
  const button = buttonNamed(name) ?? expect.fail(`No "${name}" button`);
  act(() => button.click());
}

const noCopy = async (): Promise<void> => {};

test("a code card names its lines in its header, with Copy beside it", () => {
  draw(createElement(CodeCard, { title: "typescript", code: block(3), copy: noCopy }));
  expect(document.querySelector("figcaption")?.textContent).toBe("typescript");
  expect(buttonNamed("Copy code")).toBeDefined();
  expect(shownLines()).toEqual(block(3).split("\n"));
});

test("a 60-line block shows its first 40 lines, with Show all", () => {
  const code = block(60);
  draw(createElement(CodeCard, { title: "typescript", code, copy: noCopy }));
  expect(shownLines()).toEqual(code.split("\n").slice(0, 40));
  expect(buttonNamed("Show all")?.getAttribute("aria-expanded")).toBe("false");
});

test("Show all reveals the rest of the block, and Show less cuts it again", () => {
  const code = block(60);
  draw(createElement(CodeCard, { title: "typescript", code, copy: noCopy }));
  press("Show all");
  expect(shownLines()).toEqual(code.split("\n"));
  expect(buttonNamed("Show less")?.getAttribute("aria-expanded")).toBe("true");
  press("Show less");
  expect(shownLines()).toHaveLength(40);
});

test("a block of 40 lines, its last newline aside, is whole and offers nothing more", () => {
  draw(createElement(CodeCard, { title: "text", code: `${block(40)}\n`, copy: noCopy }));
  expect(shownLines()).toHaveLength(40);
  expect(buttonNamed("Show all")).toBeUndefined();
});

test("Copy copies the whole block, even while it is cut", async () => {
  const code = block(60);
  const copied: string[] = [];
  draw(
    createElement(CodeCard, {
      title: "typescript",
      code,
      copy: async (words: string) => {
        copied.push(words);
      },
    }),
  );
  await act(async () => buttonNamed("Copy code")?.click());
  expect(copied).toEqual([code]);
});

test("the lines the host coloured keep each run's colours, cut where the block is", () => {
  const code = block(45);
  const lines = code
    .split("\n")
    .map((line) => [
      { text: "const", color: "#ff7b72", lightColor: "#cf222e" },
      { text: line.slice("const".length) },
    ]);
  draw(createElement(CodeCard, { title: "typescript", code, lines, copy: noCopy }));
  expect(shownLines()).toEqual(code.split("\n").slice(0, 40));
  const keyword = document.querySelector("pre span") as HTMLElement | null;
  expect(keyword?.textContent).toBe("const");
  expect(keyword?.style.getPropertyValue("--luke-code-run-dark")).toBe("#ff7b72");
  expect(keyword?.style.getPropertyValue("--luke-code-run-light")).toBe("#cf222e");
});
