import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { holdSandbox, lapsedSandboxLeases } from "@sidecar/database/models/sandbox-terminal-lease";
import { user } from "@sidecar/database/schemas/auth";
import { conversations, turns } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { getTestDB } from "@sidecar/database/testing";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@sidecar/wire";
import { Duration, Effect, Layer } from "effect";
import {
  SandboxUnavailable,
  SessionSandboxes,
  type SessionSandboxesService,
} from "../server/hosted/session-sandboxes";
import { sweepTerminalLeases, TERMINAL_LEASE_SWEEP } from "../server/hosted/terminal-lease-sweep";

/**
 * The scheduled sweep's stop of a coding agent's sandbox once no terminal
 * holds it, over a real dialect and a Vercel Sandbox that answers from a
 * script: a lease lapsed past the grace has its idle sandbox stopped and
 * goes, one whose agent still runs a turn goes and leaves the stop to the
 * turn's end, one still within the grace stands, and one whose stop Vercel
 * refused stays for the next sweep. Every conversation is minted per test,
 * and every read is narrowed to its ids.
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
    return { conversationId: row.id, sessionId };
  });

/** A Vercel Sandbox that stops what it is asked to, refusing the sessions named, and keeps what it was asked. */
function scriptedSandboxes(refused: ReadonlySet<string> = new Set()) {
  const stopAsked: string[] = [];
  const service: SessionSandboxesService = {
    deleteFor: () => Effect.die("the terminal sweep deletes nothing"),
    stopFor: (sessionId) =>
      Effect.suspend(() => {
        stopAsked.push(sessionId);
        return refused.has(sessionId)
          ? Effect.fail(new SandboxUnavailable({ status: 503 }))
          : Effect.succeed(1);
      }),
  };
  return { layer: Layer.succeed(SessionSandboxes, service), stopAsked };
}

/** The leases still standing among the conversations named, by conversation. */
const standingAmong = (conversationIds: readonly string[]) =>
  Effect.map(lapsedSandboxLeases(new Date(NOW.getTime() + 60 * 60_000), 1_000), (leases) =>
    leases
      .map((lease) => lease.conversationId)
      .filter((id) => conversationIds.includes(id))
      .sort(),
  );

it.layer(getTestDB())("the terminal lease sweep", (it) => {
  it.effect(
    "a lease lapsed past the grace has its idle sandbox stopped and goes, a running turn's goes with its stop left to the turn's end, and one within the grace stands",
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

        assert.ok(outcome.stopped >= 1 && outcome.released >= 1);
        assert.ok(vercel.stopAsked.includes(idle.sessionId), "the idle sandbox is stopped");
        assert.ok(
          !vercel.stopAsked.includes(working.sessionId),
          "a running turn's end stops its own",
        );
        assert.ok(!vercel.stopAsked.includes(recent.sessionId), "a lease within the grace is left");
        assert.deepEqual(yield* standingAmong(ids), [recent.conversationId]);
      }),
  );

  it.effect("a lease whose stop Vercel refused stays for the next sweep", () =>
    Effect.gen(function* () {
      const refused = yield* openAgent(TURN_STATUS.SETTLED);
      yield* holdSandbox(refused.conversationId, minutesBefore(10));
      const vercel = scriptedSandboxes(new Set([refused.sessionId]));

      const outcome = yield* sweepTerminalLeases(NOW).pipe(Effect.provide(vercel.layer));

      assert.ok(outcome.pending >= 1);
      assert.ok(vercel.stopAsked.includes(refused.sessionId));
      assert.deepEqual(yield* standingAmong([refused.conversationId]), [refused.conversationId]);
    }),
  );
});
