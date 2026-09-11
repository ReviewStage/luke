import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ACCOUNTS_SORT_FIRST_DIRECTION,
  ACCOUNTS_SORT_KEY,
  type AccountsDetailColumn,
  type AccountsSortKey,
  type AccountsTableRow,
  nextSort,
  SORT_DIRECTION,
  sortAccountsRows,
} from "../src/admin/accounts-table/sort";

interface RosterRow extends AccountsTableRow {
  favorite: boolean;
  createdAt: number;
  lastSeenAt: number | null;
}

function row(id: string, fields: Partial<RosterRow> = {}): RosterRow {
  return {
    id,
    name: id,
    email: `${id}@example.test`,
    image: null,
    admin: false,
    activeDays: 0,
    lastActiveDay: null,
    calls: 0,
    favorite: false,
    createdAt: 0,
    lastSeenAt: null,
    ...fields,
  };
}

/** The server's own order — most recently active first — is the input order. */
const ROWS: readonly RosterRow[] = [
  row("delta", { activeDays: 9, lastActiveDay: "2026-08-21", calls: 40, createdAt: 4 }),
  row("alpha", {
    activeDays: 2,
    lastActiveDay: "2026-08-19",
    calls: 12,
    createdAt: 1,
    favorite: true,
  }),
  row("charlie", { activeDays: 7, lastActiveDay: "2026-08-14", calls: 12, createdAt: 3 }),
  row("bravo", { name: "", activeDays: 5, lastActiveDay: "2026-08-02", calls: 31, createdAt: 2 }),
  row("echo", { activeDays: 0, calls: 0, createdAt: 5, favorite: true }),
  row("foxtrot", { activeDays: 1, calls: 3, createdAt: 6 }),
];

const DETAIL_COLUMNS: readonly AccountsDetailColumn<RosterRow>[] = [
  {
    key: ACCOUNTS_SORT_KEY.JOINED,
    label: "Joined",
    cell: (candidate) => candidate.createdAt,
    sortValue: (candidate) => candidate.createdAt,
  },
  {
    key: ACCOUNTS_SORT_KEY.LAST_SEEN,
    label: "Last seen",
    cell: (candidate) => candidate.lastSeenAt,
    sortValue: (candidate) => candidate.lastSeenAt,
  },
];

const starred = (candidate: RosterRow) => candidate.favorite;
const ids = (rows: readonly RosterRow[]) => rows.map((candidate) => candidate.id);
const EVERY_KEY = Object.values(ACCOUNTS_SORT_KEY);

test("no sort at all is the server's own order, row for row", () => {
  assert.equal(sortAccountsRows(ROWS, undefined, [], undefined), ROWS);
});

test("starred rows stand above everything with no sort chosen", () => {
  assert.deepEqual(ids(sortAccountsRows(ROWS, undefined, DETAIL_COLUMNS, starred)), [
    "alpha",
    "echo",
    "delta",
    "charlie",
    "bravo",
    "foxtrot",
  ]);
});

test("starred rows stand above everything under every sort, in both directions", () => {
  for (const key of EVERY_KEY) {
    for (const direction of Object.values(SORT_DIRECTION)) {
      const sorted = sortAccountsRows(ROWS, { key, direction }, DETAIL_COLUMNS, starred);
      assert.deepEqual(ids(sorted).slice(0, 2).sort(), ["alpha", "echo"], `${key} ${direction}`);
    }
  }
});

test("the sort chosen orders each tier on its own", () => {
  const sorted = sortAccountsRows(
    ROWS,
    { key: ACCOUNTS_SORT_KEY.CALLS, direction: SORT_DIRECTION.ASCENDING },
    DETAIL_COLUMNS,
    starred,
  );
  assert.deepEqual(ids(sorted), ["echo", "alpha", "foxtrot", "charlie", "bravo", "delta"]);
});

test("an account sorts by the label its row shows, case-insensitively", () => {
  // `bravo` draws its email, having no name, and sorts where that label puts it.
  const sorted = sortAccountsRows(
    ROWS,
    { key: ACCOUNTS_SORT_KEY.ACCOUNT, direction: SORT_DIRECTION.ASCENDING },
    DETAIL_COLUMNS,
    undefined,
  );
  assert.deepEqual(ids(sorted), ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]);
});

test("ties keep the server's order", () => {
  const sorted = sortAccountsRows(
    ROWS,
    { key: ACCOUNTS_SORT_KEY.CALLS, direction: SORT_DIRECTION.DESCENDING },
    DETAIL_COLUMNS,
    undefined,
  );
  assert.deepEqual(ids(sorted), ["delta", "bravo", "alpha", "charlie", "foxtrot", "echo"]);
});

test("a row with no active day sits below the dated rows of its tier, either way", () => {
  for (const direction of Object.values(SORT_DIRECTION)) {
    const sorted = sortAccountsRows(
      ROWS,
      { key: ACCOUNTS_SORT_KEY.LAST_ACTIVE, direction },
      DETAIL_COLUMNS,
      undefined,
    );
    assert.deepEqual(ids(sorted).slice(-2), ["echo", "foxtrot"], direction);
  }
});

test("a detail column's ordering rides the column", () => {
  const sorted = sortAccountsRows(
    ROWS,
    { key: ACCOUNTS_SORT_KEY.JOINED, direction: SORT_DIRECTION.ASCENDING },
    DETAIL_COLUMNS,
    undefined,
  );
  assert.deepEqual(ids(sorted), ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]);
});

test("a stored key naming a column this table does not draw reads as no sort at all", () => {
  const sorted = sortAccountsRows(
    ROWS,
    { key: ACCOUNTS_SORT_KEY.JOINED, direction: SORT_DIRECTION.ASCENDING },
    [],
    starred,
  );
  assert.deepEqual(ids(sorted), ["alpha", "echo", "delta", "charlie", "bravo", "foxtrot"]);
});

test("a press gives a column its first direction, a second press the flip", () => {
  for (const key of EVERY_KEY) {
    const first = nextSort(undefined, key);
    assert.deepEqual(first, { key, direction: ACCOUNTS_SORT_FIRST_DIRECTION[key] });
    const flipped = nextSort(first, key);
    assert.notEqual(flipped.direction, first.direction);
    assert.equal(nextSort(flipped, key).direction, first.direction);
  }
});

test("a press on another column starts that column's own first direction", () => {
  const sorted = nextSort(undefined, ACCOUNTS_SORT_KEY.CALLS);
  const key: AccountsSortKey = ACCOUNTS_SORT_KEY.ACCOUNT;
  assert.deepEqual(nextSort(sorted, key), {
    key,
    direction: ACCOUNTS_SORT_FIRST_DIRECTION[key],
  });
});
