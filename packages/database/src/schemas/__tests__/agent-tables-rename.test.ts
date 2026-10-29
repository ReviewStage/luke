import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CONTEXT_WINDOW } from "@luke/features/agent-wire";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database } from "../../core/query.js";
import { readAgent } from "../../models/agent-store.js";
import { createTask } from "../../models/task-store.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { agentDelegationTable } from "../agent.js";
import { agentRunnerLeaseTable } from "../agent-runner-lease.js";
import { agentWakeupTable } from "../agent-wakeup.js";
import { user } from "../auth.js";

/**
 * The migration that names the agent's tables `agent…`, over the release
 * before it: that release still serves for up to an hour after the deploy,
 * and names `coding_agent…`, so each old name is a view it writes through.
 * Every statement below is spelled as that release's Drizzle wrote it, the
 * omitted columns as `default`, against the old names; what it wrote reads
 * back under the new ones. Synthetic accounts throughout.
 */

const OLD_AT = new Date("2026-10-29T02:00:00Z");
const LATER = new Date("2026-10-29T02:05:00Z");

it.layer(getTestDB())("the release before the agent tables' rename", (it) => {
  it.effect(
    "starts an agent, takes and holds its runner lease, records a delegation and a wakeup, claims the wakeup, and deletes the agent, all through the old names",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const db = yield* Database;
        const userId = `user-${randomUUID()}`;
        yield* db.insert(user).values({ id: userId, name: "Dean", email: `${userId}@luke.test` });
        const organizationId = yield* openWorkspace(userId);
        const task = yield* createTask(userId, { organizationId, name: "Teammate invitations" });

        const conversationId = randomUUID();
        yield* sql`insert into conversations (id, user_id, kind) values (${conversationId}, ${userId}, 'coding_agent')`;
        const [started] = yield* sql<{ readonly id: string; readonly contextWindow: string }>`
          insert into "coding_agent" ("id", "task_id", "organization_id", "user_id", "conversation_id", "model", "effort", "context_window", "repositories", "kind", "machine", "idempotency_key", "created_at")
          values (default, ${task.id}, ${organizationId}, ${userId}, ${conversationId}, 'anthropic/claude-opus-5.5', 'high', default, default, default, default, ${randomUUID()}, default)
          returning "id", "context_window" as "contextWindow"`;
        const agentId = started?.id ?? assert.fail("the agent was not written");
        // A column the statement left to its default takes the table's own.
        assert.equal(started?.contextWindow, CONTEXT_WINDOW.LONG);
        assert.equal(
          Option.getOrThrow(yield* readAgent(userId, agentId)).conversationId,
          conversationId,
        );

        const claim = (holder: string) => sql<{ readonly holder: string }>`
          insert into "coding_agent_runner_lease" ("agent_id", "holder", "held_until") values (${agentId}, ${holder}, ${LATER})
          on conflict ("agent_id") do update set "holder" = ${holder}, "held_until" = ${LATER}
          where "coding_agent_runner_lease"."held_until" <= ${OLD_AT}
          returning "holder"`;
        const first = randomUUID();
        assert.deepEqual(yield* claim(first), [{ holder: first }]);
        assert.deepEqual(yield* claim(randomUUID()), []);

        const childId = randomUUID();
        yield* sql`insert into conversations (id, user_id, kind, parent_conversation_id) values (${childId}, ${userId}, 'child', ${conversationId})`;
        for (const model of ["anthropic/claude-opus-5.5", "anthropic/claude-haiku-5.5"]) {
          yield* sql`insert into "coding_agent_delegation" ("child_conversation_id", "call_id", "model", "effort")
            values (${childId}, 'call-1', ${model}, 'low') on conflict ("child_conversation_id") do nothing`;
        }

        const [wakeup] = yield* sql<{ readonly id: string }>`
          insert into "coding_agent_wakeup" ("id", "agent_id", "prompt", "due_at", "attempts", "created_at")
          values (default, ${agentId}, 'Read the checks', ${OLD_AT}, default, default) returning "id"`;
        const claimed = yield* sql<{ readonly id: string }>`
          select "id" from "coding_agent_wakeup" where "due_at" <= ${LATER}
          order by "due_at" for update of "coding_agent_wakeup" skip locked`;
        assert.deepEqual(claimed, [{ id: wakeup?.id }]);

        assert.deepEqual(
          yield* db
            .select({ model: agentDelegationTable.model })
            .from(agentDelegationTable)
            .where(eq(agentDelegationTable.childConversationId, childId)),
          [{ model: "anthropic/claude-opus-5.5" }],
        );

        yield* sql`delete from "coding_agent" where "id" = ${agentId}`;
        assert.deepEqual(
          [
            yield* db
              .select()
              .from(agentRunnerLeaseTable)
              .where(eq(agentRunnerLeaseTable.agentId, agentId)),
            yield* db.select().from(agentWakeupTable).where(eq(agentWakeupTable.agentId, agentId)),
          ],
          [[], []],
        );
      }),
  );
});
