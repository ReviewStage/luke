// @vitest-environment jsdom

import { Schema } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test } from "vitest";
import { keptKey, useKept } from "./use-kept.js";

/**
 * use-kept.test.ts -- a view choice is remembered: a surface drawn again
 * after it went opens at the choice it last kept, one never chosen opens at
 * its initial value, and so does one an earlier build kept in a shape that
 * no longer reads.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const SORT = {
  LATEST: "latest",
  OLDEST: "oldest",
} as const;

type Sort = (typeof SORT)[keyof typeof SORT];

const KEPT = {
  SORT: keptKey<Sort>(
    "luke.testSort",
    Schema.fromJsonString(Schema.Literals([SORT.LATEST, SORT.OLDEST])),
  ),
} as const;

/** The door the surface last drew with, which chooses another sort. */
let chooseSort: ((next: Sort) => void) | undefined;

/** A list's sort, drawn as its words. */
function SortedList(): React.JSX.Element {
  const [sort, choose] = useKept(KEPT.SORT, SORT.LATEST);
  chooseSort = choose;
  return createElement("p", null, sort);
}

function draw(): void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(SortedList)));
}

function remount(): void {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  draw();
}

function shown(): string | null {
  return document.querySelector("p")?.textContent ?? null;
}

test("a choice never made opens at its initial value", () => {
  draw();
  expect(shown()).toBe(SORT.LATEST);
});

test("a surface drawn again opens at the choice it last kept", () => {
  draw();
  act(() => chooseSort?.(SORT.OLDEST));
  expect(shown()).toBe(SORT.OLDEST);
  remount();
  expect(shown()).toBe(SORT.OLDEST);
});

test("a choice kept in a shape that no longer reads opens at its initial value", () => {
  window.localStorage.setItem(KEPT.SORT.name, JSON.stringify("waiting-longest"));
  draw();
  expect(shown()).toBe(SORT.LATEST);
  act(() => chooseSort?.(SORT.OLDEST));
  remount();
  expect(shown()).toBe(SORT.OLDEST);
});
