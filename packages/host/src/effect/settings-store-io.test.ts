import assert from "node:assert/strict";
import path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { Effect, Layer, type Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";
import { writeSettingsFileAtomic } from "./settings-store-io.js";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_FILE_MODE = 0o600;

const withDirectory = <A, E>(
  run: (directory: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Effect.Effect<A, E | PlatformError> =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped();
    return yield* run(directory);
  }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

describe("writeSettingsFileAtomic", () => {
  it.effect(
    "leaves only the settings file behind, at the owner-only mode, holding the latest write",
    () =>
      withDirectory((directory) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          yield* writeSettingsFileAtomic(directory, '{"version":2}\n');
          yield* writeSettingsFileAtomic(directory, '{"version":3}\n');

          const entries = yield* fileSystem.readDirectory(directory);
          assert.deepEqual([...entries].sort(), [SETTINGS_FILE_NAME]);
          assert.equal(
            yield* fileSystem.readFileString(path.join(directory, SETTINGS_FILE_NAME)),
            '{"version":3}\n',
          );

          const info = yield* fileSystem.stat(path.join(directory, SETTINGS_FILE_NAME));
          assert.equal(Number(info.mode) & 0o777, SETTINGS_FILE_MODE);
        }),
      ),
  );

  it.effect("two writers' overlapping writes both land, leaving only the settings file", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const writes = Array.from({ length: 8 }, (_, index) =>
          writeSettingsFileAtomic(directory, `{"version":${index}}\n`, `tab-${index}`),
        );
        yield* Effect.all(writes, { concurrency: "unbounded" });

        const entries = yield* fileSystem.readDirectory(directory);
        assert.deepEqual([...entries].sort(), [SETTINGS_FILE_NAME]);
      }),
    ),
  );
});

describe("a write that cannot land", () => {
  it.effect("leaves no temporary file behind when its rename fails", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        // A folder that holds a file where the settings file goes: no rename can replace it.
        yield* fileSystem.makeDirectory(path.join(directory, SETTINGS_FILE_NAME, "held"), {
          recursive: true,
        });

        const failed = yield* Effect.flip(
          writeSettingsFileAtomic(directory, '{"version":3}\n', "tab-1"),
        );

        assert.equal(failed._tag, "PlatformError");
        const entries = yield* fileSystem.readDirectory(directory);
        assert.deepEqual([...entries].sort(), [SETTINGS_FILE_NAME]);
      }),
    ),
  );
});
