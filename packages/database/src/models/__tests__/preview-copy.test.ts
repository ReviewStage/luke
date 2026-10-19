import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
} from "@luke/features/brain";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { member, organization, user } from "../../schemas/auth.js";
import { automation, automationRun } from "../../schemas/automation.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { macCommand, macCommandListener } from "../../schemas/mac-command.js";
import { sandboxTerminalLease } from "../../schemas/sandbox-terminal-lease.js";
import { sessionSandboxCleanup } from "../../schemas/session-sandbox.js";
import { conversations } from "../../schemas/storage.js";
import { voiceAvatarSessions, voiceSessions } from "../../schemas/voice.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { VOICE_DELEGATION_MODE } from "../../voice-vocabulary.js";
import { createAutomation, recordAutomationRun } from "../automation-store.js";
import { latestTurnsOfReached } from "../coding-agent-store.js";
import { switchOffCopiedWork } from "../preview-copy.js";
import { createTask } from "../task-store.js";
import { type ConversationTarget, type StoreWriter, storeWriter } from "../writer.js";

/**
 * A Preview's copy of production's database with the work production had in
 * flight switched off, over a real dialect: running turns settled, agents
 * archived, calls closed, automations paused, and the Mac command and sandbox
 * queues emptied.
 *
 * Synthetic accounts, workspaces, and runs throughout.
 */

const NOW = 1_800_000_000_000;

/** A new account and a workspace it owns; answers both ids. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  const workspaceId = randomUUID();
  const at = new Date(NOW);
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  yield* db.insert(organization).values({
    id: workspaceId,
    name: "Test Workspace",
    slug: `workspace-${workspaceId}`,
    createdAt: at,
  });
  yield* db.insert(member).values({
    id: randomUUID(),
    organizationId: workspaceId,
    userId,
    role: "owner",
    createdAt: at,
  });
  return { userId, workspaceId };
});

/** A coding agent of the account's, its one turn running as eve began it; answers its id and conversation. */
const openRunningAgent = (writer: StoreWriter, userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    const [agent] = yield* db
      .insert(codingAgent)
      .values({
        organizationId,
        userId,
        conversationId,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: "acme/api",
        idempotencyKey: randomUUID(),
      })
      .returning({ id: codingAgent.id });
    const target: ConversationTarget = { userId, conversationId };
    const turnId = randomUUID();
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consume(target, {
      conversationId: sessionKey(conversationId),
      turnId,
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: BRAIN_TURN_ORIGIN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      at: NOW,
    });
    return { agentId: agent?.id ?? "", target };
  });

/** A command queued for the account's Mac and the Mac listening, an open call with its avatar, and the agent's sandbox held and another queued for deletion. */
const leaveInFlight = (target: ConversationTarget) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const at = new Date(NOW);
    const { userId } = target;
    yield* db.insert(macCommand).values({
      id: randomUUID(),
      userId,
      command: "git status",
      timeoutSeconds: 60,
      queuedAt: at,
    });
    yield* db.insert(macCommandListener).values({ userId, seenAt: at });
    const [call] = yield* db
      .insert(voiceSessions)
      .values({ userId, liveSessionId: randomUUID(), delegationMode: VOICE_DELEGATION_MODE.CLIENT })
      .returning({ id: voiceSessions.id });
    yield* db
      .insert(voiceAvatarSessions)
      .values({ voiceSessionId: call?.id ?? "", userId, personaId: "persona", startedAt: at });
    yield* db
      .insert(sandboxTerminalLease)
      .values({ conversationId: target.conversationId, heldUntil: new Date(NOW + 60_000) });
    yield* db.insert(sessionSandboxCleanup).values({ sessionId: `session-${randomUUID()}` });
  });

/** A scheduled automation of the account's on a task in the workspace, due, with a firing queued; answers its id. */
const openDueAutomation = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const made = yield* createTask(userId, {
      organizationId,
      name: "Nightly",
      repository: "acme/api",
    });
    const scheduled = Option.getOrThrow(
      yield* createAutomation(userId, {
        taskId: made.id,
        name: "Nightly flaky-test sweep",
        trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
        action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix one flaky test." },
        guards: AUTOMATION_DEFAULT_GUARDS,
        nextRunAt: new Date(NOW),
        webhookSecretHash: null,
      }),
    );
    yield* recordAutomationRun(scheduled, {
      dedupeKey: randomUUID(),
      firing: { kind: AUTOMATION_FIRING.SCHEDULE, dueAt: NOW },
      firedAt: new Date(NOW),
    });
    return scheduled.id;
  });

/** How many rows the table holds. */
const countOf = (table: PgTable) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db.select({ count: sql<number>`count(*)::int` }).from(table);
    return Number(row?.count ?? 0);
  });

it.layer(getTestDB())("a Preview's copy of production", (it) => {
  it.effect(
    "has every running turn settled, every agent archived, every call closed, every automation paused, and the Mac and sandbox queues emptied",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const writer = yield* storeWriter({ tools: {} });
        const { userId, workspaceId } = yield* openAccount;
        const running = yield* openRunningAgent(writer, userId, workspaceId);
        yield* leaveInFlight(running.target);
        const nightly = yield* openDueAutomation(userId, workspaceId);

        const counts = yield* switchOffCopiedWork({ writer }, NOW + 1_000);

        assert.deepEqual(counts, { settledTurns: 1, archivedAgents: 1 });
        const latest = yield* latestTurnsOfReached([running.target.conversationId]);
        const turn = latest.get(running.target.conversationId);
        assert.deepEqual(
          [turn?.status, turn?.failure],
          [TURN_STATUS.FAILED, BRAIN_REQUEST_FAILURE.SESSION_ENDED],
        );
        const [agent] = yield* db
          .select({ archivedAt: codingAgent.archivedAt })
          .from(codingAgent)
          .where(eq(codingAgent.id, running.agentId));
        assert.notEqual(agent?.archivedAt ?? null, null, "the agent is archived");

        const [call] = yield* db.select({ closedAt: voiceSessions.closedAt }).from(voiceSessions);
        assert.notEqual(call?.closedAt ?? null, null, "the open call is closed");
        const [avatar] = yield* db
          .select({ endedAt: voiceAvatarSessions.endedAt })
          .from(voiceAvatarSessions);
        assert.notEqual(avatar?.endedAt ?? null, null, "its avatar is ended");

        const [paused] = yield* db
          .select({ enabled: automation.enabled, nextRunAt: automation.nextRunAt })
          .from(automation)
          .where(eq(automation.id, nightly));
        assert.deepEqual(paused, { enabled: false, nextRunAt: null });
        const runs = yield* db
          .select({ status: automationRun.status, reason: automationRun.reason })
          .from(automationRun)
          .where(eq(automationRun.automationId, nightly));
        assert.deepEqual(runs, [
          { status: AUTOMATION_RUN_STATUS.SKIPPED, reason: AUTOMATION_RUN_REASON.PAUSED },
        ]);

        for (const [name, table] of [
          ["Mac commands", macCommand],
          ["Mac listeners", macCommandListener],
          ["terminal leases", sandboxTerminalLease],
          ["sandbox deletions", sessionSandboxCleanup],
        ] as const) {
          assert.equal(yield* countOf(table), 0, `no ${name} stand`);
        }
      }),
  );
});
