import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  readBootstrapFilesEffect,
  readWorkspaceFileEffect,
  recentDailyNotesEffect,
  seedWorkspaceEffect,
  writeWorkspaceFileEffect,
} from "./workspace.effect.js";
import {
  BOOTSTRAP_BOUNDS,
  dailyNoteName,
  WORKSPACE_FILE,
  WORKSPACE_FILE_REFUSAL,
  type WorkspaceFile,
  type WorkspaceSeeds,
} from "./workspace.js";

const testSeed = (name: WorkspaceFile) => `# ${name}\n\nseeded for the test\n`;
const TEST_SEEDS: WorkspaceSeeds = {
  [WORKSPACE_FILE.AGENTS]: testSeed(WORKSPACE_FILE.AGENTS),
  [WORKSPACE_FILE.IDENTITY]: testSeed(WORKSPACE_FILE.IDENTITY),
  [WORKSPACE_FILE.USER]: testSeed(WORKSPACE_FILE.USER),
  [WORKSPACE_FILE.MEMORY]: testSeed(WORKSPACE_FILE.MEMORY),
  [WORKSPACE_FILE.BOOTSTRAP]: testSeed(WORKSPACE_FILE.BOOTSTRAP),
};

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "luke-workspace-effect-"));
}

describe("seedWorkspaceEffect", () => {
  it.effect("seeds every missing file once", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);
      const first = yield* seedWorkspaceEffect(directory, TEST_SEEDS);
      assert.deepEqual([...first.seeded].sort(), Object.values(WORKSPACE_FILE).sort());

      const second = yield* seedWorkspaceEffect(directory, TEST_SEEDS);
      assert.deepEqual(second.seeded, []);
    }),
  );

  it.effect("fails with WorkspaceIOError when the directory cannot be created", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);
      const blocked = path.join(directory, "blocked");
      yield* Effect.promise(() => fs.writeFile(blocked, "not a directory"));

      const error = yield* Effect.flip(
        seedWorkspaceEffect(path.join(blocked, "nested"), TEST_SEEDS),
      );

      assert.equal(error._tag, "WorkspaceIOError");
      assert.equal(error.code, "seed");
    }),
  );
});

describe("readBootstrapFilesEffect and recentDailyNotesEffect", () => {
  it.effect("reads and bounds the seeded bootstrap files", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);
      yield* seedWorkspaceEffect(directory, TEST_SEEDS);

      const files = yield* readBootstrapFilesEffect(directory, [WORKSPACE_FILE.AGENTS]);

      assert.equal(files.length, 1);
      assert.equal(files[0]?.content, TEST_SEEDS[WORKSPACE_FILE.AGENTS]);
      assert.equal(files[0]?.missing, false);
    }),
  );

  it.effect("reads a daily note written under the day's name", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);
      yield* seedWorkspaceEffect(directory, TEST_SEEDS);
      const now = Date.UTC(2026, 8, 8, 12);
      const name = dailyNoteName(now);
      yield* Effect.promise(() =>
        fs.writeFile(path.join(directory, "memory", name), "today's note"),
      );

      const notes = yield* recentDailyNotesEffect(directory, now);

      assert.deepEqual(
        notes.map((note) => note.name),
        [name],
      );
    }),
  );
});

describe("readWorkspaceFileEffect", () => {
  it.effect("answers a seeded file's content", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);
      yield* seedWorkspaceEffect(directory, TEST_SEEDS);

      const content = yield* readWorkspaceFileEffect(directory, WORKSPACE_FILE.AGENTS);

      assert.equal(content, TEST_SEEDS[WORKSPACE_FILE.AGENTS]);
    }),
  );

  it.effect("refuses a name that escapes the workspace", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);

      const error = yield* Effect.flip(readWorkspaceFileEffect(directory, "../outside.md"));

      assert.equal(error._tag, "WorkspaceFileRefused");
      assert.equal(error.code, WORKSPACE_FILE_REFUSAL.OUTSIDE_WORKSPACE);
    }),
  );

  it.effect("refuses a workspace file that does not exist", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);

      const error = yield* Effect.flip(readWorkspaceFileEffect(directory, WORKSPACE_FILE.AGENTS));

      assert.equal(error.code, WORKSPACE_FILE_REFUSAL.NOT_FOUND);
    }),
  );
});

describe("writeWorkspaceFileEffect", () => {
  it.effect("writes a workspace file and answers its length", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);

      const chars = yield* writeWorkspaceFileEffect(directory, WORKSPACE_FILE.MEMORY, "hello");

      assert.equal(chars, 5);
      const content = yield* readWorkspaceFileEffect(directory, WORKSPACE_FILE.MEMORY);
      assert.equal(content, "hello");
    }),
  );

  it.effect("refuses content past the per-file bound", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(temporaryDirectory);
      const oversized = "x".repeat(BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE + 1);

      const error = yield* Effect.flip(
        writeWorkspaceFileEffect(directory, WORKSPACE_FILE.MEMORY, oversized),
      );

      assert.equal(error.code, WORKSPACE_FILE_REFUSAL.TOO_LARGE);
    }),
  );
});
