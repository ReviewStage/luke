import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  CHAPTER_CLAIM_OUTCOME,
  claimChapterGeneration,
  finishChapterGeneration,
} from "@repo/database/models/pull-request-chapters-store";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB, openWorkspace } from "@repo/database/testing";
import { Effect } from "effect";

/**
 * A pull request's chapters on the migrated capture: a Generate's claim and
 * its finish, each through the store's own writer, notify the workspace's
 * chapters topic alone, which the chapters' live read is woken on, and
 * never the workspace's own, which would wake every member's task list on
 * each Generate.
 *
 * Synthetic accounts, repositories, and commits throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("what moves a pull request's chapters notifies", (it) => {
  it.effect("a claim and its finish each notify the workspace's chapters topic alone", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const workspaceId = yield* openWorkspace(userId);
      const chapters: readonly SyncTopic[] = [[TOPIC.WORKSPACE_CHAPTERS, workspaceId]];

      const claimed = yield* expectTopicsFire(
        claimChapterGeneration({
          organizationId: workspaceId,
          repository: "acme/relay",
          pullRequestNumber: 7,
          baseSha: "ba5e000",
          headSha: "c0ffee1",
          requestedBy: userId,
          now: new Date(0),
        }),
        chapters,
      );
      assert.ok(claimed.value.outcome === CHAPTER_CLAIM_OUTCOME.CLAIMED, "the head was claimed");

      const finished = yield* expectTopicsFire(
        finishChapterGeneration(claimed.value.claim, {
          model: "claude-haiku-5-5",
          chapters: [],
          now: new Date(1),
        }),
        chapters,
      );
      assert.ok(finished.value, "the chapters landed under the claim");
    }),
  );
});
