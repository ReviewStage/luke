import assert from "node:assert/strict";
import test from "node:test";
import { BoundedMap } from "./bounded-map.js";

test("entries stand until the capacity is reached", () => {
  const held = new BoundedMap<string, number>(3);
  held.set("a", 1).set("b", 2).set("c", 3);
  assert.equal(held.size, 3);
  assert.deepEqual([...held.keys()], ["a", "b", "c"]);
  assert.equal(held.get("a"), 1);
});

test("the oldest entry is the one evicted", () => {
  const held = new BoundedMap<string, number>(2);
  held.set("a", 1).set("b", 2).set("c", 3);
  assert.equal(held.size, 2);
  assert.deepEqual([...held.keys()], ["b", "c"]);
  assert.equal(held.get("a"), undefined);
});

test("reading does not refresh an entry, so who looked cannot change what is evicted", () => {
  const held = new BoundedMap<string, number>(2);
  held.set("a", 1).set("b", 2);
  assert.equal(held.get("a"), 1);
  held.set("c", 3);
  assert.deepEqual([...held.keys()], ["b", "c"]);
});

test("a key written again becomes the newest", () => {
  const held = new BoundedMap<string, number>(2);
  held.set("a", 1).set("b", 2).set("a", 3);
  assert.equal(held.size, 2);
  assert.deepEqual([...held.keys()], ["b", "a"]);
  held.set("c", 4);
  assert.deepEqual([...held.keys()], ["a", "c"]);
  assert.equal(held.get("a"), 3);
});

test("deleting and clearing leave room again", () => {
  const held = new BoundedMap<string, number>(2);
  held.set("a", 1).set("b", 2);
  assert.ok(held.delete("a"));
  assert.ok(!held.delete("a"));
  assert.equal(held.size, 1);
  held.clear();
  assert.equal(held.size, 0);
  assert.deepEqual([...held.keys()], []);
});

test("a capacity of one keeps only the newest", () => {
  const held = new BoundedMap<string, number>(1);
  held.set("a", 1).set("b", 2);
  assert.deepEqual([...held.keys()], ["b"]);
});

test("a capacity that is not a positive integer is refused", () => {
  assert.throws(() => new BoundedMap<string, number>(0), {
    name: "RangeError",
    message: "a bounded map's capacity must be a positive integer",
  });
  assert.throws(() => new BoundedMap<string, number>(1.5), { name: "RangeError" });
});
