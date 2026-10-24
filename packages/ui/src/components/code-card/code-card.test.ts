// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { CODE_ROW, CodeCard, type CodeRow } from "./code-card.js";

/**
 * code-card.test.ts -- a code card names its lines in its header with a
 * Copy named "Copy code"; a block over 40 lines shows its first 40 over
 * "Show all", which shows the rest and then offers "Show less"; Copy copies
 * the whole block however it stands, and the rest, drawn hidden until
 * found, shows when a find's match lands in it; and the lines the host coloured keep
 * their runs' colours, cut as the block is. A block drawn as rows tints each
 * by what it does; one may copy other words than it shows; and one whose
 * body the caller draws keeps the header, the Copy of the lines it names,
 * and the actions beside it, with no cut. Synthetic code.
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

/** The lines the card shows now, less what it holds `hidden` and the newline that closes the last. */
function shownLines(): string[] {
  const body = document.querySelector("pre")?.cloneNode(true);
  if (!(body instanceof Element)) return expect.fail("No code body");
  for (const hidden of body.querySelectorAll("[hidden]")) hidden.remove();
  return (body.textContent ?? "").replace(/\n$/u, "").split("\n");
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

test("a cut block's rest is drawn hidden until found, and a match landing there shows it whole", () => {
  const code = block(60);
  draw(createElement(CodeCard, { title: "typescript", code, copy: noCopy }));
  const rest = document.querySelector("pre [hidden]") ?? expect.fail("No hidden rest");
  expect(rest.getAttribute("hidden")).toBe("until-found");
  expect(rest.textContent?.split("\n")).toEqual(code.split("\n").slice(40));
  act(() => {
    rest.dispatchEvent(new Event("beforematch", { bubbles: true }));
  });
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

test("a block drawn as rows tints each row by what it does, cut at 40 like any block", () => {
  const code = block(45);
  const rows: CodeRow[] = code
    .split("\n")
    .map((_, at) => (at % 2 === 0 ? CODE_ROW.ADDED : CODE_ROW.REMOVED));
  draw(createElement(CodeCard, { title: "diff", code, rows, copy: noCopy }));
  const shown = [...document.querySelectorAll("pre [data-row]")].filter(
    (row) => row.closest("[hidden]") === null,
  );
  expect(shown).toHaveLength(40);
  expect(shown.slice(0, 2).map((row) => row.getAttribute("data-row"))).toEqual([
    "added",
    "removed",
  ]);
  expect(shown[1]?.textContent).toBe("const line2 = 2;");
  expect(buttonNamed("Show all")).toBeDefined();
});

test("a block may copy words other than those it shows", async () => {
  const copied: string[] = [];
  draw(
    createElement(CodeCard, {
      title: "Suggested change",
      code: "old\nnew",
      rows: [CODE_ROW.REMOVED, CODE_ROW.ADDED],
      copied: "new",
      copy: async (words: string) => {
        copied.push(words);
      },
    }),
  );
  await act(async () => buttonNamed("Copy code")?.click());
  expect(copied).toEqual(["new"]);
});

test("a body the caller draws stands in place of the lines, uncut, beside the header's actions and Copy of the lines it names", async () => {
  const copied: string[] = [];
  draw(
    createElement(CodeCard, {
      title: "src/seats.ts",
      body: createElement("div", { "data-body": "" }, "drawn elsewhere"),
      copied: "lines named",
      actions: createElement("button", { type: "button", "aria-label": "Open file" }),
      copy: async (words: string) => {
        copied.push(words);
      },
    }),
  );
  expect(document.querySelector("pre")).toBeNull();
  expect(document.querySelector("[data-body]")?.textContent).toBe("drawn elsewhere");
  expect(buttonNamed("Show all")).toBeUndefined();
  expect(buttonNamed("Open file")).toBeDefined();
  await act(async () => buttonNamed("Copy code")?.click());
  expect(copied).toEqual(["lines named"]);
});

test("a body with nothing to copy draws no Copy", () => {
  draw(createElement(CodeCard, { title: "src/seats.ts", body: "reading", copy: noCopy }));
  expect(buttonNamed("Copy code")).toBeUndefined();
});

test("a block drawn as rows keeps an empty last row", () => {
  draw(
    createElement(CodeCard, {
      title: "Suggested change",
      code: "old\n",
      rows: [CODE_ROW.REMOVED, CODE_ROW.ADDED],
      copy: noCopy,
    }),
  );
  expect([...document.querySelectorAll("pre [data-row]")].map((row) => row.textContent)).toEqual([
    "old",
    "\n",
  ]);
});
