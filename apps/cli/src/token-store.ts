/**
 * token-store.ts -- where `vespin` keeps its sign-in: the macOS Keychain, or a file only its owner can read.
 *
 * One account per service origin, so a sign-in against a Preview or a local
 * service stands beside production's rather than over it. On a Mac the
 * account is one generic password in the login Keychain, read and written
 * through `/usr/bin/security`, so no native module rides in the bundle.
 * Elsewhere it is `credentials.json` under `$XDG_CONFIG_HOME/vespin` (or
 * `~/.config/vespin`), written whole to a file of mode 0600 in a folder of
 * mode 0700 and renamed into place, so no reader ever sees half of it and
 * no other account on the machine can read it.
 *
 * Note that the Keychain's password is handed to `security` on its stdin
 * (`security -i`), never as an argument, since another process may read a
 * command line.
 */

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

/** The platform whose machines keep the sign-in in the Keychain. */
const MAC_PLATFORM = "darwin";

/** The file the file store keeps its accounts in, in the config folder. */
const CREDENTIALS_FILE = "credentials.json";

/** The Keychain item's service, which Keychain Access lists it under; its account is the service origin. */
const KEYCHAIN = {
  COMMAND: "/usr/bin/security",
  SERVICE: `${PRODUCT_NAME} CLI`,
  /** What `security` exits with where the item does not exist. */
  NOT_FOUND: 44,
} as const;

/** The file store's whole contents: an account for each service origin signed in to. */
const credentialsFileSchema = Schema.Struct({
  accounts: Schema.Record(Schema.String, cliAccountSchema),
});

type CredentialsFile = typeof credentialsFileSchema.Type;

const credentialsJson = Schema.fromJsonString(credentialsFileSchema);

const NO_ACCOUNTS: CredentialsFile = { accounts: {} };

const accountJson = Schema.fromJsonString(cliAccountSchema);

/** The store's three effects, before the services they run on are handed over. */
interface StoreOf<Requirements> {
  readonly read: Effect.Effect<CliAccount | undefined, CliStoreFailed, Requirements>;
  readonly write: (account: CliAccount) => Effect.Effect<void, CliStoreFailed, Requirements>;
  readonly clear: Effect.Effect<void, CliStoreFailed, Requirements>;
}

/** The file store for one service origin, in the credentials file named. */
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

/** One run of `security`: its exit code and what it printed, with `input` on its stdin where there is some. */
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

/** The item's two names as `security find-…`/`delete-…` take them. */
function itemArguments(origin: string): readonly string[] {
  return ["-s", KEYCHAIN.SERVICE, "-a", origin];
}

/** The Keychain store for one service origin: one generic password holding the account's JSON. */
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
        // Note that `security -i` reads one command a line, its quoted words whole, so the service's space stands.
        yield* security(
          ["-i"],
          `add-generic-password -U -s "${KEYCHAIN.SERVICE}" -a "${origin}" -X ${hex}\n`,
        );
        // Note that `security -i` exits as it does whatever a command it read answered, so the write is read back.
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

/** A store's effects run on the services handed over, as a credential reads them. */
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

/**
 * The store for one service origin on this machine: the Keychain on a Mac,
 * the credentials file the environment names elsewhere.
 */
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
