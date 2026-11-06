import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { MIRROR_FILE_MODE } from "@repo/features/sandbox-mirror-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Layer, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import { mirrorMatched, mirrorWritten } from "./mirror-disk.js";

const encoder = new TextEncoder();

const disk = Layer.merge(NodeFileSystem.layer, NodePath.layer);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("mirror-disk", () => {
  it.effect("writes a file inside the mirror and refuses every path that leaves it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const folder = yield* temporaryDirectoryScoped("mirror-escape-");
      const root = path.join(folder, "repository");
      const outside = path.join(folder, "outside");
      yield* fileSystem.makeDirectory(root);
      yield* fileSystem.makeDirectory(outside);
      yield* fileSystem.symlink(outside, path.join(root, "out"));
      const bytes = encoder.encode("hello");
      const mode = MIRROR_FILE_MODE.EXECUTABLE;

      for (const refused of [
        path.join(outside, "x"),
        "../outside/x",
        "a/../../x",
        ".git/config",
        "out/x",
      ]) {
        assert.equal(yield* mirrorWritten(root, { path: refused, mode, bytes }), false, refused);
      }
      yield* fileSystem.makeDirectory(path.join(root, "bin"));
      yield* fileSystem.symlink(path.join(outside, "x"), path.join(root, "bin", "run.mirroring"));
      assert.equal(yield* mirrorWritten(root, { path: "bin/run", mode, bytes }), true);
      assert.deepEqual(yield* fileSystem.readDirectory(outside), []);
      const written = path.join(root, "bin", "run");
      assert.equal(yield* fileSystem.readFileString(written), "hello");
      assert.equal((yield* fileSystem.stat(written)).mode & 0o777, 0o755);
    }).pipe(Effect.provide(disk)),
  );

  it.effect("a match deletes what the manifest lacks and asks for what differs or is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* temporaryDirectoryScoped("mirror-match-");
      const own = {
        "same.txt": "same",
        "changed.txt": "aaaa",
        "longer.txt": "a",
        "extra.txt": "x",
      };
      for (const [file, text] of Object.entries(own)) {
        yield* fileSystem.writeFileString(path.join(root, file), text);
      }
      yield* fileSystem.symlink("same.txt", path.join(root, "link"));

      const requested = yield* mirrorMatched(
        root,
        [...Object.keys(own), "link"],
        [
          { path: "same.txt", size: 4, hash: sha256("same") },
          { path: "changed.txt", size: 4, hash: sha256("bbbb") },
          { path: "longer.txt", size: 3, hash: sha256("abc") },
          { path: "missing.txt", size: 1, hash: sha256("m") },
        ],
      );

      assert.deepEqual(requested, ["changed.txt", "longer.txt", "missing.txt"]);
      assert.deepEqual((yield* fileSystem.readDirectory(root)).sort(), [
        "changed.txt",
        "link",
        "longer.txt",
        "same.txt",
      ]);
    }).pipe(Effect.provide(disk)),
  );
});
