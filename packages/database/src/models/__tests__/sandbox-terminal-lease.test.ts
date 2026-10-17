import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { TURN_ABANDON } from "../abandoned-turns.js";
import {
  claimCredentialRenewal,
  claimLapsedLease,
  holdSandbox,
  lapsedSandboxLeases,
  releaseCredentialRenewal,
  releaseLapsedLease,
  sandboxHeld,
} from "../sandbox-terminal-lease.js";

/**
 * The lease a developer's typing holds on a coding agent's sandbox, over a
 * real dialect: it moves on and never back and holds until its instant; it
 * lapses for the sweep with the session its sandbox is tagged with, only
 * while no turn of its agent runs; a claim takes it once, only while it is
 * still lapsed and no turn runs, and a claimed lease waits behind the leases
 * not yet tried until the retry bound; and a release lets go of a lease only
 * while it is still lapsed. Every conversation is minted per test and every
 * read is of its ids, since the lease is the deployment's and not an
 * account's.
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
    return { userId, conversationId: row.id, sessionId };
  });

/** A coding agent's conversation whose one turn has run since the instant given, a Stop asked of it at the instant given where one is. */
const runningAgent = (startedAt: Date, cancelRequestedAt: Date | null = null) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const agent = yield* openAgent();
    yield* db.insert(turns).values({
      userId: agent.userId,
      conversationId: agent.conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.RUNNING,
      queuedAt: startedAt,
      startedAt,
      cancelRequestedAt,
    });
    return agent;
  });

