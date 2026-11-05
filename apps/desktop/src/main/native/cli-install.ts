import os from "node:os";
import path from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { CLI_INSTALL_MODE } from "@repo/features/cli-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { CLI_INSTALL_OUTCOME, type CliInstallAnswer } from "@repo/host/contract";
import { Duration, Effect, Layer, Option, Result, Schema } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { printed } from "./this-mac-host";

/**
 * cli-install.ts -- the `vespin` command installed into this Mac's account, as Settings' MCP page's Install command-line tool asks: the service's install script run in its `cli` mode, the way This Mac's host runs it for the host.
 *
 * The script is the service's own, at the origin the app signs in to, never
 * one a window names, and runs with `/bin/sh` through This Mac's host's own
 * runner (`./this-mac-host.ts`), so both installs run their script the same
 * way. It links the command at `~/.local/bin/vespin` (`apps/web/install/install.sh`).
 * The version answered is what the installed command then says it is. Whether
 * a shell finds it is read off the login shell's own PATH, read interactively
 * so the profile that adds `~/.local/bin`, `~/.zshrc` among them, is read,
 * because the app's own PATH, as launchd starts an app, holds none of what a
 * profile adds.
 */

/** The command's link and the folder it stands in, under the home, as the install script names them. */
const LINK_FOLDER = [".local", "bin"] as const;
const LINK_NAME = "vespin";

/** The shell a Mac's account logs in with where `SHELL` names none. */
const DEFAULT_SHELL = "/bin/zsh";

/** How long the script, which downloads a release, may take; its own download, the command, and the shell, less. */
const ANSWER_WITHIN = {
  INSTALL: Duration.minutes(10),
  COMMAND: Duration.seconds(30),
} as const;

/** The mark the install script prints before the words it fails with (`fail` in the install script). */
const CROSS = /^✗\s*/u;

/** What `vespin version --json` prints. */
const decodeVersion = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

const failed = (reason: string): CliInstallAnswer => ({
  outcome: CLI_INSTALL_OUTCOME.FAILED,
  reason,
});

/** The words a script failed with, as a person reads them: its last line, without its mark. */
function lastWords(words: string): string {
  const lines = words
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (lines.at(-1) ?? words).replace(CROSS, "");
}

/** Whether a PATH, as the shell printed it after anything its profile printed, holds the folder. */
function holds(printedPath: string, folder: string): boolean {
  const pathLine = printedPath.split("\n").at(-1) ?? "";
  return pathLine.split(":").some((entry) => path.resolve(entry) === folder);
}

const layers = Layer.mergeAll(
  Layer.provideMerge(
    NodeChildProcessSpawner.layer,
    Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
  ),
  FetchHttpClient.layer,
);

/** The command installed from the service at `serviceBaseUrl`: its version and whether the login shell finds it, or why it was not installed. */
export function installCli(serviceBaseUrl: string): Effect.Effect<CliInstallAnswer> {
  const folder = path.join(os.homedir(), ...LINK_FOLDER);
  const link = path.join(folder, LINK_NAME);
  const shell = process.env.SHELL ?? DEFAULT_SHELL;
  const scriptUrl = new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, serviceBaseUrl).href;
  return Effect.gen(function* () {
    // Note that a download that stalls is bounded too, so Install never waits on it for good.
    const script = yield* HttpClient.get(scriptUrl).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.text),
      Effect.timeout(ANSWER_WITHIN.COMMAND),
      Effect.option,
    );
    if (Option.isNone(script)) return failed(`Could not download ${scriptUrl}.`);
    const ran = yield* printed(
      "/bin/sh",
      ["-s", CLI_INSTALL_MODE],
      ANSWER_WITHIN.INSTALL,
      script.value,
    );
    if (Result.isFailure(ran)) return failed(lastWords(ran.failure));
    const said = yield* printed(link, ["version", "--json"], ANSWER_WITHIN.COMMAND);
    const version = Result.isSuccess(said) ? decodeVersion(said.success) : Option.none();
    if (Option.isNone(version)) {
      return failed(`${link} was installed but did not say its version.`);
    }
    // Note that the PATH is printed on a line of its own, after anything the profile prints.
    const shellPath = yield* printed(
      shell,
      ["-i", "-l", "-c", 'printf "\\n%s" "$PATH"'],
      ANSWER_WITHIN.COMMAND,
    );
    return {
      outcome: CLI_INSTALL_OUTCOME.INSTALLED,
      version: version.value.version,
      onPath: Result.isSuccess(shellPath) && holds(shellPath.success, folder),
    };
  }).pipe(Effect.provide(layers));
}
