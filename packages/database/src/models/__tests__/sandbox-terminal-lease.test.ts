import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  holdSandbox,
  lapsedSandboxLeases,
  releaseSandboxLease,
  sandboxHeld,
} from "../sandbox-terminal-lease.js";

/**
 * The lease a developer's typing holds on a coding agent's sandbox, over a
 * real dialect: it moves on and never back, holds until its instant, lapses
 * for the sweep with the session the sandbox is tagged with and whether a
 * turn still runs, and a lease taken up again after the sweep read it is not
 * removed. Every conversation is minted per test and every read is of its
 * ids, since the lease is the deployment's and not an account's.
 *
 * Synthetic accounts, conversations, and sessions throughout.
 */

const AT = Date.UTC(2026, 9, 14, 12);
const at = (minutes: number) => new Date(AT + minutes * 60_000);

/** A coding agent's conversation that ran in a session of its own, with a turn in the status given where one is. */
const openAgent = (turn?: TurnStatus) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const sessionId = `wrun_${randomUUID()}`;
    const [row] = yield* db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT, runtimeSessionId: sessionId })
      .returning({ id: conversations.id });
    assert.ok(row);
    if (turn !== undefined) {
      yield* db
        .insert(turns)
        .values({ userId, conversationId: row.id, origin: TURN_ORIGIN.TYPED, status: turn });
    }
    return { conversationId: row.id, sessionId };
  });

/** The lapsed leases the sweep would take before the instant given, narrowed to the conversations named. */
const lapsedAmong = (lapsedBefore: Date, conversationIds: readonly string[]) =>
  Effect.map(lapsedSandboxLeases(lapsedBefore, 1_000), (leases) =>
    leases.filter((lease) => conversationIds.includes(lease.conversationId)),
  );

it.layer(getTestDB())("the sandbox terminal lease", (it) => {
  it.effect("a lease holds until its instant, and a slower writer never moves it back", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openAgent();
      const unheld = yield* sandboxHeld(conversationId, at(0));
      yield* holdSandbox(conversationId, at(5));
      yield* holdSandbox(conversationId, at(3));

      assert.equal(unheld, false, "no lease, no hold");
      assert.equal(yield* sandboxHeld(conversationId, at(4)), true);
      assert.equal(
        yield* sandboxHeld(conversationId, at(5)),
        false,
        "the lease ends at its instant",
      );
      yield* holdSandbox(conversationId, at(9));
      assert.equal(yield* sandboxHeld(conversationId, at(8)), true, "typing moves it on");
    }),
  );

  it.effect(
    "a lapsed lease is read with the session its sandbox is tagged with and whether a turn still runs, and a held one is not read",
    () =>
      Effect.gen(function* () {
        const idle = yield* openAgent(TURN_STATUS.SETTLED);
        const working = yield* openAgent(TURN_STATUS.RUNNING);
        const held = yield* openAgent();
        yield* holdSandbox(idle.conversationId, at(1));
        yield* holdSandbox(working.conversationId, at(2));
        yield* holdSandbox(held.conversationId, at(10));

        const lapsed = yield* lapsedAmong(at(5), [
          idle.conversationId,
          working.conversationId,
          held.conversationId,
        ]);

        assert.deepEqual(lapsed, [
          { conversationId: idle.conversationId, sessionId: idle.sessionId, turnRunning: false },
          {
            conversationId: working.conversationId,
            sessionId: working.sessionId,
            turnRunning: true,
          },
        ]);
      }),
  );

  it.effect(
    "the sweep's release removes a lapsed lease, and leaves one the developer took up again after it was read",
    () =>
      Effect.gen(function* () {
        const released = yield* openAgent();
        const retaken = yield* openAgent();
        yield* holdSandbox(released.conversationId, at(1));
        yield* holdSandbox(retaken.conversationId, at(1));
        // Typing again after the sweep read the lease as lapsed before at(3).
        yield* holdSandbox(retaken.conversationId, at(8));

        yield* releaseSandboxLease(released.conversationId, at(3));
        yield* releaseSandboxLease(retaken.conversationId, at(3));

        assert.deepEqual(
          yield* lapsedAmong(at(20), [released.conversationId, retaken.conversationId]),
          [
            {
              conversationId: retaken.conversationId,
              sessionId: retaken.sessionId,
              turnRunning: false,
            },
          ],
        );
        assert.equal(yield* sandboxHeld(retaken.conversationId, at(7)), true);
      }),
  );

  it.effect("a lease goes with its conversation", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const { conversationId } = yield* openAgent();
      yield* holdSandbox(conversationId, at(5));
      yield* db.delete(conversations).where(eq(conversations.id, conversationId));

      assert.equal(yield* sandboxHeld(conversationId, at(0)), false);
      assert.deepEqual(yield* lapsedAmong(at(20), [conversationId]), []);
    }),
  );
});
