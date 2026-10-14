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
  claimLapsedLease,
  deferLapsedLease,
  holdSandbox,
  lapsedSandboxLeases,
  sandboxHeld,
} from "../sandbox-terminal-lease.js";

/**
 * The lease a developer's typing holds on a coding agent's sandbox, over a
 * real dialect: it moves on and never back and holds until its instant; it
 * lapses for the sweep with the session its sandbox is tagged with, only
 * while no turn of its agent runs; a claim takes it only while it is still
 * lapsed; and a stop that failed puts it back behind the leases not yet
 * tried, unless the developer typed since. Every conversation is minted per test and every read is of its
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
    "a lapsed lease is read with the session its sandbox is tagged with, a running turn's and a held one are not",
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
          { conversationId: idle.conversationId, sessionId: idle.sessionId, heldUntil: at(1) },
        ]);
      }),
  );

  it.effect("a claim takes a lease only while it is still lapsed", () =>
    Effect.gen(function* () {
      const claimed = yield* openAgent();
      const retaken = yield* openAgent();
      yield* holdSandbox(claimed.conversationId, at(1));
      yield* holdSandbox(retaken.conversationId, at(1));
      // Typing again after the sweep read the lease as lapsed before at(3).
      yield* holdSandbox(retaken.conversationId, at(8));

      assert.equal(yield* claimLapsedLease(claimed.conversationId, at(3)), true);
      assert.equal(
        yield* claimLapsedLease(claimed.conversationId, at(3)),
        false,
        "a claim is had once",
      );
      assert.equal(yield* claimLapsedLease(retaken.conversationId, at(3)), false);
      assert.equal(yield* sandboxHeld(retaken.conversationId, at(7)), true);
    }),
  );

  it.effect(
    "a lease whose stop failed waits behind the leases not yet tried, and typing since keeps the developer's lease",
    () =>
      Effect.gen(function* () {
        const failed = yield* openAgent();
        const untried = yield* openAgent();
        const retaken = yield* openAgent();
        yield* holdSandbox(failed.conversationId, at(1));
        yield* holdSandbox(untried.conversationId, at(2));
        yield* holdSandbox(retaken.conversationId, at(1));
        const [failedLease] = yield* lapsedAmong(at(5), [failed.conversationId]);
        const [retakenLease] = yield* lapsedAmong(at(5), [retaken.conversationId]);
        assert.ok(failedLease !== undefined && retakenLease !== undefined);
        yield* claimLapsedLease(failed.conversationId, at(5));
        yield* claimLapsedLease(retaken.conversationId, at(5));
        yield* holdSandbox(retaken.conversationId, at(20));

        yield* deferLapsedLease(failedLease, at(6));
        yield* deferLapsedLease(retakenLease, at(6));

        assert.deepEqual(
          (yield* lapsedAmong(at(7), [failed.conversationId, untried.conversationId])).map(
            (lease) => lease.conversationId,
          ),
          [untried.conversationId, failed.conversationId],
        );
        assert.equal(yield* sandboxHeld(retaken.conversationId, at(19)), true);
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
