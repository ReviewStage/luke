/**
 * The vitest-driven `temporaryDirectory` re-exported below answers a
 * `TestContext`; a caller building its test on `it.effect` has no such
 * context and needs the same guarantee — a directory this test alone holds,
 * gone when its scope closes — stated as an `Effect`. `FileSystem`'s own
 * `makeTempDirectoryScoped` already is that guarantee, an `acquireRelease`
 * pairing `mkdtemp` with a recursive `remove`; this is a thin wrapper naming
 * this repository's own default prefix, the same one the vitest helper uses.
 */

import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import { Effect, type Scope } from "effect";

export const temporaryDirectoryScoped = (
  prefix = "luke-",
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix }));
