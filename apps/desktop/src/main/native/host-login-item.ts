import path from "node:path";
import { Duration, Effect, Option, Result, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { app } from "electron";
import { nativeHelperPath } from "./native-helper";

/**
 * host-login-item.ts -- This Mac's `luke-host` login item as the main process asks it: registered, unregistered, or where it stands, through the app's own `luke-host` command (`native/macos/HostLoginItem.swift`), which acts on it through `SMAppService`.
 *
 * The login item is a launchd job in the app's
 * `Contents/Library/LaunchAgents`, which runs Luke's host daemon as the
 * member at login, whether or not the app is open, on the app's own state
 * folder (`@luke/host/daemon`'s `DARWIN_HOST`). Nothing registers it on its
 * own yet: a launch with `LUKE_HOST_LOGIN_ITEM` set asks it once
 * (`HOST_LOGIN_ITEM_VARIABLE`), so it can be tried by hand. Only a packaged
 * app carries the job; a development run's command answers that it could
 * not.
 */

/** What the main process may ask of the login item. */
export const HOST_LOGIN_ITEM_ACT = {
  REGISTER: "register",
  UNREGISTER: "unregister",
  STATUS: "status",
} as const;

export type HostLoginItemAct = (typeof HOST_LOGIN_ITEM_ACT)[keyof typeof HOST_LOGIN_ITEM_ACT];

/** Where the login item stands, as the command prints it (`SMAppService.Status`). */
export const HOST_LOGIN_ITEM_STATUS = {
  ENABLED: "enabled",
  NOT_REGISTERED: "not-registered",
  /** Registered, and waiting on the member in System Settings › General › Login Items. */
  REQUIRES_APPROVAL: "requires-approval",
  /** The app carries no such job. */
  NOT_FOUND: "not-found",
} as const;

export type HostLoginItemStatus =
  (typeof HOST_LOGIN_ITEM_STATUS)[keyof typeof HOST_LOGIN_ITEM_STATUS];

/** The launch variable that asks the login item an act once, as the app starts: `register`, `unregister`, or `status`. */
export const HOST_LOGIN_ITEM_VARIABLE = "LUKE_HOST_LOGIN_ITEM";

const COMMAND = "luke-host";

/** How long the command may take; `SMAppService` answers at once. */
const ACT_WITHIN = Duration.seconds(30);

/** The app's `luke-host`: beside its own executable in `Contents/MacOS` when packaged, where the native build put it otherwise. */
function commandPath(): string {
  return app.isPackaged
    ? path.join(path.dirname(process.execPath), COMMAND)
    : nativeHelperPath(COMMAND);
}

/** The act given, as the command takes it, read off what a launch was given; none for anything else. */
export function hostLoginItemActOf(value: string | undefined): HostLoginItemAct | undefined {
  return Object.values(HOST_LOGIN_ITEM_ACT).find((act) => act === value);
}

/** The login item asked the act given: where it then stands, or the words the command failed with. */
export const hostLoginItem = (act: HostLoginItemAct) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(commandPath(), [act], { stdin: "ignore" });
      const [printed, said] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" },
      );
      const code = Number(yield* handle.exitCode);
      const status = Object.values(HOST_LOGIN_ITEM_STATUS).find((each) => each === printed.trim());
      return code === 0 && status !== undefined
        ? Result.succeed<HostLoginItemStatus>(status)
        : Result.fail(said.trim() || `${COMMAND} ${act} exited ${code}`);
    }),
  ).pipe(
    Effect.timeoutOption(ACT_WITHIN),
    Effect.map(
      Option.getOrElse(() =>
        Result.fail<string>(`${COMMAND} ${act} did not answer in ${Duration.format(ACT_WITHIN)}`),
      ),
    ),
    Effect.catch((failure) => Effect.succeed(Result.fail(`${COMMAND} ${act}: ${String(failure)}`))),
  );
