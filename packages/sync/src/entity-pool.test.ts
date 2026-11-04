import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import {
  anyWrite,
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

/** A read stood on the pool in a scope of its own, which the test closes to let it go, counting how often the pool draws it again; one that `adopts` shows every row a write makes. */
function standing(pool: EntityPool, adopts = false) {
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
        ...(adopts ? { adopts: () => true } : undefined),
      }),
    );
    return { rows, drawn, letGo: Scope.close(scope, Exit.void) };
  });
}

/** A write that makes `row` and stands until the service answers, which it never does. */
const MAKES: WriteDeclaration<Row, FieldChange<Row>, Row, void> = {
  kind: ROW,
  keys: (row) => [row.id],
  change: (row) => ({ made: row }),
  send: () => Effect.never,
};

/** What a read that adopts shows of `row`'s key while a write making it stands: the pool's own row where it still holds one, else the one made. */
function shownOver(pool: EntityPool, row: Row) {
  return Effect.gen(function* () {
    const probe = yield* standing(pool, true);
    const write = yield* Effect.forkChild(pool.write(MAKES, row));
    yield* settled;
    const shown = probe.rows.rows();
    yield* Fiber.interrupt(write);
    yield* probe.letGo;
    return shown;
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
    const made = { id: "1", name: "Made", runs: 0 };
    assert.deepEqual(yield* shownOver(pool, made), [{ id: "1", name: "Triage issues", runs: 1 }]);

    yield* inbox.letGo;
    assert.deepEqual(
      yield* shownOver(pool, made),
      [made],
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

it.effect("an answer read at an older sync id never replaces a row taken at a newer one", () =>
  Effect.gen(function* () {
    const pool = yield* entityPool();
    const feed = yield* standing(pool);
    const inbox = yield* standing(pool);

    yield* feed.rows.answer([{ id: "1", name: "Triage issues", runs: 2 }], { at: 20n });
    yield* inbox.rows.answer([{ id: "1", name: "Triage", runs: 1 }], { at: 10n });

    assert.deepEqual(inbox.rows.rows(), [{ id: "1", name: "Triage issues", runs: 2 }]);
  }).pipe(Effect.scoped),
);

it.effect(
  "a write that may wait stands while the service answers nothing, is kept, and lands once sent again under its key",
  () =>
    Effect.gen(function* () {
      const reachable = { now: false };
      const sentUnder: (string | undefined)[] = [];
      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: (_name, { key }) =>
          Effect.sync(() => {
            sentUnder.push(key);
            return reachable.now
              ? { answer: "renamed", txid: undefined }
              : { refused: "not renamed", unanswered: true as const };
          }),
        queue: { name: "rename", input: Schema.String, queued: () => "waits" },
      };
      const options = { mintKey: () => "key-1", replayRefused: Effect.void };
      const quit = yield* Scope.make();
      const before = yield* Scope.provide(quit)(entityPool(options));
      const list = yield* Scope.provide(quit)(standing(before));
      yield* list.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);

      const answered = yield* before.write(rename, "Triage issues");
      const kept = before.queued();
      yield* Scope.close(quit, Exit.void);
      const after = yield* entityPool(options);
      const relaunched = yield* standing(after);
      yield* relaunched.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
      yield* after.requeue(kept, [anyWrite(rename)]);
      const drawn = relaunched.rows.rows();
      reachable.now = true;
      yield* after.resend;
      yield* settled;

      assert.equal(answered, "waits");
      assert.deepEqual(kept, [{ name: "rename", key: "key-1", input: "Triage issues" }]);
      assert.deepEqual(drawn, [{ id: "1", name: "Triage issues", runs: 0 }]);
      assert.deepEqual(
        sentUnder,
        ["key-1", "key-1"],
        "sent once more, under the key it was kept with",
      );
      assert.deepEqual(after.queued(), []);
    }).pipe(Effect.scoped),
);

it.effect(
  "a write that may wait asked while others wait is drawn and answered at once, never held behind the network",
  () =>
    Effect.gen(function* () {
      const network = yield* Deferred.make<void>();
      const reachable = { now: false };
      const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
        kind: ROW,
        keys: () => ["1"],
        change: (name) => () => ({ name }),
        send: () =>
          reachable.now
            ? Effect.as(Deferred.await(network), { answer: "renamed", txid: undefined })
            : Effect.succeed({ refused: "not renamed", unanswered: true as const }),
        queue: { name: "rename", input: Schema.String, queued: () => "waits" },
      };
      const pool = yield* entityPool({ mintKey: () => "key", replayRefused: Effect.void });
      const list = yield* standing(pool);
      yield* list.rows.answer([{ id: "1", name: "Triage", runs: 0 }]);
      yield* pool.write(rename, "Triage issues");
      reachable.now = true;

      const answered = yield* pool.write(rename, "Triage bugs");

      assert.equal(answered, "waits");
      assert.deepEqual(list.rows.rows(), [{ id: "1", name: "Triage bugs", runs: 0 }]);
      assert.equal(pool.queued().length, 2, "both wait while the service holds the first");
      yield* Deferred.succeed(network, undefined);
    }).pipe(Effect.scoped),
);
