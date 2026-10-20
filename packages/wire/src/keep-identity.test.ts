import assert from "node:assert/strict";
import { test } from "vitest";
import { keepIdentity } from "./index.js";

/** A value as a delivery hands it: the same data, every object of it new. */
function delivered<Value>(value: Value): Value {
  return structuredClone(value);
}

const TURN = {
  id: "turn-1",
  parts: [{ type: "text", text: "first" }],
  meta: { model: "m", tokens: [1, 2] },
};

test("a value delivered again unchanged is the one held, however deep", () => {
  const held = { tasks: [TURN, { ...TURN, id: "turn-2" }], settings: { theme: "dark" } };

  assert.equal(keepIdentity(held, delivered(held)), held);
});

test("a record that moved keeps every part of it that did not, and takes what moved from the delivery", () => {
  const held = { tasks: { list: [TURN] }, settings: { theme: "dark", keys: ["a"] } };
  const next = { ...delivered(held), settings: { theme: "light", keys: ["a"] } };

  const kept = keepIdentity(held, next);

  assert.deepEqual(kept, next);
  assert.notEqual(kept, held);
  assert.equal(kept.tasks, held.tasks, "the untouched slice is the one held");
  assert.notEqual(kept.settings, held.settings);
  assert.equal(kept.settings.keys, held.settings.keys, "inside the slice that moved too");
});

test("a delivery sharing nothing with what is held is answered as itself", () => {
  const next = { theme: "light", keys: ["b"] };

  assert.equal(keepIdentity({ theme: "dark", keys: ["a"] }, next), next);
});

test("a key that came or went moves its record, and the rest of it is still the one held", () => {
  const held = { list: [TURN], status: "ready" };
  const added = { ...delivered(held), activeTaskId: "task-1" };
  const removed = { list: delivered(held.list) };

  const withKey = keepIdentity<{ list: (typeof TURN)[]; status?: string; activeTaskId?: string }>(
    held,
    added,
  );
  const withoutKey = keepIdentity<{ list: (typeof TURN)[]; status?: string }>(held, removed);

  assert.deepEqual(withKey, added);
  assert.equal(withKey.list, held.list);
  assert.deepEqual(withoutKey, removed);
  assert.equal(withoutKey.list, held.list);
});

test("an item appended, prepended, removed, or changed in place leaves every other item the one held", () => {
  const first = { ...TURN, id: "turn-1" };
  const second = { ...TURN, id: "turn-2" };
  const third = { ...TURN, id: "turn-3" };
  const held = [first, second, third];
  const fourth = { ...TURN, id: "turn-4" };
  const zeroth = { ...TURN, id: "turn-0" };

  const appended = keepIdentity(held, [...delivered(held), fourth]);
  const prepended = keepIdentity(held, [zeroth, ...delivered(held)]);
  const removed = keepIdentity(held, delivered([first, third]));
  const changed = keepIdentity(
    held,
    delivered([first, { ...second, parts: [{ type: "text", text: "second" }] }, third]),
  );

  assert.deepEqual(
    appended.map((item) => held.indexOf(item)),
    [0, 1, 2, -1],
  );
  assert.equal(appended[3], fourth);
  assert.deepEqual(
    prepended.map((item) => held.indexOf(item)),
    [-1, 0, 1, 2],
  );
  assert.deepEqual(
    removed.map((item) => held.indexOf(item)),
    [0, 2],
  );
  assert.deepEqual(
    changed.map((item) => held.indexOf(item)),
    [0, -1, 2],
  );
  assert.deepEqual(changed[1]?.parts, [{ type: "text", text: "second" }]);
  assert.equal(changed[1]?.meta, second.meta, "the item that changed keeps what of it did not");
});

test("a list delivered again unchanged is the one held, and a list of words is compared by its words", () => {
  const held = { keys: ["a", "b"], empty: [] };

  assert.equal(keepIdentity(held, delivered(held)), held);
  assert.deepEqual(keepIdentity(held, { keys: ["a", "c"], empty: [] }).keys, ["a", "c"]);
});
