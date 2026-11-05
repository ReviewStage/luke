/**
 * config-files.ts -- the files `vespin` keeps under `$XDG_CONFIG_HOME/vespin` (or `~/.config/vespin`): read through their schema, and written whole, readable by their owner alone.
 *
 * A file is written to a staged copy of mode 0600 in a folder of mode 0700
 * and renamed into place, so no reader ever sees half of it and no other
 * account on the machine reads it. A file that does not read through its
 * schema is refused rather than overwritten, since it may be a newer
 * version's.
 */

import os from "node:os";
import path from "node:path";
import { CliStoreFailed } from "@repo/credentials/cli";
import { Effect, FileSystem, Schema } from "effect";

/** The folder the files stand in under the config folder, and the modes the folder and each file are held to. */
const CONFIG_FOLDER = {
  NAME: "vespin",
  FOLDER_MODE: 0o700,
  FILE_MODE: 0o600,
} as const;

/** What a config file's place is read from. */
export interface ConfigEnvironment {
  readonly XDG_CONFIG_HOME?: string | undefined;
  readonly HOME?: string | undefined;
}

/** A file of the folder, under the XDG config folder the environment names. */
export function configFile(environment: ConfigEnvironment, name: string): string {
  const config =
    environment.XDG_CONFIG_HOME || path.join(environment.HOME || os.homedir(), ".config");
  return path.join(config, CONFIG_FOLDER.NAME, name);
}

/** A file's contents read through its schema, or `empty` where there is no file yet. */
export const readConfigFile = Effect.fnUntraced(function* <Contents>(
  file: string,
  schema: Schema.Codec<Contents, string>,
  empty: Contents,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const exists = yield* Effect.orElseSucceed(fileSystem.exists(file), () => false);
  if (!exists) return empty;
  const text = yield* Effect.mapError(
    fileSystem.readFileString(file),
    () => new CliStoreFailed({ message: `Could not read ${file}.` }),
  );
  return yield* Effect.mapError(
    Schema.decodeUnknownEffect(schema)(text),
    () => new CliStoreFailed({ message: `${file} is not a file this version can read.` }),
  );
});

/** A file's contents written whole: a staged copy of the owner's alone, renamed over the old. */
export const writeConfigFile = Effect.fnUntraced(function* <Contents>(
  file: string,
  schema: Schema.Codec<Contents, string>,
  contents: Contents,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const failed = () => new CliStoreFailed({ message: `Could not write ${file}.` });
  yield* Effect.mapError(
    fileSystem.makeDirectory(path.dirname(file), {
      recursive: true,
      mode: CONFIG_FOLDER.FOLDER_MODE,
    }),
    failed,
  );
  const staged = `${file}.${process.pid}`;
  const text = yield* Effect.mapError(Schema.encodeEffect(schema)(contents), failed);
  yield* Effect.mapError(
    fileSystem.writeFileString(staged, text, { mode: CONFIG_FOLDER.FILE_MODE }),
    failed,
  );
  // Note that the mode a file is created with is narrowed by the umask but never widened past it, so it is set again outright.
  yield* Effect.mapError(fileSystem.chmod(staged, CONFIG_FOLDER.FILE_MODE), failed);
  yield* Effect.mapError(fileSystem.rename(staged, file), failed);
});
