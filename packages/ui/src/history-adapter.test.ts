import assert from "node:assert/strict";
import { test } from "vitest";
import { type HistoryAdapter, memoryHistory } from "./history-adapter.js";

/**
 * The in-memory history behaves as a browser tab's: a visit clears what
 * stood ahead, a replace takes the standing entry's place, a move goes no
 * further than the entries held, and the oldest entries go first past its
 * limit. Synthetic links.
 */

const entry = (name: string) => ({ address: `https://tryluke.dev/acme/plan/${name}`, state: name });

/** The state of the entry the history stands on. */
const standing = (history: HistoryAdapter<string>) =>
  history.current().entries[history.current().at]?.state;

test("a visit after a step back clears the entries that stood ahead", () => {
  const history = memoryHistory<string>();
  history.push(entry("one"));
  history.push(entry("two"));
  history.go(-1);
  history.push(entry("three"));

  assert.deepEqual(
    history.current().entries.map((each) => each.state),
    ["one", "three"],
  );
  assert.equal(standing(history), "three");
});

test("a replace takes the standing entry's place and keeps the entries ahead", () => {
  const history = memoryHistory<string>();
  history.push(entry("one"));
  history.push(entry("two"));
  history.go(-1);
  history.replace(entry("uno"));

  assert.deepEqual(
    history.current().entries.map((each) => each.address),
    ["https://tryluke.dev/acme/plan/uno", "https://tryluke.dev/acme/plan/two"],
  );
  assert.equal(standing(history), "uno");
});

test("a replace with nothing standing stands on its entry", () => {
  const history = memoryHistory<string>();
  history.replace(entry("one"));
  assert.equal(standing(history), "one");
});

test("a move past either end goes nowhere", () => {
  const history = memoryHistory<string>();
  history.push(entry("one"));
  history.push(entry("two"));
  history.go(1);
  assert.equal(standing(history), "two");
  history.go(-2);
  assert.equal(standing(history), "two");
  history.go(-1);
  assert.equal(standing(history), "one");
});

test("past fifty entries the oldest go first", () => {
  const history = memoryHistory<string>();
  for (let visit = 1; visit <= 51; visit += 1) history.push(entry(`visit-${visit}`));

  assert.equal(history.current().entries.length, 50);
  history.go(-50);
  assert.equal(standing(history), "visit-51");
  history.go(-49);
  assert.equal(standing(history), "visit-2");
});

test("a listener hears each change until it stops, and the history reads the same between changes", () => {
  const history = memoryHistory<string>();
  const heard: (string | undefined)[] = [];
  const stop = history.subscribe(() => heard.push(standing(history)));
  history.push(entry("one"));
  const read = history.current();
  assert.equal(history.current(), read);
  history.push(entry("two"));
  history.go(-1);
  stop();
  history.go(1);

  assert.deepEqual(heard, ["one", "two", "one"]);
});
