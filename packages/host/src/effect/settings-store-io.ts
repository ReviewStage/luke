/**
 * The settings store's bytes on disk, stated as an `Effect` over `effect`'s
 * `FileSystem` and `Path`. `readSettingsFileText` and `writeSettingsFileAtomic`
 * never construct a layer themselves — a caller with a runtime edge hands the
 * services in — and neither reads the bytes as settings: the record's shape
 * is `PersistedSettingsSchema` in `../settings-store.ts`, beside the store
 * that keeps it, so this module imports nothing of the store's.
 */
import { Effect, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { PlatformError } from "effect/PlatformError";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
/** Owner read/write only: a settings file carries a decryption key's ciphertext. */
const SETTINGS_FILE_MODE = 0o600;

function isIgnorableReadFailure(error: PlatformError): boolean {
  // v4 wraps the reason rather than tagging the error itself, and normalizes
  // only some of the host's codes onto its own tags — `EPERM` lands on
  // `Unknown` — so the errno the platform keeps on the reason's own cause is
  // still what names these four. A rejected argument is none of them.
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

/**
 * The settings file's raw text, or nothing where it has never been written or
 * cannot be reached at all — the same set of failures the promise-facing
 * store already treated as "no file yet" rather than an I/O error worth
 * surfacing.
 */
export const readSettingsFileText = /* @__PURE__ */ Effect.fn("host/readSettingsFileText")(
  function* (
    directory: string,
  ): Effect.fn.Return<string | undefined, PlatformError, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fileSystem
      .readFileString(path.join(directory, SETTINGS_FILE_NAME))
      .pipe(Effect.catchIf(isIgnorableReadFailure, () => Effect.succeed(undefined)));
  },
);

/**
 * Writes the settings file atomically: the new contents land in a temporary
 * file first, and only a successful `rename` ever makes them the settings
 * file a concurrent reader can see. `mode` is passed to the temporary file's
 * creation and restated with `chmod` right after, because `mode` only takes
 * effect when the file is created — a temporary file left behind by an
 * earlier interrupted write would otherwise keep whatever mode it already had.
 */
export const writeSettingsFileAtomic = /* @__PURE__ */ Effect.fn("host/writeSettingsFileAtomic")(
  function* (
    directory: string,
    contents: string,
  ): Effect.fn.Return<void, PlatformError, FileSystem.FileSystem | Path.Path> {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const settingsPath = path.join(directory, SETTINGS_FILE_NAME);
    const temporaryPath = path.join(directory, SETTINGS_TEMPORARY_FILE_NAME);
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(temporaryPath, contents, { mode: SETTINGS_FILE_MODE });
    yield* fileSystem.chmod(temporaryPath, SETTINGS_FILE_MODE);
    yield* fileSystem.rename(temporaryPath, settingsPath);
  },
);
