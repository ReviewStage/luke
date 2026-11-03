import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { agentTable } from "../../schemas/agent.js";
import { member, organization, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { createAgent } from "../agent-store.js";
import { createAutomation, recordAutomationRun } from "../automation-store.js";
import { readRunAgents } from "../run-agents.js";

/**
 * The agents an automation's run made, over a real dialect: every agent
 * that names the run, and no other run's, read in the order they were
 * started, and none for an account outside the automation's workspace.
 *
 * Synthetic accounts, workspaces, and automations throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** A workspace the account owns, as the organization plugin would leave the rows. */
const openWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const organizationId = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Test Workspace",
      slug: `workspace-${organizationId}`,
      createdAt: now,
    });
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role: "owner", createdAt: now });
    return organizationId;
  });

it.layer(getTestDB())("a run's agents", (it) => {
  it.effect(
    "a run reads every agent that names it, oldest first, and an account outside its workspace reads none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const outsider = yield* openAccount;
        yield* openWorkspace(outsider);
        const organizationId = yield* openWorkspace(owner);
        const made = Option.getOrThrow(
          yield* createAutomation(owner, {
            organizationId,
            repositories: ["acme/api"],
            name: "Triage new issues",
            trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 2 * * *", timezone: "UTC" },
            action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the new issues." },
            guards: AUTOMATION_DEFAULT_GUARDS,
            nextRunAt: null,
            webhookSecretHash: null,
          }),
        );
        const runOf = (dedupeKey: string) =>
          Effect.map(
            recordAutomationRun(made, {
              dedupeKey,
              firing: { kind: AUTOMATION_FIRING.MANUAL },
              firedAt: new Date(),
            }),
            (recorded) => Option.getOrThrow(recorded).id,
          );
        const agentOf = (title: string, automationRunId: string) =>
          Effect.map(
            createAgent(owner, {
              taskId: null,
              organizationId,
              planSnapshot: null,
              prompt: "Triage the new issues.",
              automationId: made.id,
              automationRunId,
              title,
              idempotencyKey: randomUUID(),
              model: "anthropic/claude-opus-5.5",
              effort: "high",
              repository: "acme/api",
            }),
            (started) => Option.getOrThrow(started).agent.id,
          );
        const run = yield* runOf("manual-1");
        const otherRun = yield* runOf("manual-2");
        const first = yield* agentOf("Triage run", run);
        const second = yield* agentOf("Fix the flaky test", run);
        const elsewhere = yield* agentOf("Another run", otherRun);
        // Each row gets a start instant of its own, so the order does not hang on the clock's resolution.
        const db = yield* Database;
        const startedAt = (agentId: string, createdAt: string) =>
          db
            .update(agentTable)
            .set({ createdAt: new Date(createdAt) })
            .where(eq(agentTable.id, agentId));
        yield* startedAt(second, "2026-10-30T10:05:00Z");
        yield* startedAt(first, "2026-10-30T10:00:00Z");
        yield* startedAt(elsewhere, "2026-10-30T09:00:00Z");

        const read = yield* readRunAgents(owner, run);
        assert.deepEqual(
          read.map((agent) => [agent.id, agent.title]),
          [
            [first, "Triage run"],
            [second, "Fix the flaky test"],
          ],
        );
        assert.deepEqual(yield* readRunAgents(outsider, run), []);
      }),
  );
});
