import {
  type CliAccount,
  type CliAccountStore,
  CliStoreFailed,
  cliAccountSchema,
} from "@repo/credentials/cli";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { type Context, Effect, type FileSystem, Schema, Stream } from "effect";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import {
  type ConfigEnvironment,
  configFile,
  readConfigFile,
  writeConfigFile,
} from "./config-files.js";

const MAC_PLATFORM = "darwin";

const CREDENTIALS_FILE = "credentials.json";

const KEYCHAIN = {
  COMMAND: "/usr/bin/security",
  SERVICE: `${PRODUCT_NAME} CLI`,
  NOT_FOUND: 44,
} as const;

const credentialsFileSchema = Schema.Struct({
  accounts: Schema.Record(Schema.String, cliAccountSchema),
});

type CredentialsFile = typeof credentialsFileSchema.Type;

const credentialsJson = Schema.fromJsonString(credentialsFileSchema);

const NO_ACCOUNTS: CredentialsFile = { accounts: {} };

const accountJson = Schema.fromJsonString(cliAccountSchema);

interface StoreOf<Requirements> {
  readonly read: Effect.Effect<CliAccount | undefined, CliStoreFailed, Requirements>;
  readonly write: (account: CliAccount) => Effect.Effect<void, CliStoreFailed, Requirements>;
  readonly clear: Effect.Effect<void, CliStoreFailed, Requirements>;
}

function fileStore(file: string, origin: string): StoreOf<FileSystem.FileSystem> {
  const read = readConfigFile(file, credentialsJson, NO_ACCOUNTS);
  return {
    read: Effect.map(read, (contents) => contents.accounts[origin]),
    write: (account) =>
      Effect.flatMap(read, (contents) =>
        writeConfigFile(file, credentialsJson, {
          accounts: { ...contents.accounts, [origin]: account },
        }),
      ),
    clear: Effect.gen(function* () {
      const contents = yield* read;
      if (contents.accounts[origin] === undefined) return;
      const { [origin]: _cleared, ...accounts } = contents.accounts;
      yield* writeConfigFile(file, credentialsJson, { accounts });
    }),
  };
}

const security = (args: readonly string[], input?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(KEYCHAIN.COMMAND, [...args], {
        stdin: input === undefined ? "ignore" : Stream.make(new TextEncoder().encode(input)),
        stdout: "pipe",
        stderr: "ignore",
      });
      const [printed, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode],
        { concurrency: "unbounded" },
      );
      return { code: Number(code), printed };
    }),
  ).pipe(
    Effect.mapError(() => new CliStoreFailed({ message: `Could not run ${KEYCHAIN.COMMAND}.` })),
  );

function itemArguments(origin: string): readonly string[] {
  return ["-s", KEYCHAIN.SERVICE, "-a", origin];
}

function keychainStore(origin: string): StoreOf<ChildProcessSpawner.ChildProcessSpawner> {
  const read = Effect.gen(function* () {
    const { code, printed } = yield* security([
      "find-generic-password",
      ...itemArguments(origin),
      "-w",
    ]);
    if (code === KEYCHAIN.NOT_FOUND) return undefined;
    if (code !== 0) {
      return yield* new CliStoreFailed({ message: `The Keychain could not be read (${code}).` });
    }
    return yield* Effect.mapError(
      Schema.decodeUnknownEffect(accountJson)(printed.trim()),
      () =>
        new CliStoreFailed({ message: "The Keychain holds a sign-in this version cannot read." }),
    );
  });
  return {
    read,
    write: (account) =>
      Effect.gen(function* () {
        const text = yield* Effect.orDie(Schema.encodeEffect(accountJson)(account));
        const hex = Buffer.from(text, "utf8").toString("hex");
        yield* security(
          ["-i"],
          `add-generic-password -U -s "${KEYCHAIN.SERVICE}" -a "${origin}" -X ${hex}\n`,
        );
        const stored = yield* read;
        if (stored?.refreshToken !== account.refreshToken) {
          return yield* new CliStoreFailed({ message: "The Keychain did not keep the sign-in." });
        }
      }),
    clear: Effect.gen(function* () {
      const { code } = yield* security(["delete-generic-password", ...itemArguments(origin)]);
      if (code !== 0 && code !== KEYCHAIN.NOT_FOUND) {
        yield* new CliStoreFailed({ message: `The Keychain could not be cleared (${code}).` });
      }
    }),
  };
}

function provided<Requirements>(
  store: StoreOf<Requirements>,
  services: Context.Context<Requirements>,
): CliAccountStore {
  return {
    read: Effect.provideContext(store.read, services),
    write: (account) => Effect.provideContext(store.write(account), services),
    clear: Effect.provideContext(store.clear, services),
  };
}

export const accountStore = Effect.fnUntraced(function* (
  origin: string,
  machine: {
    readonly platform: NodeJS.Platform;
    readonly environment: ConfigEnvironment;
  },
) {
  const services = yield* Effect.context<
    FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  >();
  return machine.platform === MAC_PLATFORM
    ? provided(keychainStore(origin), services)
    : provided(fileStore(configFile(machine.environment, CREDENTIALS_FILE), origin), services);
});
