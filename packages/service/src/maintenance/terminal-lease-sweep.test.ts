import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { sweepAbandonedTurns, TURN_ABANDON } from "@luke/database/models/abandoned-turns";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { sandboxTerminalLease } from "@luke/database/schemas/sandbox-terminal-lease";
import { conversations, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { eq, inArray } from "drizzle-orm";
import { Clock, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { SessionSandboxes, type SessionSandboxesService } from "../agents/session-sandboxes.js";
import { SandboxUnavailable } from "../agents/vercel-sandbox-api.js";
import { sweepTerminalLeases, TERMINAL_LEASE_SWEEP } from "./terminal-lease-sweep.js";

/**
 * The scheduled sweep's stop of a coding agent's sandbox once no terminal
 * holds it, over a real dialect and a Vercel Sandbox that answers from a
 * script: a lease lapsed past the grace has its idle sandbox stopped and
 * goes; one whose agent still runs a turn stays, its stop left to the turn's
 * end and to a later sweep once the turn is over; one still within the grace
 * stands; and one whose stop Vercel refused, or whose sweep ended before
 * Vercel answered, is left for a sweep past the retry bound and for no sweep
 * before it. Every conversation is minted per test, and every read is
 * narrowed to its ids.
 *
 * Synthetic accounts, conversations, and sessions throughout.
 */

const NOW = new Date(Date.UTC(2026, 9, 14, 12));
const GRACE_MS = Duration.toMillis(TERMINAL_LEASE_SWEEP.GRACE);
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

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

/** The cron's two sweeps in its order at the test clock's instant: the turns past their bounds settled, then the lapsed leases taken. */
const cronSweep = (layer: Layer.Layer<SessionSandboxes>) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const writer = yield* storeWriter({ tools: {} });
    yield* sweepAbandonedTurns({ writer }, { now });
    return yield* sweepTerminalLeases(new Date(now)).pipe(Effect.provide(layer));
  });

/** A Vercel Sandbox that stops what it is asked to, refusing the sessions named and dying under the ones named lost, and keeps what it was asked. */
function scriptedSandboxes(
  refused: ReadonlySet<string> = new Set(),
  lost: ReadonlySet<string> = new Set(),
) {
  const stopAsked: string[] = [];
  const service: SessionSandboxesService = {
    deleteFor: () => Effect.die("the terminal sweep deletes nothing"),
    stopFor: (sessionId) =>
      Effect.suspend(() => {
        stopAsked.push(sessionId);
        if (lost.has(sessionId)) return Effect.die("the sweep's function ended mid-stop");
        return refused.has(sessionId)
          ? Effect.fail(new SandboxUnavailable({ status: 503 }))
          : Effect.succeed(1);
      }),
  };
  return { layer: Layer.succeed(SessionSandboxes, service), stopAsked };
}

/** The leases still standing among the conversations named, by conversation. */
const standingAmong = (conversationIds: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ conversationId: sandboxTerminalLease.conversationId })
      .from(sandboxTerminalLease)
      .where(inArray(sandboxTerminalLease.conversationId, [...conversationIds]));
    return rows.map((row) => row.conversationId).sort();
  });

