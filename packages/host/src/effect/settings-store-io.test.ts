import assert from "node:assert/strict";
import path from "node:path";
import * as FileSystem from "@effect/platform/FileSystem";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { CREDENTIAL_PROVIDER_LIST } from "@sidecar/credentials";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import { Effect, Either } from "effect";
import {
  parsePersistedSettingsEither,
  readSettingsFileText,
  SettingsParseRefusal,
  writeSettingsFileAtomic,
} from "./settings-store-io.js";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
const SETTINGS_FILE_MODE = 0o600;

const withDirectory = <A, E>(
  run: (directory: string) => Effect.Effect<A, E, FileSystem.FileSystem>,
): Promise<A> =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped();
    return yield* run(directory);
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer), Effect.runPromise);

describe("readSettingsFileText", () => {
  it("answers nothing for a directory with no settings file yet", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        const text = yield* readSettingsFileText(directory);
        assert.equal(text, undefined);
      }),
    ));

  it("answers the file's own bytes once one has been written", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        yield* writeSettingsFileAtomic(directory, '{"version":2}\n');
        const text = yield* readSettingsFileText(directory);
        assert.equal(text, '{"version":2}\n');
      }),
    ));
});

describe("writeSettingsFileAtomic", () => {
  it("leaves only the settings file behind, at the owner-only mode, holding the latest write", () =>
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
    ));

  it("restates the mode of a temporary file an earlier write left at rest", () =>
    withDirectory((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        // Stands in for a write interrupted after the temporary file landed
        // but before its mode or its rename: a leftover file at a mode this
        // build never writes on purpose.
        yield* fileSystem.writeFileString(
          path.join(directory, SETTINGS_TEMPORARY_FILE_NAME),
          "stale",
          { mode: 0o644 },
        );

        yield* writeSettingsFileAtomic(directory, '{"version":2}\n');

        const entries = yield* fileSystem.readDirectory(directory);
        assert.deepEqual([...entries].sort(), [SETTINGS_FILE_NAME]);
        const info = yield* fileSystem.stat(path.join(directory, SETTINGS_FILE_NAME));
        assert.equal(Number(info.mode) & 0o777, SETTINGS_FILE_MODE);
      }),
    ));
});

describe("parsePersistedSettingsEither", () => {
  it("answers the parsed record for a well-formed settings file", () => {
    const parsed = parsePersistedSettingsEither(
      JSON.stringify({ version: 2, apiKeys: {}, showInDock: true }),
      CREDENTIAL_PROVIDER_LIST,
    );
    assert.equal(Either.isRight(parsed), true);
    assert.equal(Either.getOrThrow(parsed).showInDock, true);
  });

  it("refuses a file whose top level is not an object, with the legacy reason", () => {
    const parsed = parsePersistedSettingsEither(
      JSON.stringify([1, 2, 3]),
      CREDENTIAL_PROVIDER_LIST,
    );
    assert.equal(Either.isLeft(parsed), true);
    assert.deepEqual(
      Either.getLeft(parsed),
      Either.getLeft(
        Either.left(new SettingsParseRefusal({ reason: "Settings file is not an object" })),
      ),
    );
  });

  it("refuses text that is not JSON at all", () => {
    const parsed = parsePersistedSettingsEither("{ not json", CREDENTIAL_PROVIDER_LIST);
    assert.equal(Either.isLeft(parsed), true);
    assert.equal(Either.isLeft(parsed) && parsed.left._tag, "SettingsParseRefusal");
  });
});
