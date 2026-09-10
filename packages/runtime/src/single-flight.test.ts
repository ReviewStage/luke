import assert from "node:assert/strict";
import test from "node:test";
import { SingleFlight } from "./single-flight.js";

function deferred<Value>() {
  let settle: (value: Value) => void = () => {};
  let fail: (reason: Error) => void = () => {};
  const promise = new Promise<Value>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

test("concurrent asks under one key share the run, and the work happens once", async () => {
  const flights = new SingleFlight<string, number>();
  const held = deferred<number>();
  let runs = 0;
  const start = () => {
    runs += 1;
    return held.promise;
  };

  const first = flights.run("a", start);
  const second = flights.run("a", start);
  assert.equal(runs, 1);

  held.settle(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(runs, 1);
});

test("different keys are different flights", async () => {
  const flights = new SingleFlight<string, string>();
  const answers = await Promise.all([
    flights.run("a", async () => "first"),
    flights.run("b", async () => "second"),
  ]);
  assert.deepEqual(answers, ["first", "second"]);
});

test("a settled flight is forgotten, so the next ask runs the work again", async () => {
  const flights = new SingleFlight<string, number>();
  let runs = 0;
  const start = async () => {
    runs += 1;
    return runs;
  };

  assert.equal(await flights.run("a", start), 1);
  assert.equal(await flights.run("a", start), 2);
  assert.equal(runs, 2);
});

test("a rejected flight is forgotten too, so a failure is not the answer every later ask gets", async () => {
  const flights = new SingleFlight<string, number>();
  let runs = 0;
  const start = async () => {
    runs += 1;
    if (runs === 1) throw new Error("the first run failed");
    return runs;
  };

  await assert.rejects(flights.run("a", start), { message: "the first run failed" });
  assert.equal(await flights.run("a", start), 2);
});

test("every caller of a rejected flight hears the same failure", async () => {
  const flights = new SingleFlight<string, number>();
  const held = deferred<number>();
  const first = flights.run("a", () => held.promise);
  const second = flights.run("a", () => held.promise);

  held.fail(new Error("the run failed"));
  await assert.rejects(first, { message: "the run failed" });
  await assert.rejects(second, { message: "the run failed" });
});
