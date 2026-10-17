// @vitest-environment jsdom
import type { AccountsTableRow } from "@luke/ui/accounts-sort";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import {
  ACCOUNTS_TABLE_MIN_WIDTH,
  AccountsTable,
} from "../src/admin/accounts-table/accounts-table";

/**
 * admin-accounts-table.test.ts -- the one table both account lists draw
 * through: a row names its account, marks an admin in words, and counts its
 * days and calls; a sortable header's press reorders the rows, says the
 * order it chose, and is remembered for the next visit; a press on a row or
 * on its name opens the account, a modified press on the name is left to the
 * browser, and a star's press asks to star without opening the row.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ADA: AccountsTableRow = {
  id: "account-ada",
  name: "Ada Lovelace",
  email: "ada@example.test",
  image: null,
  admin: true,
  activeDays: 12,
  lastActiveDay: "2026-10-12",
  calls: 1204,
};

const GRACE: AccountsTableRow = {
  id: "account-grace",
  name: "",
  email: "grace@example.test",
  image: null,
  admin: false,
  activeDays: 3,
  lastActiveDay: null,
  calls: 37,
};

const ZED: AccountsTableRow = {
  id: "account-zed",
  name: "Zed Example",
  email: "zed@example.test",
  image: null,
  admin: false,
  activeDays: 20,
  lastActiveDay: "2026-10-14",
  calls: 9,
};

interface Mounted {
  table: HTMLElement;
  opened: string[];
  toggled: Array<[string, boolean]>;
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  window.localStorage.clear();
  document.body.replaceChildren();
});

/** The table over `rows`, sortable and starred where asked, with Zed starred. */
function mount(
  rows: readonly AccountsTableRow[],
  { sortable = false, starred = false }: { sortable?: boolean; starred?: boolean } = {},
): Mounted {
  const opened: string[] = [];
  const toggled: Array<[string, boolean]> = [];
  const table = document.createElement("div");
  document.body.append(table);
  const favorite = {
    starred: (row: AccountsTableRow) => row.id === ZED.id,
    onToggle: (id: string, favorite: boolean) => toggled.push([id, favorite]),
  };
  const props: Parameters<typeof AccountsTable<AccountsTableRow>>[0] = {
    rows,
    windowDays: 30,
    emptyText: "No accounts in this window.",
    minWidth: ACCOUNTS_TABLE_MIN_WIDTH.ROSTER,
    onOpen: (id) => opened.push(id),
    sortable,
  };
  if (starred) props.favorite = favorite;
  root = createRoot(table);
  act(() => root?.render(createElement(AccountsTable<AccountsTableRow>, props)));
  return { table, opened, toggled };
}

function remount(rows: readonly AccountsTableRow[], options: { sortable: boolean }): Mounted {
  act(() => root?.unmount());
  document.body.replaceChildren();
  return mount(rows, options);
}

/** Whose each body row is, top to bottom, by the email it shows. */
function order(table: HTMLElement): string[] {
  return [...table.querySelectorAll("tbody tr")].map(
    (row) =>
      [ADA, GRACE, ZED]
        .find((account) => row.textContent?.includes(account.email))
        ?.email.split("@")[0] ?? "",
  );
}

function header(table: HTMLElement, label: string): HTMLElement {
  const found = [...table.querySelectorAll<HTMLElement>("th")].find((cell) =>
    cell.textContent?.startsWith(label),
  );
  if (found === undefined) throw new Error(`no ${label} header`);
  return found;
}

function press(element: Element | null | undefined, init: MouseEventInit = {}): MouseEvent {
  if (!element) throw new Error("nothing to press");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => element.dispatchEvent(event));
  return event;
}

test("a row names its account, marks an admin in words, and counts its days and calls", () => {
  const { table } = mount([ADA, GRACE]);
  const [ada, grace] = [...table.querySelectorAll("tbody tr")];

  expect(ada?.textContent).toContain("Ada Lovelace");
  expect(ada?.textContent).toContain("Admin");
  expect(ada?.textContent).toContain("ada@example.test");
  expect(ada?.textContent).toContain("12 of 30");
  expect(ada?.textContent).toContain("1,204");
  expect(grace?.textContent).not.toContain("Admin");
  expect(grace?.textContent?.match(/grace@example\.test/g)).toHaveLength(1);
  expect(grace?.textContent).toContain("—");
});

test("no rows shows the surface's empty line in place of the table", () => {
  const { table } = mount([]);

  expect(table.querySelector("table")).toBeNull();
  expect(table.textContent).toBe("No accounts in this window.");
});

test("an unsortable table keeps the server's order and offers no sort", () => {
  const { table } = mount([ADA, GRACE, ZED]);

  expect(order(table)).toEqual(["ada", "grace", "zed"]);
  expect(table.querySelector("th button")).toBeNull();
});

test("a header's press sorts by it, a second flips it, and the choice is remembered", () => {
  const { table } = mount([ADA, GRACE, ZED], { sortable: true });
  const calls = () => header(table, "Calls");

  press(calls().querySelector("button"));
  expect(calls().getAttribute("aria-sort")).toBe("descending");
  expect(order(table)).toEqual(["ada", "grace", "zed"]);

  press(calls().querySelector("button"));
  expect(calls().getAttribute("aria-sort")).toBe("ascending");
  expect(order(table)).toEqual(["zed", "grace", "ada"]);
  expect(header(table, "Account").hasAttribute("aria-sort")).toBe(false);

  const again = remount([ADA, GRACE, ZED], { sortable: true });
  expect(header(again.table, "Calls").getAttribute("aria-sort")).toBe("ascending");
  expect(order(again.table)).toEqual(["zed", "grace", "ada"]);
});

test("a plain press on a row or its name opens the account, a modified one is left to the browser", () => {
  const { table, opened } = mount([ADA, GRACE]);
  const [ada, grace] = [...table.querySelectorAll("tbody tr")];

  press(ada?.querySelectorAll("td")[2]);
  const plain = press(grace?.querySelector("a"));
  const modified = press(grace?.querySelector("a"), { metaKey: true });

  expect(opened).toEqual(["account-ada", "account-grace"]);
  expect(plain.defaultPrevented).toBe(true);
  expect(modified.defaultPrevented).toBe(false);
});

test("a star's press asks to star or unstar without opening the row, and starred rows lead", () => {
  const { table, opened, toggled } = mount([ADA, GRACE, ZED], { starred: true });

  expect(order(table)[0]).toBe("zed");
  const unstar = table.querySelector<HTMLElement>('[aria-label="Unfavorite Zed Example"]');
  const star = table.querySelector<HTMLElement>('[aria-label="Favorite grace@example.test"]');
  expect(unstar?.getAttribute("aria-pressed")).toBe("true");
  expect(star?.getAttribute("aria-pressed")).toBe("false");

  press(unstar);
  press(star);

  expect(toggled).toEqual([
    ["account-zed", false],
    ["account-grace", true],
  ]);
  expect(opened).toEqual([]);
});
