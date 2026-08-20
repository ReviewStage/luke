import assert from "node:assert/strict";
import test from "node:test";
import {
  nextDepartures,
  parseMilliseconds,
  parsePixels,
  planReorder,
  rosterRows,
  travelApplies,
  withoutDeparture,
} from "./session-motion";

const tops = (entries: Record<string, number>) => new Map(Object.entries(entries));

const sessions = (...ids: string[]) => ids.map((id) => ({ id }));

test("a row found somewhere new travels back by exactly the distance it moved", () => {
  const plan = planReorder(tops({ a: 0, b: 75 }), tops({ a: 75, b: 0 }));
  // `a` moved down 75px, so it starts 75px up — where it was — and vice versa.
  assert.equal(plan.travels.get("a"), -75);
  assert.equal(plan.travels.get("b"), 75);
});

test("a slot hop leaves a hidden element to take its place", () => {
  assert.equal(travelApplies({ boundMoved: false, visible: false }), false);
});

test("a bound-moved travel carries an element still transparent mid-entrance", () => {
  // The wing's marks enter behind the shape's travel, so a panel opened
  // before their fade begins finds them at opacity zero — and they will be
  // visible before the spring settles. Skipped, they would fade in at their
  // new seat while the surface's edge is still on its way there.
  assert.equal(travelApplies({ boundMoved: true, visible: false }), true);
});

test("a visible element travels whichever gesture moved it", () => {
  assert.equal(travelApplies({ boundMoved: false, visible: true }), true);
  assert.equal(travelApplies({ boundMoved: true, visible: true }), true);
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
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // An unset token computes to the empty string, which must read as stillness.
  assert.equal(parseMilliseconds(""), 0);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the fan distance reads as pixels, and an unset token as none", () => {
  assert.equal(parsePixels("7px"), 7);
  assert.equal(parsePixels(""), 0);
});

test("a session missing from the new list becomes a departure holding its slot", () => {
  const drawn = rosterRows(sessions("a", "b", "c"), []);
  const departures = nextDepartures(drawn, sessions("a", "c"), []);
  assert.deepEqual(departures, [{ item: { id: "b" }, index: 1 }]);
});

test("a departure is drawn in the slot it held, marked leaving", () => {
  const rows = rosterRows(sessions("a", "c"), [{ item: { id: "b" }, index: 1 }]);
  assert.deepEqual(
    rows.map((row) => [row.item.id, row.leaving]),
    [
      ["a", false],
      ["b", true],
      ["c", false],
    ],
  );
});

test("a departure that held a slot past the end is drawn last", () => {
  const rows = rosterRows(sessions("a"), [{ item: { id: "z" }, index: 4 }]);
  assert.deepEqual(
    rows.map((row) => row.item.id),
    ["a", "z"],
  );
});

test("several departures keep their order among the living rows", () => {
  const rows = rosterRows(sessions("b", "d"), [
    { item: { id: "c" }, index: 2 },
    { item: { id: "a" }, index: 0 },
  ]);
  assert.deepEqual(
    rows.map((row) => row.item.id),
    ["a", "b", "c", "d"],
  );
});

test("a session returning mid-fade is alive again rather than a departure", () => {
  const departures = [{ item: { id: "b" }, index: 1 }];
  const drawn = rosterRows(sessions("a", "c"), departures);
  assert.deepEqual(nextDepartures(drawn, sessions("a", "b", "c"), departures), []);
});

test("a departure expiring steps the ones below it up a slot", () => {
  // From [a, b, c, d, e], b and d left: b holds slot 1 and d slot 3. When b is
  // let go, d must still sit between c and e rather than jump past the end.
  const departures = [
    { item: { id: "b" }, index: 1 },
    { item: { id: "d" }, index: 3 },
  ];
  const remaining = withoutDeparture(departures, "b");
  assert.deepEqual(remaining, [{ item: { id: "d" }, index: 2 }]);
  assert.deepEqual(
    rosterRows(sessions("a", "c", "e"), remaining).map((row) => row.item.id),
    ["a", "c", "d", "e"],
  );
});

test("a departure expiring leaves the ones above it in place", () => {
  const departures = [
    { item: { id: "b" }, index: 1 },
    { item: { id: "d" }, index: 3 },
  ];
  assert.deepEqual(withoutDeparture(departures, "d"), [{ item: { id: "b" }, index: 1 }]);
});

test("letting go of a session that is not departing changes nothing", () => {
  const departures = [{ item: { id: "b" }, index: 1 }];
  assert.deepEqual(withoutDeparture(departures, "x"), departures);
});

test("a departure still fading is kept while another begins", () => {
  const departures = [{ item: { id: "b" }, index: 1 }];
  const drawn = rosterRows(sessions("a", "c"), departures);
  const next = nextDepartures(drawn, sessions("a"), departures);
  assert.deepEqual(next, [
    { item: { id: "b" }, index: 1 },
    { item: { id: "c" }, index: 2 },
  ]);
});
