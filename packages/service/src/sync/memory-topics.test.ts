import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { MEMORY_OUTCOME, rememberMemory } from "@repo/database/models/memory-store";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB, openWorkspace } from "@repo/database/testing";
import { Effect } from "effect";
import { forgetWorkspaceMemory, WORKSPACE_MEMORY } from "../accounts/workspace-memories.js";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("what moves a workspace's memories notifies", (it) => {
  it.effect(
    "a memory kept, corrected, and forgotten each notify the workspace's memory topic alone, and the forget answers its notification's transaction",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const workspaceId = yield* openWorkspace(userId);
        const memories: readonly SyncTopic[] = [[TOPIC.MEMORY, workspaceId]];

        const kept = yield* expectTopicsFire(
          rememberMemory(workspaceId, userId, "Deployments go out from main.", undefined),
          memories,
        );
        assert.ok(kept.value.kind === MEMORY_OUTCOME.KEPT, "the memory was kept");
        const id = kept.value.memory.id;
        const corrected = yield* expectTopicsFire(
          rememberMemory(workspaceId, userId, "Deployments go out from the release branch.", id),
          memories,
        );
        assert.equal(corrected.value.kind, MEMORY_OUTCOME.CORRECTED);

        const forgot = yield* expectTopicsFire(
          forgetWorkspaceMemory(userId, workspaceId, id),
          memories,
        );
        assert.ok(forgot.value.kind === WORKSPACE_MEMORY.READ, "the memory was forgotten");
        assert.ok(forgot.value.txid !== undefined, "the forget answered its transaction");
        assert.deepEqual(forgot.txids, [forgot.value.txid]);
      }),
  );
});
