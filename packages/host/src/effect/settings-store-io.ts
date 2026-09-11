/**
 * The settings store's body: the bytes on disk and the shape parsed out of
 * them, stated as an `Effect` over `@effect/platform`'s `FileSystem` and as an
 * `Either` rather than a throw. `readSettingsFileText` and
 * `writeSettingsFileAtomic` never construct a `FileSystem` layer themselves —
 * a caller with a runtime edge hands one in, the way the host's own
 * composition eventually will — and `parsePersistedSettingsEither` answers the
 * legacy parse failure ("Settings file is not an object") as a
 * `SettingsParseRefusal` instead of a thrown `Error`, keeping the same reason
 * text a caller already discards into `defaultPersistedSettings()`.
 */
import path from "node:path";
import type { PlatformError } from "@effect/platform/Error";
import * as FileSystem from "@effect/platform/FileSystem";
import type { CredentialProvider } from "@sidecar/credentials";
import { Data, Effect, Either } from "effect";
import { type PersistedSettings, parsePersistedSettingsThrowing } from "../settings-store.js";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
/** Owner read/write only: a settings file carries a decryption key's ciphertext. */
const SETTINGS_FILE_MODE = 0o600;

/** A stored file this build cannot read as settings; `reason` is the legacy message. */
export class SettingsParseRefusal extends Data.TaggedError("SettingsParseRefusal")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

/**
 * The settings file's shape, parsed once. A malformed file answers a refusal
 * rather than throwing; every caller today still folds that refusal into
 * `defaultPersistedSettings()`, exactly as the throwing form's catch already
 * did, so the fallback is a caller's decision and not this function's.
 */
export function parsePersistedSettingsEither(
  source: string,
  providers: readonly CredentialProvider[],
): Either.Either<PersistedSettings, SettingsParseRefusal> {
  return Either.try({
    try: () => parsePersistedSettingsThrowing(source, providers),
    catch: (error) =>
      new SettingsParseRefusal({
        reason: error instanceof Error ? error.message : "Settings file is not an object",
      }),
  });
}

function isIgnorableReadFailure(error: PlatformError): boolean {
  if (error._tag !== "SystemError") return false;
  const cause = error.cause;
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
export const readSettingsFileText = (
  directory: string,
): Effect.Effect<string | undefined, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem
      .readFileString(path.join(directory, SETTINGS_FILE_NAME))
      .pipe(Effect.catchIf(isIgnorableReadFailure, () => Effect.succeed(undefined)));
  });

/**
 * Writes the settings file atomically: the new contents land in a temporary
 * file first, and only a successful `rename` ever makes them the settings
 * file a concurrent reader can see. `mode` is passed to the temporary file's
 * creation and restated with `chmod` right after, because `mode` only takes
 * effect when the file is created — a temporary file left behind by an
 * earlier interrupted write would otherwise keep whatever mode it already had.
 */
export const writeSettingsFileAtomic = (
  directory: string,
  contents: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const settingsPath = path.join(directory, SETTINGS_FILE_NAME);
    const temporaryPath = path.join(directory, SETTINGS_TEMPORARY_FILE_NAME);
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* fileSystem.writeFileString(temporaryPath, contents, { mode: SETTINGS_FILE_MODE });
    yield* fileSystem.chmod(temporaryPath, SETTINGS_FILE_MODE);
    yield* fileSystem.rename(temporaryPath, settingsPath);
  });
