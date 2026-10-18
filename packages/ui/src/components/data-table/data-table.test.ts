// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { SORT_DIRECTION } from "../../sort-direction.js";
import {
  DATA_TABLE_COLUMN_KIND,
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from "./data-table.js";

/**
 * data-table.test.ts -- a table reads as its headings over its rows, named
 * for what it holds; a sortable heading is a button whose press the caller
 * hears, its cell announcing the order chosen; a table that sorts nothing
 * offers no button, though it still announces an order it was given; a
 * press on a row opens it, while a press on a control in its cells answers
 * for that control alone; a mark column's heading is read, not drawn; and
 * no rows show the empty line in place of the table. Synthetic runs.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Run {
  id: string;
  name: string;
  minutes: number;
}

type RunKey = "name" | "minutes" | "pin";

const RUNS: readonly Run[] = [
  { id: "nightly", name: "Nightly review", minutes: 42 },
  { id: "release", name: "Release notes", minutes: 7 },
  { id: "triage", name: "Issue triage", minutes: 19 },
];

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` into a container in the document and hands the container back. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** The columns over a run, the pin a button of its own whose press `heard` records. */
function columns(heard: string[]): DataTableColumn<Run, RunKey>[] {
  return [
    {
      key: "pin",
      label: "Pinned",
      kind: DATA_TABLE_COLUMN_KIND.MARK,
      cell: (run) =>
        createElement(
          "button",
          { type: "button", onClick: () => heard.push(`pin ${run.id}`) },
          `Pin ${run.name}`,
        ),
    },
    { key: "name", label: "Run", sortable: true, cell: (run) => run.name },
    {
      key: "minutes",
      label: "Minutes",
      kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
      sortable: true,
      cell: (run) => String(run.minutes),
    },
  ];
}

/** Runs sorted as the table's headings ask, each press heard and every row press recorded. */
function SortedRuns({ heard }: { heard: string[] }): React.JSX.Element {
  const [sort, setSort] = useState<DataTableSort<RunKey> | undefined>(undefined);
  const flip = sort?.direction === SORT_DIRECTION.ASCENDING;
  const rows =
    sort === undefined ? RUNS : [...RUNS].sort((a, b) => (a.minutes - b.minutes) * (flip ? 1 : -1));
  return createElement(DataTable<Run, RunKey>, {
    label: "Runs",
    columns: columns(heard),
    rows,
    rowKey: (run) => run.id,
    empty: "No runs yet.",
    sort,
    onSort: (key) => {
      heard.push(`sort ${key}`);
      setSort({
        key,
        direction:
          sort?.key === key && sort.direction === SORT_DIRECTION.DESCENDING
            ? SORT_DIRECTION.ASCENDING
            : SORT_DIRECTION.DESCENDING,
      });
    },
    onRowPress: (run) => heard.push(`open ${run.id}`),
  });
}

/** The column heading reading `label`. */
function heading(container: HTMLElement, label: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>("th")].find((cell) =>
    cell.textContent?.startsWith(label),
  );
  if (found === undefined) throw new Error(`no ${label} heading`);
  return found;
}

/** Each body row's run name, top to bottom. */
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

test("a sortable heading's press is heard, and its cell announces the order chosen", () => {
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
  expect(heard).toEqual(["sort minutes", "sort minutes"]);
});

test("a table that sorts nothing offers no heading to press", () => {
  const container = draw(
    createElement(DataTable<Run, RunKey>, {
      label: "Runs",
      columns: columns([]),
      rows: RUNS,
      rowKey: (run) => run.id,
      empty: "No runs yet.",
    }),
  );

  expect(container.querySelector("th button")).toBeNull();
});

test("a table sorted by its caller, offering no sort, still announces the order its rows are in", () => {
  const container = draw(
    createElement(DataTable<Run, RunKey>, {
      label: "Runs",
      columns: columns([]),
      rows: RUNS,
      rowKey: (run) => run.id,
      empty: "No runs yet.",
      sort: { key: "minutes", direction: SORT_DIRECTION.DESCENDING },
    }),
  );

  expect(container.querySelector("th button")).toBeNull();
  expect(heading(container, "Minutes").getAttribute("aria-sort")).toBe("descending");
  expect(heading(container, "Run").hasAttribute("aria-sort")).toBe(false);
});

test("a press on a row opens it, and a press on a control in its cells is that control's alone", () => {
  const heard: string[] = [];
  const container = draw(createElement(SortedRuns, { heard }));
  const [nightly, release] = [...container.querySelectorAll("tbody tr")];

  press(nightly?.querySelectorAll("td")[2]);
  press(release?.querySelector("td button"));

  expect(heard).toEqual(["open nightly", "pin release"]);
});

test("no rows show the empty line in place of the table", () => {
  const container = draw(
    createElement(DataTable<Run, RunKey>, {
      label: "Runs",
      columns: columns([]),
      rows: [],
      rowKey: (run) => run.id,
      empty: "No runs yet.",
    }),
  );

  expect(container.querySelector("table")).toBeNull();
  expect(container.textContent).toBe("No runs yet.");
});
