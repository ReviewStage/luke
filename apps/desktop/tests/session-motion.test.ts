import assert from "node:assert/strict";
import test from "node:test";
import {
  nextDepartures,
  parseMilliseconds,
  parsePixels,
  planReorder,
  rosterRows,
} from "../src/renderer/session-motion";

const tops = (entries: Record<string, number>) => new Map(Object.entries(entries));

const sessions = (...ids: string[]) => ids.map((id) => ({ id }));

test("a row found somewhere new travels back by exactly the distance it moved", () => {
  const plan = planReorder(tops({ a: 0, b: 75 }), tops({ a: 75, b: 0 }));
  // `a` moved down 75px, so it starts 75px up — where it was — and vice versa.
  assert.equal(plan.travels.get("a"), -75);
  assert.equal(plan.travels.get("b"), 75);
});

test("a row that kept its place is left alone", () => {
  const plan = planReorder(tops({ a: 0, b: 75 }), tops({ a: 0, b: 75.2 }));
  assert.equal(plan.travels.size, 0);
  assert.equal(plan.arrivals.length, 0);
});

test("with no baseline nothing moves and nothing arrives", () => {
  const plan = planReorder(undefined, tops({ a: 0, b: 75 }));
  assert.equal(plan.travels.size, 0);
  assert.equal(plan.arrivals.length, 0);
});

test("a session appearing in a watched empty list is an arrival", () => {
  const plan = planReorder(tops({}), tops({ a: 0 }));
  assert.deepEqual(plan.arrivals, ["a"]);
});

test("an arrival shifts its neighbours rather than replaying them", () => {
  const plan = planReorder(tops({ a: 0, b: 75 }), tops({ c: 0, a: 75, b: 150 }));
  assert.deepEqual(plan.arrivals, ["c"]);
  assert.equal(plan.travels.get("a"), -75);
  assert.equal(plan.travels.get("b"), -75);
});

test("a departed row is not planned for", () => {
  const plan = planReorder(tops({ a: 0, b: 75 }), tops({ a: 0 }));
  assert.equal(plan.travels.size, 0);
  assert.equal(plan.arrivals.length, 0);
});

test("durations are read in either unit the tokens use", () => {
  assert.equal(parseMilliseconds("460ms"), 460);
  assert.equal(parseMilliseconds("0.46s"), 460);
  assert.equal(parseMilliseconds(" 0s "), 0);
  // An unset token computes to the empty string, which must read as stillness.
  assert.equal(parseMilliseconds(""), 0);
});

test("the fan distance reads as pixels, and an unset token as none", () => {
  assert.equal(parsePixels("7px"), 7);
  assert.equal(parsePixels(""), 0);
});

test("a session missing from the new list becomes a departure holding its slot", () => {
  const drawn = rosterRows(sessions("a", "b", "c"), []);
  const departures = nextDepartures(drawn, sessions("a", "c"), []);
  assert.deepEqual(departures, [{ session: { id: "b" }, index: 1 }]);
});

test("a departure is drawn in the slot it held, marked leaving", () => {
  const rows = rosterRows(sessions("a", "c"), [{ session: { id: "b" }, index: 1 }]);
  assert.deepEqual(
    rows.map((row) => [row.session.id, row.leaving]),
    [
      ["a", false],
      ["b", true],
      ["c", false],
    ],
  );
});

test("a departure that held a slot past the end is drawn last", () => {
  const rows = rosterRows(sessions("a"), [{ session: { id: "z" }, index: 4 }]);
  assert.deepEqual(
    rows.map((row) => row.session.id),
    ["a", "z"],
  );
});

test("several departures keep their order among the living rows", () => {
  const rows = rosterRows(sessions("b", "d"), [
    { session: { id: "c" }, index: 2 },
    { session: { id: "a" }, index: 0 },
  ]);
  assert.deepEqual(
    rows.map((row) => row.session.id),
    ["a", "b", "c", "d"],
  );
});

test("a session returning mid-fade is alive again rather than a departure", () => {
  const departures = [{ session: { id: "b" }, index: 1 }];
  const drawn = rosterRows(sessions("a", "c"), departures);
  assert.deepEqual(nextDepartures(drawn, sessions("a", "b", "c"), departures), []);
});

test("a departure still fading is kept while another begins", () => {
  const departures = [{ session: { id: "b" }, index: 1 }];
  const drawn = rosterRows(sessions("a", "c"), departures);
  const next = nextDepartures(drawn, sessions("a"), departures);
  assert.deepEqual(next, [
    { session: { id: "b" }, index: 1 },
    { session: { id: "c" }, index: 2 },
  ]);
});
