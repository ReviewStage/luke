import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { StateHandle } from "eve/context";
import { afterAll, test } from "vitest";
import { pinnedState } from "../eve/pinned-state";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The pinned state handle, held to the async context an authored file was
 * entered in. eve reads a session's container out of an `AsyncLocalStorage`
 * on every access, and a statement can hand the fiber that yielded it back
 * in another caller's context; the handle is what keeps the relay's state
 * and the prompt's hash the session's own whatever context the fiber is
 * resumed in. The container here is a plain map under a storage of the
 * test's own, standing in for eve's, since what is under test is where a
 * read and a write land and not what eve keeps in them.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

type Container = Map<string, string>;

const storage = new AsyncLocalStorage<Container>();

const SLOT = "luke.test";

/** A handle shaped as eve's: it reads the container standing where it is called, and throws outside one. */
const handle: StateHandle<string> = {
  get: () => {
    const container = storage.getStore();
    if (container === undefined) throw new Error("no container is standing");
    return container.get(SLOT) ?? "";
  },
  update: (next) => {
    const container = storage.getStore();
    if (container === undefined) throw new Error("no container is standing");
    container.set(SLOT, next(container.get(SLOT) ?? ""));
  },
};

test("a pinned handle reads and writes the container it was pinned in, from whatever context it is called in", async () => {
  const own: Container = new Map();
  const other: Container = new Map();
  const pinned = storage.run(own, () => pinnedState(handle));
  storage.run(other, () => {
    pinned.update(() => "written from another context");
  });
  assert.equal(own.get(SLOT), "written from another context");
  assert.equal(other.has(SLOT), false);
  // Read again from outside every container, where the bare handle would throw.
  assert.equal(pinned.get(), "written from another context");
  assert.throws(() => handle.get());
  await storage.run(other, async () => {
    await Promise.resolve();
    assert.equal(pinned.get(), "written from another context");
  });
});

/** The callers that contend over the one connection, each entered in a container of its own. */
const CALLERS = ["first", "second", "third", "fourth"] as const;

/**
 * One caller as a hook is one: entered in its container, it pins the handle
 * before anything awaits, yields a statement, and reads both what the bare
 * handle sees after it and what the pinned one does.
 */
function callerAfterStatement(tag: string) {
  const container: Container = new Map([[SLOT, tag]]);
  return storage.run(container, () => {
    const pinned = pinnedState(handle);
    return database.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`select pg_sleep(0.02)`;
        return yield* Effect.sync(() => ({
          tag,
          bare: storage.getStore()?.get(SLOT),
          pinned: pinned.get(),
        }));
      }),
    );
  });
}

test("a pinned handle is still its caller's after a contended statement handed the fiber back in another caller's context", async () => {
  const seen = await Promise.all(CALLERS.map(callerAfterStatement));
  // Guard: a run where nothing waited proves nothing, and every caller
  // finding its own container standing after the statement is that run.
  assert.notDeepEqual(
    seen.map((caller) => caller.bare),
    [...CALLERS],
  );
  assert.deepEqual(
    seen.map((caller) => caller.pinned),
    [...CALLERS],
  );
});
