import { Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";

const SETTINGS_FILE_NAME = "settings.json";
function temporaryFileName(fileName: string, writer: string | undefined): string {
  return writer === undefined ? `${fileName}.tmp` : `${fileName}.${writer}.tmp`;
}
const SETTINGS_FILE_MODE = 0o600;

function isIgnorableReadFailure(error: PlatformError): boolean {
  const reason = error.reason;
  if (reason._tag === "BadArgument") return false;
  const cause = reason.cause;
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause.code === "ENOENT" ||
      cause.code === "ENOTDIR" ||
      cause.code === "EACCES" ||
      cause.code === "EPERM")
  );
}

export const readSettingsFileText = Effect.fn("host/readSettingsFileText")(function* (
  directory: string,
  fileName: string = SETTINGS_FILE_NAME,
): Effect.fn.Return<string | undefined, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem
    .readFileString(path.join(directory, fileName))
    .pipe(Effect.catchIf(isIgnorableReadFailure, () => Effect.succeed(undefined)));
});

export const writeSettingsFileAtomic = Effect.fn("host/writeSettingsFileAtomic")(function* (
  directory: string,
  contents: string,
  writer?: string,
  fileName: string = SETTINGS_FILE_NAME,
): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settingsPath = path.join(directory, fileName);
  const temporaryPath = path.join(directory, temporaryFileName(fileName, writer));
  yield* fileSystem.makeDirectory(directory, { recursive: true });
  yield* Effect.gen(function* () {
    yield* fileSystem.writeFileString(temporaryPath, contents, { mode: SETTINGS_FILE_MODE });
    yield* fileSystem.chmod(temporaryPath, SETTINGS_FILE_MODE);
    yield* fileSystem.rename(temporaryPath, settingsPath);
  }).pipe(Effect.onError(() => Effect.ignore(fileSystem.remove(temporaryPath, { force: true }))));
});