it.layer(getTestDB())("the terminal lease sweep", (it) => {
  it.effect(
    "a lease lapsed past the grace has its idle sandbox stopped and goes, a running turn's stays for later, and one within the grace stands",
    () =>
      Effect.gen(function* () {
        const idle = yield* openAgent(TURN_STATUS.SETTLED);
        const working = yield* openAgent(TURN_STATUS.RUNNING);
        const recent = yield* openAgent(TURN_STATUS.SETTLED);
        yield* holdSandbox(idle.conversationId, minutesBefore(10));
        yield* holdSandbox(working.conversationId, minutesBefore(10));
        // Lapsed, but by less than the grace: a terminal reconnecting would take it up again.
        yield* holdSandbox(recent.conversationId, new Date(NOW.getTime() - GRACE_MS + 1));
        const vercel = scriptedSandboxes();

        const outcome = yield* sweepTerminalLeases(NOW).pipe(Effect.provide(vercel.layer));
        const ids = [idle.conversationId, working.conversationId, recent.conversationId];

        assert.ok(outcome.stopped >= 1);
        assert.ok(vercel.stopAsked.includes(idle.sessionId), "the idle sandbox is stopped");
        assert.ok(
          !vercel.stopAsked.includes(working.sessionId),
          "a running turn's end stops its own",
        );
        assert.ok(!vercel.stopAsked.includes(recent.sessionId), "a lease within the grace is left");
        assert.deepEqual(
          yield* standingAmong(ids),
          [working.conversationId, recent.conversationId].sort(),
        );
      }),
  );

  it.effect(
    "a lease whose agent's Stop eve never confirmed is swept once the turn settles as cancelled, and a turn running inside its bounds keeps its own",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        yield* TestClock.setTime(NOW.getTime());
        const stopped = yield* openAgent();
        const working = yield* openAgent();
        const turnIds = { stopped: randomUUID(), working: randomUUID() };
        for (const [agent, id] of [
          [stopped, turnIds.stopped],
          [working, turnIds.working],
        ] as const) {
          yield* db.insert(turns).values({
            id,
            userId: agent.userId,
            conversationId: agent.conversationId,
            origin: TURN_ORIGIN.TYPED,
            status: TURN_STATUS.RUNNING,
            queuedAt: minutesBefore(60),
            startedAt: minutesBefore(60),
          });
          yield* holdSandbox(agent.conversationId, minutesBefore(10));
        }
        // The Stop a Continue asks of its source, whose session died in a deploy, so no end follows.
        yield* db
          .update(turns)
          .set({ cancelRequestedAt: NOW })
          .where(eq(turns.id, turnIds.stopped));
        const vercel = scriptedSandboxes();

        yield* TestClock.adjust(Duration.millis(TURN_ABANDON.CANCEL_AFTER_MS - 1));
        yield* cronSweep(vercel.layer);
        const mine = new Set([stopped.sessionId, working.sessionId]);
        const askedWithinBound = vercel.stopAsked.filter((id) => mine.has(id));
        yield* TestClock.adjust(Duration.millis(2));
        yield* cronSweep(vercel.layer);
        const status = (id: string) =>
          Effect.map(
            db.select({ status: turns.status }).from(turns).where(eq(turns.id, id)),
            (rows) => rows[0]?.status,
          );

        assert.deepEqual(askedWithinBound, [], "eve may still confirm the Stop");
        assert.equal(yield* status(turnIds.stopped), TURN_STATUS.CANCELLED);
        assert.deepEqual(
          vercel.stopAsked.filter((id) => mine.has(id)),
          [stopped.sessionId],
        );
        assert.equal(yield* status(turnIds.working), TURN_STATUS.RUNNING);
        assert.deepEqual(yield* standingAmong([stopped.conversationId, working.conversationId]), [
          working.conversationId,
        ]);
      }),
  );

  it.effect(
    "a lease whose stop Vercel refused is tried again past the retry bound, and not before",
    () =>
      Effect.gen(function* () {
        const refused = yield* openAgent(TURN_STATUS.SETTLED);
        yield* holdSandbox(refused.conversationId, minutesBefore(10));
        const refusing = scriptedSandboxes(new Set([refused.sessionId]));
        const answering = scriptedSandboxes();
        const retryAt = new Date(NOW.getTime() + Duration.toMillis(TERMINAL_LEASE_SWEEP.RETRY));

        const outcome = yield* sweepTerminalLeases(NOW).pipe(Effect.provide(refusing.layer));
        yield* sweepTerminalLeases(new Date(retryAt.getTime() - 1)).pipe(
          Effect.provide(answering.layer),
        );
        const standingBeforeRetry = yield* standingAmong([refused.conversationId]);
        yield* sweepTerminalLeases(new Date(retryAt.getTime() + 1)).pipe(
          Effect.provide(answering.layer),
        );

        assert.ok(outcome.pending >= 1);
        assert.ok(refusing.stopAsked.includes(refused.sessionId));
        assert.deepEqual(standingBeforeRetry, [refused.conversationId]);
        assert.deepEqual(
          answering.stopAsked.filter((id) => id === refused.sessionId),
          [refused.sessionId],
          "asked once, past the bound",
        );
        assert.deepEqual(yield* standingAmong([refused.conversationId]), []);
      }),
  );

  it.effect("a sweep that ended before Vercel answered leaves the lease for a later sweep", () =>
    Effect.gen(function* () {
      const lost = yield* openAgent(TURN_STATUS.SETTLED);
      yield* holdSandbox(lost.conversationId, minutesBefore(10));
      const ending = scriptedSandboxes(new Set(), new Set([lost.sessionId]));
      const answering = scriptedSandboxes();
      const later = new Date(NOW.getTime() + Duration.toMillis(TERMINAL_LEASE_SWEEP.RETRY) + 1);

      yield* Effect.exit(sweepTerminalLeases(NOW).pipe(Effect.provide(ending.layer)));
      const standing = yield* standingAmong([lost.conversationId]);
      yield* sweepTerminalLeases(later).pipe(Effect.provide(answering.layer));

      assert.deepEqual(standing, [lost.conversationId]);
      assert.ok(answering.stopAsked.includes(lost.sessionId), "the later sweep stops it");
    }),
  );
});
