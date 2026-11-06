// @vitest-environment jsdom

import { act, createElement, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DataTable,
  type DataTableColumns,
} from "./data-table.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Run {
  id: string;
  name: string;
  minutes: number;
  pinned: boolean;
}

const RUNS: readonly Run[] = [
  { id: "nightly", name: "Nightly review", minutes: 42, pinned: false },
  { id: "release", name: "Release notes", minutes: 7, pinned: true },
  { id: "triage", name: "Issue triage", minutes: 19, pinned: false },
];

const PINNED_FIRST = [{ id: "pin", desc: true }];

const column = createDataTableColumnHelper<Run>();

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function columns(heard: string[]): DataTableColumns<Run> {
  return column.columns([
    column.accessor((run) => run.pinned, {
      id: "pin",
      header: "Pinned",
      meta: { kind: DATA_TABLE_COLUMN_KIND.MARK },
      cell: ({ row }) =>
        createElement(
          "button",
          { type: "button", onClick: () => heard.push(`pin ${row.original.id}`) },
          `Pin ${row.original.name}`,
        ),
    }),
    column.accessor((run) => run.name, {
      id: "name",
      header: "Run",
      sortFn: "text",
      sortDescFirst: false,
    }),
    column.accessor((run) => run.minutes, {
      id: "minutes",
      header: "Minutes",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      sortFn: "basic",
      sortDescFirst: true,
      cell: ({ getValue }) => String(getValue()),
    }),
  ]);
}

function SortedRuns({
  heard,
  leading,
}: {
  heard: string[];
  leading?: typeof PINNED_FIRST;
}): React.JSX.Element {
  const runColumns = useMemo(() => columns(heard), [heard]);
  return createElement(DataTable<Run>, {
    label: "Runs",
    columns: runColumns,
    rows: RUNS,
    getRowId: (run) => run.id,
    empty: "No runs yet.",
    leadingSorting: leading,
    onSortingChange: (sorting) =>
      heard.push(
        `sort ${sorting.map((sort) => `${sort.id} ${sort.desc ? "desc" : "asc"}`).join()}`,
      ),
    onRowPress: (run) => heard.push(`open ${run.id}`),
  });
}

function heading(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>("th")].find((cell) =>
    cell.textContent?.startsWith(label),
  );
  if (found === undefined) throw new Error(`no ${label} heading`);
  return found;
}

function order(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr")].map(
    (row) => row.querySelectorAll("td")[1]?.textContent ?? "",
  );
}

function press(element: Element | null | undefined): void {
  if (!element) throw new Error("nothing to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

test("a table reads as its headings over its rows, named for what it holds", () => {
  const container = draw(createElement(SortedRuns, { heard: [] }));
  const table = container.querySelector("table");

  expect(table?.getAttribute("aria-label")).toBe("Runs");
  expect([...container.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
    "Pinned",
    "Run",
    "Minutes",
  ]);
  expect(order(container)).toEqual(["Nightly review", "Release notes", "Issue triage"]);
  expect(container.querySelector("tbody tr")?.textContent).toContain("42");
});

test("a sortable heading's press sorts by it, then flips it, and its cell announces the order chosen", () => {
  const heard: string[] = [];
  const container = draw(createElement(SortedRuns, { heard }));

  expect(heading(container, "Minutes").hasAttribute("aria-sort")).toBe(false);
  press(heading(container, "Minutes").querySelector("button"));
  expect(heading(container, "Minutes").getAttribute("aria-sort")).toBe("descending");
  expect(order(container)).toEqual(["Nightly review", "Issue triage", "Release notes"]);

  press(heading(container, "Minutes").querySelector("button"));
  expect(heading(container, "Minutes").getAttribute("aria-sort")).toBe("ascending");
  expect(order(container)).toEqual(["Release notes", "Issue triage", "Nightly review"]);
  expect(heading(container, "Run").hasAttribute("aria-sort")).toBe(false);

  press(heading(container, "Run").querySelector("button"));
  expect(order(container)).toEqual(["Issue triage", "Nightly review", "Release notes"]);
  expect(heard).toEqual(["sort minutes desc", "sort minutes asc", "sort name asc"]);
});

test("an order the caller leads with stands before every order a heading chooses", () => {
  const heard: string[] = [];
  const container = draw(createElement(SortedRuns, { heard, leading: PINNED_FIRST }));

  expect(order(container)).toEqual(["Release notes", "Nightly review", "Issue triage"]);
  press(heading(container, "Minutes").querySelector("button"));
  press(heading(container, "Minutes").querySelector("button"));

  expect(order(container)).toEqual(["Release notes", "Issue triage", "Nightly review"]);
  expect(heard).toEqual(["sort minutes desc", "sort minutes asc"]);
});

test("a press on a row opens it, and a press on a control in its cells is that control's alone", () => {
  const heard: string[] = [];
  const container = draw(createElement(SortedRuns, { heard }));
  const [nightly, release] = [...container.querySelectorAll("tbody tr")];

  press(nightly?.querySelectorAll("td")[2]);
  press(release?.querySelector("td button"));

  expect(heard).toEqual(["open nightly", "pin release"]);
});

test("a row its caller says has nothing to open does not open", () => {
  const heard: string[] = [];
  const container = draw(
    createElement(DataTable<Run>, {
      label: "Runs",
      columns: columns(heard),
      rows: RUNS,
      getRowId: (run) => run.id,
      empty: "No runs yet.",
      onRowPress: (run) => heard.push(`open ${run.id}`),
      rowPressable: (run) => run.id !== "release",
    }),
  );
  const [nightly, release] = [...container.querySelectorAll("tbody tr")];

  press(release?.querySelectorAll("td")[2]);
  press(nightly?.querySelectorAll("td")[2]);

  expect(heard).toEqual(["open nightly"]);
});

test("a long table draws only the rows near the view, telling a reader how many it holds and where each stands", () => {
  const many = Array.from({ length: 500 }, (_, at) => ({
    id: `run-${at}`,
    name: `Run ${at}`,
    minutes: at,
    pinned: false,
  }));
  const container = draw(
    createElement(DataTable<Run>, {
      label: "Runs",
      columns: columns([]),
      rows: many,
      getRowId: (run) => run.id,
      empty: "No runs yet.",
    }),
  );
  const drawn = [...container.querySelectorAll("tbody tr[aria-rowindex]")];

  expect(drawn.length).toBeGreaterThan(0);
  expect(drawn.length).toBeLessThan(many.length);
  expect(container.querySelector("table")?.getAttribute("aria-rowcount")).toBe("501");
  expect(
    drawn.every(
      (row) =>
        row.getAttribute("aria-rowindex") === String(Number(row.getAttribute("data-index")) + 2),
    ),
  ).toBe(true);
});

test("no rows show the empty line in place of the table", () => {
  const container = draw(
    createElement(DataTable<Run>, {
      label: "Runs",
      columns: columns([]),
      rows: [],
      getRowId: (run) => run.id,
      empty: "No runs yet.",
    }),
  );

  expect(container.querySelector("table")).toBeNull();
  expect(container.textContent).toBe("No runs yet.");
});
