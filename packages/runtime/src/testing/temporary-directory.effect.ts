import { Effect, type Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";

export const temporaryDirectoryScoped = (
  prefix = "luke-",
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Scope.Scope> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectoryScoped({ prefix }));
