import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { readWorkspaceFileEffect, writeWorkspaceFileEffect } from "./workspace-files.effect.js";

function workspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "luke-brain-workspace-files-effect-"));
}

describe("readWorkspaceFileEffect", () => {
  it.effect("answers the fallback for a file not yet written", () =>
    Effect.gen(function* () {
      const root = workspaceRoot();

      const content = yield* readWorkspaceFileEffect(root, "USER.md", "seed");

      assert.equal(content, "seed");
    }),
  );

  it.effect("round-trips whatever writeWorkspaceFileEffect wrote", () =>
    Effect.gen(function* () {
      const root = workspaceRoot();

      yield* writeWorkspaceFileEffect(root, "USER.md", "the developer's own words");
      const content = yield* readWorkspaceFileEffect(root, "USER.md");

      assert.equal(content, "the developer's own words");
    }),
  );
});
