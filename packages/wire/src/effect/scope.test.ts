import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Cause, Chunk, Context, Effect, Exit, Layer, Scope } from "effect";
import type { IDisposable } from "../lifecycle.js";
import { addDisposable, disposableFromScope, layerFromDisposable } from "./scope.js";

const recorder = (order: string[], name: string): IDisposable => ({
  dispose: () => {
    order.push(name);
  },
});

const thrower = (order: string[], name: string, failure: unknown): IDisposable => ({
  dispose: () => {
    order.push(name);
    throw failure;
  },
});

describe("addDisposable", () => {
  it.effect("ends its disposables in the reverse of the order they were added", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const scope = yield* Scope.make();

      yield* addDisposable(scope, recorder(order, "first"));
      yield* addDisposable(scope, recorder(order, "second"));
      yield* addDisposable(scope, recorder(order, "third"));
      assert.deepEqual(order, []);

      yield* Scope.close(scope, Exit.void);

      assert.deepEqual(order, ["third", "second", "first"]);
    }),
  );

  it.effect("answers the disposable it was handed", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const disposable = recorder([], "held");

      assert.equal(yield* addDisposable(scope, disposable), disposable);
    }),
  );

  it.effect("disposes at once when the scope is already closed", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const scope = yield* Scope.make();
      yield* Scope.close(scope, Exit.void);

      yield* addDisposable(scope, recorder(order, "late"));

      assert.deepEqual(order, ["late"]);
    }),
  );

  it.effect("lets a thrower stop none of the rest and aggregates the failures", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const first = new Error("first failed");
      const second = new Error("second failed");
      const scope = yield* Scope.make();

      yield* addDisposable(scope, thrower(order, "first", first));
      yield* addDisposable(scope, recorder(order, "second"));
      yield* addDisposable(scope, thrower(order, "third", second));

      const closed = yield* Effect.exit(Scope.close(scope, Exit.void));

      assert.deepEqual(order, ["third", "second", "first"]);
      assert.equal(Exit.isFailure(closed), true);
      const defects = Exit.isFailure(closed)
        ? Chunk.toReadonlyArray(Cause.defects(closed.cause))
        : [];
      assert.deepEqual(defects, [second, first]);
    }),
  );
});

describe("disposableFromScope", () => {
  it.effect("closes the scope when disposed", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const scope = yield* Scope.make();
      yield* addDisposable(scope, recorder(order, "first"));
      yield* addDisposable(scope, recorder(order, "second"));

      const disposable = disposableFromScope(scope);
      assert.deepEqual(order, []);
      disposable.dispose();

      assert.deepEqual(order, ["second", "first"]);
    }),
  );

  it.effect("ends its scope at most once however often it is disposed", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const scope = yield* Scope.make();
      yield* addDisposable(scope, recorder(order, "held"));

      const disposable = disposableFromScope(scope);
      disposable.dispose();
      disposable.dispose();
      disposable.dispose();

      assert.deepEqual(order, ["held"]);
    }),
  );

  it.effect("throws every failure of the round as one AggregateError", () =>
    Effect.gen(function* () {
      const first = new Error("first failed");
      const second = new Error("second failed");
      const scope = yield* Scope.make();
      yield* addDisposable(scope, thrower([], "first", first));
      yield* addDisposable(scope, thrower([], "second", second));

      const disposable = disposableFromScope(scope);
      let thrown: unknown;
      try {
        disposable.dispose();
      } catch (failure) {
        thrown = failure;
      }

      assert.equal(thrown instanceof AggregateError, true);
      assert.deepEqual(thrown instanceof AggregateError ? thrown.errors : [], [second, first]);
    }),
  );
});

class Held extends Context.Tag("test/Held")<Held, IDisposable & { readonly name: string }>() {}

describe("layerFromDisposable", () => {
  it.effect("disposes the service when the layer's scope closes", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const layer = layerFromDisposable(
        Held,
        Effect.sync(() => ({ name: "held", ...recorder(order, "held") })),
      );

      const names = yield* Effect.scoped(
        Effect.map(Layer.build(layer), (context) => Context.get(context, Held).name),
      );

      assert.equal(names, "held");
      assert.deepEqual(order, ["held"]);
    }),
  );

  it.effect("builds the service inside the scope and not before", () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const layer = layerFromDisposable(
        Held,
        Effect.sync(() => {
          order.push("made");
          return { name: "held", ...recorder(order, "held") };
        }),
      );

      assert.deepEqual(order, []);
      yield* Effect.scoped(Effect.asVoid(Layer.build(layer)));

      assert.deepEqual(order, ["made", "held"]);
    }),
  );
});
