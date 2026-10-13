import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import { deleteAccount } from "@sidecar/database/models/account-store";
import { standingSessionsOf } from "@sidecar/database/models/recorded-session";
import {
  nextSessionSandboxes,
  queueSessionSandboxes,
} from "@sidecar/database/models/session-sandbox-cleanup";
import {
  CLEARED_CONVERSATION_RETENTION_MS,
  purgeClearedConversations,
} from "@sidecar/database/models/soft-delete";
import { user } from "@sidecar/database/schemas/auth";
import { sessionSandboxCleanup } from "@sidecar/database/schemas/session-sandbox";
import { conversations } from "@sidecar/database/schemas/storage";
import { CONVERSATION_KIND } from "@sidecar/database/storage-vocabulary";
import { getTestDB } from "@sidecar/database/testing";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import {
  SandboxUnavailable,
  SESSION_SANDBOX_SWEEP,
  SessionSandboxes,
  sweepSessionSandboxes,
} from "../server/hosted/session-sandboxes";

/**
 * The queue of eve sessions whose Vercel Sandboxes are still to be deleted,
 * over a real dialect: what lets go of a session queues it in its own
 * transaction, the purge and an account's deletion, and the sweep works the
 * queue against a Vercel Sandbox that answers from a script, dequeuing a
 * session whose sandboxes went and keeping one Vercel refused, behind the
 * rest. Every session id is minted per test, and every read is of those
 * ids, since the queue is the deployment's and not an account's.
 */

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** A conversation of the account that ran in the session named, stamped deleted where an instant is given. */
const openConversation = (
  userId: string,
  options: {
    readonly kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];
    readonly sessionId?: string;
    readonly deletedAt?: Date;
  },
) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .insert(conversations)
      .values({
        userId,
        kind: options.kind,
        runtimeSessionId: options.sessionId ?? null,
        deletedAt: options.deletedAt ?? null,
      })
      .returning({ id: conversations.id });
    assert.ok(row);
    return row.id;
  });

/** Which of the sessions named stand in the queue. */
const queuedOf = (sessionIds: readonly string[]) =>
  Effect.map(
    db
      .select({ sessionId: sessionSandboxCleanup.sessionId })
      .from(sessionSandboxCleanup)
      .where(inArray(sessionSandboxCleanup.sessionId, [...sessionIds])),
    (rows) => rows.map((row) => row.sessionId).sort(),
  );

const mintSession = () => `wrun_${randomUUID()}`;

/** Vercel Sandbox as the sweep asks it: every session's sandboxes deleted, save those of the sessions it refuses. */
function sandboxesAnswering(refused: ReadonlySet<string>, deleted: string[]) {
  return Layer.succeed(SessionSandboxes, {
    deleteFor: (sessionId) =>
      refused.has(sessionId)
        ? Effect.fail(new SandboxUnavailable({ status: 503 }))
        : Effect.sync(() => {
            deleted.push(sessionId);
            return 1;
          }),
  });
}

it.layer(getTestDB())("the session sandbox queue", (it) => {
  it.effect(
    "the purge queues the session each purged conversation ran in, once, and nothing of one still in its window",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        // The purge runs across every account, so these stamps stand in a year of their own.
        const stamped = new Date("2019-01-01T00:00:00.000Z");
        const purged = mintSession();
        const kept = mintSession();
        yield* openConversation(userId, {
          kind: CONVERSATION_KIND.PLAN,
          sessionId: purged,
          deletedAt: stamped,
        });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.CHILD, deletedAt: stamped });
        yield* openConversation(userId, {
          kind: CONVERSATION_KIND.CODING_AGENT,
          sessionId: kept,
          deletedAt: new Date(stamped.getTime() + CLEARED_CONVERSATION_RETENTION_MS),
        });

        yield* purgeClearedConversations(
          new Date(stamped.getTime() + CLEARED_CONVERSATION_RETENTION_MS),
        );

        assert.deepEqual(yield* queuedOf([purged, kept]), [purged]);
      }),
  );

  it.effect(
    "deleting an account queues the session of every conversation it held, cleared or standing, and another account's none",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const standing = mintSession();
        const cleared = mintSession();
        const others = mintSession();
        yield* openConversation(userId, { kind: CONVERSATION_KIND.PLAN, sessionId: standing });
        yield* openConversation(userId, {
          kind: CONVERSATION_KIND.CODING_AGENT,
          sessionId: cleared,
          deletedAt: new Date(),
        });
        yield* openConversation(other, { kind: CONVERSATION_KIND.PLAN, sessionId: others });

        yield* deleteAccount(userId);

        assert.deepEqual(yield* queuedOf([standing, cleared, others]), [cleared, standing].sort());
        assert.deepEqual(yield* standingSessionsOf(userId), []);
      }),
  );

  it.effect(
    "the standing sessions read names the account's standing conversations' sessions by kind, the ones asked for where it is asked, and none of another account's",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const other = yield* openUser;
        const planning = mintSession();
        const agent = mintSession();
        const planConversation = yield* openConversation(userId, {
          kind: CONVERSATION_KIND.PLAN,
          sessionId: planning,
        });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.CODING_AGENT, sessionId: agent });
        yield* openConversation(userId, {
          kind: CONVERSATION_KIND.CODING_AGENT,
          sessionId: mintSession(),
          deletedAt: new Date(),
        });
        yield* openConversation(userId, { kind: CONVERSATION_KIND.CHILD });
        yield* openConversation(other, { kind: CONVERSATION_KIND.PLAN, sessionId: mintSession() });

        const all = yield* standingSessionsOf(userId);
        assert.deepEqual(
          [...all].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
          [
            { sessionId: planning, kind: CONVERSATION_KIND.PLAN },
            { sessionId: agent, kind: CONVERSATION_KIND.CODING_AGENT },
          ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
        );
        assert.deepEqual(yield* standingSessionsOf(userId, [planConversation]), [
          { sessionId: planning, kind: CONVERSATION_KIND.PLAN },
        ]);
        assert.deepEqual(yield* standingSessionsOf(other, [planConversation]), []);
      }),
  );

  it.effect(
    "a sweep deletes each queued session's sandboxes and dequeues it, keeps one Vercel refused, and takes it again only behind the sessions never tried",
    () =>
      Effect.gen(function* () {
        // Drain whatever earlier tests queued, so this one reads its own sessions alone.
        yield* db.delete(sessionSandboxCleanup);
        const refused = mintSession();
        const accepted = mintSession();
        yield* queueSessionSandboxes([refused, accepted]);
        const deleted: string[] = [];

        const first = yield* sweepSessionSandboxes(new Date("2026-10-13T04:00:00.000Z")).pipe(
          Effect.provide(sandboxesAnswering(new Set([refused]), deleted)),
        );

        assert.deepEqual(first, { deleted: 1, pending: 1 });
        assert.deepEqual(deleted, [accepted]);
        assert.deepEqual(yield* queuedOf([refused, accepted]), [refused]);

        const later = mintSession();
        yield* queueSessionSandboxes([later]);
        assert.deepEqual(yield* nextSessionSandboxes(SESSION_SANDBOX_SWEEP.MAX_SESSIONS), [
          later,
          refused,
        ]);

        const second = yield* sweepSessionSandboxes(new Date("2026-10-13T04:01:00.000Z")).pipe(
          Effect.provide(sandboxesAnswering(new Set(), deleted)),
        );
        assert.deepEqual(second, { deleted: 2, pending: 0 });
        assert.deepEqual(yield* queuedOf([refused, accepted, later]), []);
      }),
  );
});