/** The lapsed leases the sweep would take before the instant given, narrowed to the conversations named; a claim before `triedBefore` is taken up again. */
const lapsedAmong = (
  lapsedBefore: Date,
  conversationIds: readonly string[],
  triedBefore: Date = lapsedBefore,
) =>
  Effect.map(lapsedSandboxLeases(lapsedBefore, triedBefore, 1_000, lapsedBefore), (leases) =>
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

  it.effect(
    "a running turn past its bounds holds no lease: one past a coding agent's day and an hour, or one whose Stop went unconfirmed past its bound",
    () =>
      Effect.gen(function* () {
        const now = at(10);
        const minutesBeforeNow = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
        const cancelBoundMinutes = TURN_ABANDON.CANCEL_AFTER_MS / 60_000;
        const runDayMinutes = TURN_ABANDON.CODING_AGENT_AFTER_MS / 60_000;
        const working = yield* runningAgent(minutesBeforeNow(60));
        const stopping = yield* runningAgent(
          minutesBeforeNow(60),
          minutesBeforeNow(cancelBoundMinutes - 1),
        );
        const stopLost = yield* runningAgent(
          minutesBeforeNow(60),
          minutesBeforeNow(cancelBoundMinutes + 1),
        );
        const runLost = yield* runningAgent(minutesBeforeNow(runDayMinutes + 1));
        const agents = [working, stopping, stopLost, runLost];
        for (const { conversationId } of agents) yield* holdSandbox(conversationId, at(1));
        const ids = agents.map((agent) => agent.conversationId);

        const lapsed = yield* Effect.map(lapsedSandboxLeases(at(5), at(5), 1_000, now), (leases) =>
          leases.filter((lease) => ids.includes(lease.conversationId)),
        );
        const claimedWorking = yield* claimLapsedLease(working.conversationId, at(5), at(5), now);
        const claimedStopLost = yield* claimLapsedLease(stopLost.conversationId, at(5), at(5), now);

        assert.deepEqual(
          lapsed.map((lease) => lease.conversationId).sort(),
          [stopLost.conversationId, runLost.conversationId].sort(),
          "a turn inside its bounds, its Stop's too, still holds its sandbox",
        );
        assert.deepEqual([claimedWorking, claimedStopLost], [false, true]);
      }),
  );

  it.effect(
    "a claim takes a lease once, only while it is still lapsed and no turn of its agent runs",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const claimed = yield* openAgent();
        const retaken = yield* openAgent();
        const resumed = yield* openAgent(TURN_STATUS.SETTLED);
        for (const { conversationId } of [claimed, retaken, resumed]) {
          yield* holdSandbox(conversationId, at(1));
        }
        // Typing again, and a turn beginning, after the sweep read the leases as lapsed before at(3).
        yield* holdSandbox(retaken.conversationId, at(8));
        const [row] = yield* db
          .select({ userId: conversations.userId })
          .from(conversations)
          .where(eq(conversations.id, resumed.conversationId));
        assert.ok(row);
        yield* db.insert(turns).values({
          userId: row.userId,
          conversationId: resumed.conversationId,
          origin: TURN_ORIGIN.TYPED,
          status: TURN_STATUS.RUNNING,
        });

        assert.equal(yield* claimLapsedLease(claimed.conversationId, at(3), at(0), at(3)), true);
        assert.equal(
          yield* claimLapsedLease(claimed.conversationId, at(3), at(0), at(3)),
          false,
          "a claim is had once",
        );
        assert.equal(yield* claimLapsedLease(retaken.conversationId, at(3), at(0), at(3)), false);
        assert.equal(yield* claimLapsedLease(resumed.conversationId, at(3), at(0), at(3)), false);
        assert.equal(yield* sandboxHeld(retaken.conversationId, at(7)), true);
      }),
  );

  it.effect(
    "a claimed lease waits behind the leases not yet tried until the retry bound, and typing clears its claim",
    () =>
      Effect.gen(function* () {
        const claimed = yield* openAgent();
        const untried = yield* openAgent();
        const retaken = yield* openAgent();
        for (const { conversationId } of [claimed, untried, retaken]) {
          yield* holdSandbox(conversationId, at(1));
        }
        yield* claimLapsedLease(claimed.conversationId, at(5), at(0), at(6));
        yield* claimLapsedLease(retaken.conversationId, at(5), at(0), at(6));
        yield* holdSandbox(retaken.conversationId, at(7));
        const ids = [claimed.conversationId, untried.conversationId, retaken.conversationId];

        const withinBound = yield* lapsedAmong(at(10), ids, at(6));
        const pastBound = yield* lapsedAmong(at(10), ids, at(12));

        assert.deepEqual(
          withinBound.map((lease) => lease.conversationId),
          [untried.conversationId, retaken.conversationId],
          "a claim within the bound is no sweep's to take; typing cleared the other",
        );
        assert.deepEqual(
          pastBound.map((lease) => lease.conversationId),
          [untried.conversationId, retaken.conversationId, claimed.conversationId],
        );
      }),
  );

  it.effect("a release lets go of a lease only while it is still lapsed", () =>
    Effect.gen(function* () {
      const stopped = yield* openAgent();
      const retaken = yield* openAgent();
      yield* holdSandbox(stopped.conversationId, at(1));
      yield* holdSandbox(retaken.conversationId, at(1));
      yield* claimLapsedLease(stopped.conversationId, at(3), at(0), at(3));
      yield* claimLapsedLease(retaken.conversationId, at(3), at(0), at(3));
      // The developer typed while Vercel stopped the sandbox.
      yield* holdSandbox(retaken.conversationId, at(9));

      yield* releaseLapsedLease(stopped.conversationId, at(3));
      yield* releaseLapsedLease(retaken.conversationId, at(3));

      assert.deepEqual(yield* lapsedAmong(at(20), [stopped.conversationId]), []);
      assert.equal(yield* sandboxHeld(retaken.conversationId, at(8)), true);
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

  it.effect(
    "the GitHub token's renewal is claimed once per lease while due, so two windows mint one token",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        const unleased = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        const first = yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        const second = yield* claimCredentialRenewal(conversationId, "sbs_1", at(1), at(-49));
        const due = yield* claimCredentialRenewal(conversationId, "sbs_1", at(51), at(1));
        const none = yield* claimCredentialRenewal(
          unleased.conversationId,
          "sbs_1",
          at(0),
          at(-50),
        );

        assert.deepEqual([first, second, due, none], [true, false, true, false]);
      }),
  );

  it.effect(
    "a renewal given back is claimed again at the next check, and a later claim is not given back",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        yield* claimCredentialRenewal(conversationId, "sbs_1", at(0), at(-50));
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const retried = yield* claimCredentialRenewal(conversationId, "sbs_1", at(5), at(-45));
        yield* releaseCredentialRenewal(conversationId, "sbs_1", at(0));
        const stillClaimed = yield* claimCredentialRenewal(
          conversationId,
          "sbs_1",
          at(10),
          at(-40),
        );

        assert.equal(retried, true, "the failed claim was given back");
        assert.equal(stillClaimed, false, "a stale give-back leaves the later claim standing");
      }),
  );

  it.effect(
    "a resumed sandbox's new session claims its renewal at once, however lately the old one was renewed",
    () =>
      Effect.gen(function* () {
        const { conversationId } = yield* openAgent();
        yield* holdSandbox(conversationId, at(5));

        yield* claimCredentialRenewal(conversationId, "sbs_before_stop", at(0), at(-50));
        const sameSession = yield* claimCredentialRenewal(
          conversationId,
          "sbs_before_stop",
          at(10),
          at(-40),
        );
        const resumed = yield* claimCredentialRenewal(
          conversationId,
          "sbs_resumed",
          at(10),
          at(-40),
        );
        const resumedAgain = yield* claimCredentialRenewal(
          conversationId,
          "sbs_resumed",
          at(11),
          at(-39),
        );

        assert.deepEqual([sameSession, resumed, resumedAgain], [false, true, false]);
      }),
  );

  it.effect("a give-back from another session at the same instant leaves the standing claim", () =>
    Effect.gen(function* () {
      const { conversationId } = yield* openAgent();
      yield* holdSandbox(conversationId, at(5));

      yield* claimCredentialRenewal(conversationId, "sbs_resumed", at(0), at(-50));
      yield* releaseCredentialRenewal(conversationId, "sbs_before_stop", at(0));
      const claimedAgain = yield* claimCredentialRenewal(
        conversationId,
        "sbs_resumed",
        at(1),
        at(-49),
      );

      assert.equal(claimedAgain, false, "the resumed session's claim still stands");
    }),
  );
});
