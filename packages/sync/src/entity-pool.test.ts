import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import {
  type EntityPool,
  entityPool,
  type FieldChange,
  fieldKind,
  type HeldRows,
  type WriteDeclaration,
} from "./entity-pool.js";

/**
 * The pool: a row lives once however many reads hold it, and leaves once
 * the last lets it go; and a write stands over the rows without holding back
 * what the reads answer meanwhile. Synthetic rows.
 */

interface Row {
  readonly id: string;
  readonly name: string;
  readonly runs: number;
}

const ROW = fieldKind((row: Row) => row.id);

const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** A read stood on the pool in a scope of its own, which the test closes to let it go, counting how often the pool draws it again. */
function standing(pool: EntityPool) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();
    const drawn = { times: 0 };
    const rows: HeldRows<Row> = yield* Scope.provide(scope)(
      pool.stand(ROW, {
        redraw: () =>
          Effect.sync(() => {
            drawn.times += 1;
          }),
        confirmation: () => undefined,
      }),
    );
    return { rows, drawn, letGo: Scope.close(scope, Exit.void) };
  });
}

it.effect("two reads hold one row, which leaves the pool only once the last lets it go", () =>
  Effect.gen(function* () {
    const pool = yield* entityPool();
    const feed = yield* standing(pool);
    const inbox = yield* standing(pool);
    yield* feed.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
    yield* inbox.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);

    yield* feed.rows.answer([{ id: "1", name: "Triage issues", runs: 1 }]);

    assert.deepEqual(inbox.rows.rows(), [{ id: "1", name: "Triage issues", runs: 1 }]);
    assert.equal(inbox.drawn.times, 1, "the other read is drawn again");

    yield* feed.letGo;
    const later = yield* standing(pool);
    yield* later.rows.confirmNew({ id: "1", name: "Made", runs: 0 });
    assert.deepEqual(later.rows.rows(), [{ id: "1", name: "Triage issues", runs: 1 }]);

    yield* inbox.letGo;
    yield* later.letGo;
    const next = yield* standing(pool);
    yield* next.rows.confirmNew({ id: "1", name: "Made", runs: 0 });
    assert.deepEqual(
      next.rows.rows(),
      [{ id: "1", name: "Made", runs: 0 }],
      "nothing of a row every read let go is left",
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "an answer lands while a write stands, and the write is drawn over the newer row it brings",
  () =>
    Effect.gen(function* () {
      const pool = yield* entityPool();
      const list = yield* standing(pool);
      yield* list.rows.answer([
        { id: "1", name: "Triage", runs: 0 },
        { id: "2", name: "Deploy", runs: 0 },
      ]);
      const answered = yield* Deferred.make<void>();
      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: () => Effect.as(Deferred.await(answered), { answer: "renamed", txid: undefined }),
      };

      const write = yield* Effect.forkChild(pool.write(rename, "Triage issues"));
      yield* settled;
      assert.deepEqual(list.rows.rows()[0], { id: "1", name: "Triage issues", runs: 0 });

      yield* list.rows.answer([
        { id: "1", name: "Triage", runs: 3 },
        { id: "2", name: "Deploy to production", runs: 0 },
      ]);

      assert.deepEqual(list.rows.rows(), [
        { id: "1", name: "Triage issues", runs: 3 },
        { id: "2", name: "Deploy to production", runs: 0 },
      ]);
      yield* Deferred.succeed(answered, undefined);
      assert.equal(yield* Fiber.join(write), "renamed");
    }).pipe(Effect.scoped),
);
