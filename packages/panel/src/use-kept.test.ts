// @vitest-environment jsdom

import { Schema } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
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
  vi.restoreAllMocks();
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

/** Two surfaces holding the sort, and the doors the first drew with. */
let doors:
  | { choose: (next: Sort) => void; change: (change: (kept: Sort) => Sort) => void }
  | undefined;

function TwoLists(): React.JSX.Element {
  const [sort, choose, change] = useKept(KEPT.SORT, SORT.LATEST);
  doors = { choose, change };
  const [other] = useKept(KEPT.SORT, SORT.LATEST);
  return createElement("p", null, `${sort} ${other}`);
}

test("a choice made in one surface is drawn at once in every other that holds the key", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(TwoLists)));
  expect(shown()).toBe(`${SORT.LATEST} ${SORT.LATEST}`);
  act(() => doors?.choose(SORT.OLDEST));
  expect(shown()).toBe(`${SORT.OLDEST} ${SORT.OLDEST}`);
});

test("a change is made over what storage holds now, and one that answers what it was handed keeps nothing", () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(TwoLists)));
  // Another window kept a sort after this one drew.
  window.localStorage.setItem(KEPT.SORT.name, JSON.stringify(SORT.OLDEST));
  act(() => doors?.change((held) => (held === SORT.OLDEST ? SORT.LATEST : SORT.OLDEST)));
  expect(window.localStorage.getItem(KEPT.SORT.name)).toBe(JSON.stringify(SORT.LATEST));
  window.localStorage.removeItem(KEPT.SORT.name);
  act(() => doors?.change((held) => held));
  expect(window.localStorage.getItem(KEPT.SORT.name)).toBeNull();
});

test("where storage refuses a write, a change goes on from the choice drawn, not the older one it holds", () => {
  window.localStorage.setItem(KEPT.SORT.name, JSON.stringify(SORT.LATEST));
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(TwoLists)));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const flip = (held: Sort): Sort => (held === SORT.LATEST ? SORT.OLDEST : SORT.LATEST);
  act(() => doors?.change(flip));
  expect(shown()).toBe(`${SORT.OLDEST} ${SORT.OLDEST}`);
  act(() => doors?.change(flip));
  expect(shown()).toBe(`${SORT.LATEST} ${SORT.LATEST}`);
  act(() => doors?.change(flip));
  expect(shown()).toBe(`${SORT.OLDEST} ${SORT.OLDEST}`);
});

/** A record of sorts by list, which a change of one list's sort keeps the others' of. */
const storedSorts = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Literals([SORT.LATEST, SORT.OLDEST])),
);

type Sorts = typeof storedSorts.Type;

const SORTS = keptKey("luke.testSorts", storedSorts);

let sortsDoors: { change: (change: (kept: Sorts) => Sorts) => void } | undefined;

function Lists(): null {
  const [, , change] = useKept<Sorts>(SORTS, {});
  sortsDoors = { change };
  return null;
}

test("where storage refused a write, an entry another window kept since is changed over, not lost", () => {
  window.localStorage.setItem(SORTS.name, JSON.stringify({ a: SORT.LATEST }));
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Lists)));
  const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  act(() => sortsDoors?.change((held) => ({ ...held, a: SORT.OLDEST })));
  refuse.mockRestore();
  // Another window keeps an entry of its own, which this one's next change must not undo.
  window.localStorage.setItem(SORTS.name, JSON.stringify({ a: SORT.LATEST, b: SORT.OLDEST }));
  act(() => sortsDoors?.change((held) => ({ ...held, a: SORT.OLDEST })));
  expect(JSON.parse(window.localStorage.getItem(SORTS.name) ?? "{}")).toEqual({
    a: SORT.OLDEST,
    b: SORT.OLDEST,
  });
});
