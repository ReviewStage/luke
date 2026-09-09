import assert from "node:assert/strict";
import test from "node:test";

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const stored = new Map<string, string>();
let refuses = false;

const localStorage: KeyValueStore = {
  getItem: (key) => {
    if (refuses) throw new Error("storage refused");
    return stored.get(key) ?? null;
  },
  setItem: (key, value) => {
    if (refuses) throw new Error("storage refused");
    stored.set(key, value);
  },
  removeItem: (key) => {
    if (refuses) throw new Error("storage refused");
    stored.delete(key);
  },
};

// SAFETY: the preferences module reads nothing of the browser but
// `window.localStorage`, which this stands in for under Node's test runner.
(globalThis as unknown as { window: { localStorage: KeyValueStore } }).window = { localStorage };

const { ACCOUNTS_SORT, ADMINS_HIDDEN, SIGN_IN_CHOSEN, rememberedFlag } = await import(
  "../src/admin/prefs"
);
const { ACCOUNTS_SORT_KEY, SORT_DIRECTION } = await import("../src/admin/accounts-table/sort");

test.beforeEach(() => {
  stored.clear();
  refuses = false;
});

test("a flag absent from storage reads as its default, and is written as the exception to it", () => {
  assert.equal(SIGN_IN_CHOSEN.read(), false);
  SIGN_IN_CHOSEN.write(true);
  assert.equal(stored.size, 1);
  assert.equal(SIGN_IN_CHOSEN.read(), true);
  SIGN_IN_CHOSEN.write(false);
  assert.equal(stored.size, 0);
  assert.equal(SIGN_IN_CHOSEN.read(), false);
});

test("a flag whose default is on marks the exception, not the state", () => {
  // Admins are hidden until the maintainer asks for them, so the stored key is
  // the ask and an absent one is the default.
  assert.equal(ADMINS_HIDDEN.read(), true);
  ADMINS_HIDDEN.write(false);
  assert.equal(stored.size, 1);
  assert.equal(ADMINS_HIDDEN.read(), false);
  ADMINS_HIDDEN.write(true);
  assert.equal(stored.size, 0);
  assert.equal(ADMINS_HIDDEN.read(), true);
});

test("a browser that refuses storage reads every flag at its default and loses no press", () => {
  refuses = true;
  assert.equal(rememberedFlag("anything").read(), false);
  assert.equal(rememberedFlag("anything", true).read(), true);
  assert.doesNotThrow(() => rememberedFlag("anything").write(true));
});

test("a remembered sort rides one stored token and comes back whole", () => {
  const sort = { key: ACCOUNTS_SORT_KEY.LAST_ACTIVE, direction: SORT_DIRECTION.DESCENDING };
  ACCOUNTS_SORT.write(sort);
  assert.deepEqual(ACCOUNTS_SORT.read(), sort);
});

test("a stored sort the sets no longer name reads as no sort at all", () => {
  for (const token of [
    "",
    "nonsense",
    "lastActive:sideways",
    "sideways:descending",
    "lastActive",
  ]) {
    stored.set("luke-admin-users-sort", token);
    assert.equal(ACCOUNTS_SORT.read(), undefined, token);
  }
  stored.clear();
  assert.equal(ACCOUNTS_SORT.read(), undefined);
});
