import os from "node:os";
import path from "node:path";
import { CliStoreFailed } from "@repo/credentials/cli";
import { Effect, FileSystem, Schema } from "effect";

const CONFIG_FOLDER = {
  NAME: "vespin",
  FOLDER_MODE: 0o700,
  FILE_MODE: 0o600,
} as const;

export interface ConfigEnvironment {
  readonly XDG_CONFIG_HOME?: string | undefined;
  readonly HOME?: string | undefined;
}

export function configFile(environment: ConfigEnvironment, name: string): string {
  const config =
    environment.XDG_CONFIG_HOME || path.join(environment.HOME || os.homedir(), ".config");
  return path.join(config, CONFIG_FOLDER.NAME, name);
}

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
  yield* Effect.mapError(fileSystem.chmod(staged, CONFIG_FOLDER.FILE_MODE), failed);
  yield* Effect.mapError(fileSystem.rename(staged, file), failed);
});
