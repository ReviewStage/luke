import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { MAIN_SESSION_KEY, sessionKey } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import {
  ARCHIVE_REFUSAL,
  ArchiveOperationRefused,
  deleteConversationEffect,
  publishPendingArchivesEffect,
  removeArchiveEffect,
} from "./archives.effect.js";
import { listArchives } from "./archives.js";
import { NOW, openTestDatabase } from "./testing.js";

function agentRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-brain-archives-effect-"));
}

describe("deleteConversationEffect", () => {
  it.effect("succeeds with the archive record for a conversation that stands", () =>
    Effect.gen(function* () {
      const database = openTestDatabase();
      const root = agentRoot();

      const outcome = yield* deleteConversationEffect(database, root, MAIN_SESSION_KEY, NOW);

      assert.equal(outcome.archive.sessionKey, MAIN_SESSION_KEY);
      assert.equal(outcome.published, true);
    }),
  );

  it.effect("fails with CONVERSATION_NOT_FOUND for a session key with no conversation", () =>
    Effect.gen(function* () {
      const database = openTestDatabase();
      const root = agentRoot();

      const refusal = yield* Effect.flip(
        deleteConversationEffect(database, root, sessionKey("no-such-conversation"), NOW),
      );

      assert.ok(refusal instanceof ArchiveOperationRefused);
      assert.equal(refusal.code, ARCHIVE_REFUSAL.CONVERSATION_NOT_FOUND);
    }),
  );
});

describe("removeArchiveEffect", () => {
  it.effect("fails with ARCHIVE_NOT_FOUND for an id no registry row names", () =>
    Effect.gen(function* () {
      const database = openTestDatabase();
      const root = agentRoot();

      const refusal = yield* Effect.flip(removeArchiveEffect(database, root, "no-such-archive"));

      assert.ok(refusal instanceof ArchiveOperationRefused);
      assert.equal(refusal.code, ARCHIVE_REFUSAL.ARCHIVE_NOT_FOUND);
    }),
  );

  it.effect("succeeds removing a registered archive's file and row", () =>
    Effect.gen(function* () {
      const database = openTestDatabase();
      const root = agentRoot();
      const outcome = yield* deleteConversationEffect(database, root, MAIN_SESSION_KEY, NOW);

      yield* removeArchiveEffect(database, root, outcome.archive.archiveId);

      assert.deepEqual(listArchives(database), []);
    }),
  );
});

describe("publishPendingArchivesEffect", () => {
  it.effect("answers no unpublished ids once every archive has published", () =>
    Effect.gen(function* () {
      const database = openTestDatabase();
      const root = agentRoot();
      yield* deleteConversationEffect(database, root, MAIN_SESSION_KEY, NOW);

      const unpublished = yield* publishPendingArchivesEffect(database, root);

      assert.deepEqual(unpublished, []);
    }),
  );
});
