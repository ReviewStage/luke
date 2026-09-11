import assert from "node:assert/strict";
import fs from "node:fs";
import { NodeFileSystem } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { Effect, Exit, Scope } from "effect";
import { temporaryDirectoryScoped } from "./temporary-directory.effect.js";

describe("temporaryDirectoryScoped", () => {
  it.effect("exists while its scope stands and is gone once it closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const directory = yield* Effect.provideService(
        temporaryDirectoryScoped(),
        Scope.Scope,
        scope,
      );

      assert.equal(fs.existsSync(directory), true);

      yield* Scope.close(scope, Exit.void);

      assert.equal(fs.existsSync(directory), false);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect("names the directory with this repository's default prefix", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const directory = yield* Effect.provideService(
        temporaryDirectoryScoped(),
        Scope.Scope,
        scope,
      );

      assert.match(directory.split("/").at(-1) ?? "", /^luke-/);

      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
