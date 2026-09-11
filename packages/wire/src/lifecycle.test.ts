import assert from "node:assert/strict";
import { test } from "vitest";
import { DisposableStore, disposeAll, toDisposable } from "./lifecycle.js";

test("a wrapped teardown runs at most once however often it is disposed", () => {
  let runs = 0;
  const disposable = toDisposable(() => {
    runs += 1;
  });

  disposable.dispose();
  disposable.dispose();
  disposable.dispose();

  assert.equal(runs, 1);
});

test("disposeAll disposes in iteration order", () => {
  const order: string[] = [];
  disposeAll([
    toDisposable(() => order.push("first")),
    toDisposable(() => order.push("second")),
    toDisposable(() => order.push("third")),
  ]);

  assert.deepEqual(order, ["first", "second", "third"]);
});

test("disposeAll continues past a thrower and reports every failure together", () => {
  const order: string[] = [];
  const firstFailure = new Error("first owner");
  const secondFailure = new Error("second owner");

  assert.throws(
    () =>
      disposeAll([
        toDisposable(() => {
          order.push("first");
          throw firstFailure;
        }),
        toDisposable(() => order.push("second")),
        toDisposable(() => {
          order.push("third");
          throw secondFailure;
        }),
        toDisposable(() => order.push("fourth")),
      ]),
    {
      name: "AggregateError",
      message: "2 of 4 disposals failed",
      errors: [firstFailure, secondFailure],
    },
  );

  assert.deepEqual(order, ["first", "second", "third", "fourth"]);
});

test("a single failure is still reported as an aggregate, so a caller catches one shape", () => {
  const failure = new Error("the only owner");

  assert.throws(
    () =>
      disposeAll([
        toDisposable(() => {
          throw failure;
        }),
      ]),
    { name: "AggregateError", message: "1 of 1 disposals failed", errors: [failure] },
  );
});

test("a store disposes what it holds in the reverse of the order it was added", () => {
  const order: string[] = [];
  const store = new DisposableStore();
  store.add(toDisposable(() => order.push("first")));
  store.add(toDisposable(() => order.push("second")));
  store.add(toDisposable(() => order.push("third")));

  store.dispose();

  assert.deepEqual(order, ["third", "second", "first"]);
});

test("a store answers the entry it was handed", () => {
  const store = new DisposableStore();
  const disposable = toDisposable(() => {});

  assert.equal(store.add(disposable), disposable);
});

test("disposing a store twice ends what it held exactly once", () => {
  let runs = 0;
  const store = new DisposableStore();
  store.add(
    toDisposable(() => {
      runs += 1;
    }),
  );

  store.dispose();
  store.dispose();

  assert.equal(runs, 1);
});

test("a store disposes an entry added after its own life ended", () => {
  const store = new DisposableStore();
  store.dispose();

  let disposed = false;
  store.add(
    toDisposable(() => {
      disposed = true;
    }),
  );

  assert.equal(disposed, true);
});

test("a store's disposal continues past a thrower and reports the failures", () => {
  const order: string[] = [];
  const failure = new Error("the middle owner");
  const store = new DisposableStore();
  store.add(toDisposable(() => order.push("first")));
  store.add(
    toDisposable(() => {
      order.push("second");
      throw failure;
    }),
  );
  store.add(toDisposable(() => order.push("third")));

  assert.throws(() => store.dispose(), {
    name: "AggregateError",
    message: "1 of 3 disposals failed",
    errors: [failure],
  });

  assert.deepEqual(order, ["third", "second", "first"]);
});

test("a store that threw while disposing is still disposed", () => {
  const store = new DisposableStore();
  store.add(
    toDisposable(() => {
      throw new Error("the only owner");
    }),
  );
  assert.throws(() => store.dispose());

  let disposedOnAdd = false;
  store.add(
    toDisposable(() => {
      disposedOnAdd = true;
    }),
  );

  assert.equal(disposedOnAdd, true);
});
