import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { runConversationMaintenanceEffect } from "./maintenance-run.effect.js";
import { NOW, openTestDatabase } from "./testing.js";

function agentRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-brain-maintenance-effect-"));
}

describe("runConversationMaintenanceEffect", () => {
  it.effect("answers a report over the conversation directory as it stands", () =>
    Effect.gen(function* () {
      const database = openTestDatabase();
      const root = agentRoot();

      const report = yield* runConversationMaintenanceEffect(database, root, {
        now: NOW,
        preserve: [],
      });

      assert.equal(report.before, 1);
      assert.equal(report.after, 1);
      assert.equal(report.archivedByCap, 0);
    }),
  );
});
