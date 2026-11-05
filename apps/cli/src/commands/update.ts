/**
 * update.ts -- `vespin update`: a curl install moved to the newest release, and any other install told the command its package manager updates it with.
 *
 * A curl install updates itself as it was installed: it fetches the install
 * script from the service it talks to (`--url`, then `VESPIN_URL`, then
 * production) and runs it in its `cli` mode, which checks the release's
 * tarball against the digest the script carries, links `~/.local/bin/vespin`
 * to it, and removes the older releases (`apps/web/install/install.sh`). The
 * script's words go to stderr, so stdout stays the answer alone. Any other
 * install (`../install.ts`) is changed by nothing here: its update command is
 * printed for the person to run.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import { CLI_INSTALL_MODE } from "@repo/features/cli-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, FileSystem, Stdio, Stream } from "effect";
import { Command } from "effect/cli";
import { HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  curlLink,
  curlReleases,
  INSTALL_KIND,
  type InstallKind,
  installKind,
  UPDATE_COMMAND,
} from "../install.js";
import { answer, CommandFailed, note } from "../output.js";
import { serviceOrigin } from "../session.js";
import { VERSION } from "./version.js";

/** The only scheme the install script is fetched over, since what it answers is run as a shell script. */
const SCRIPT_PROTOCOL = "https:";

const encoder = new TextEncoder();

/**
 * The install script, as the service answers it at its own origin. Note that
 * an origin not on https is refused before anything is fetched, because
 * whoever sits on a plain connection could answer any script, which this
 * would run; the install script refuses an `--origin` of that kind alike.
 */
const installScript = Effect.fnUntraced(function* (origin: string) {
  const url = `${origin}${HOST_WIRE.INSTALL_SCRIPT_PATH}`;
  if (new URL(origin).protocol !== SCRIPT_PROTOCOL) {
    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message: `${PRODUCT_NAME} CLI updates only from an https:// service, not ${origin}.`,
    });
  }
  const unreachable = new CommandFailed({
    exit: CLI_EXIT.UNAVAILABLE,
    message: `Could not fetch ${url}.`,
  });
  const response = yield* Effect.mapError(HttpClient.get(url), () => unreachable);
  if (response.status !== 200) return yield* unreachable;
  return yield* Effect.mapError(response.text, () => unreachable);
});

/** The script run in its `cli` mode, its words on stderr, ending as it ended. */
const runInstallScript = Effect.fnUntraced(function* (script: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdio = yield* Stdio.Stdio;
  const failed = new CommandFailed({
    exit: CLI_EXIT.REFUSED,
    message: `The update did not finish, so ${PRODUCT_NAME} CLI ${VERSION} stays installed.`,
  });
  const code = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("sh", ["-s", CLI_INSTALL_MODE], {
          stdin: { stream: Stream.make(encoder.encode(script)) },
          stdout: "pipe",
          stderr: "inherit",
        }),
      );
      yield* Stream.run(handle.stdout, stdio.stderr({ endOnDone: false }));
      return yield* handle.exitCode;
    }),
  ).pipe(Effect.mapError(() => failed));
  if (Number(code) !== 0) return yield* failed;
});

/** The version a curl install's link now names, read off the release folder it really stands in. */
const linkedVersion = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const real = yield* Effect.orElseSucceed(fs.realPath(curlLink()), () => "");
  const releases = curlReleases();
  return real.startsWith(releases) ? (real.slice(releases.length).split("/")[0] ?? "") : "";
});

/** What `update` answers for an install it does not update: the command that does. */
function told(kind: Exclude<InstallKind, typeof INSTALL_KIND.CURL>) {
  const command = UPDATE_COMMAND[kind];
  return answer({
    json: { install: kind, version: VERSION, updated: false, command },
    lines: [
      `This ${PRODUCT_NAME} CLI was installed with ${kind}. To update it, run:`,
      `  ${command}`,
    ],
    ids: [command],
  });
}

export const updateCommand = Command.make("update", {}, () =>
  Effect.gen(function* () {
    const kind = installKind();
    if (kind !== INSTALL_KIND.CURL) return yield* told(kind);
    const origin = yield* serviceOrigin;
    const script = yield* installScript(origin);
    yield* note(`Updating ${PRODUCT_NAME} CLI ${VERSION} from ${origin}…`);
    yield* runInstallScript(script);
    const version = yield* linkedVersion;
    yield* answer({
      json: { install: kind, version, previous: VERSION, updated: version !== VERSION },
      lines: [
        version === VERSION
          ? `${PRODUCT_NAME} CLI ${VERSION} is the newest release.`
          : `Updated ${PRODUCT_NAME} CLI from ${VERSION} to ${version}.`,
      ],
      ids: [version],
    });
  }),
).pipe(
  Command.withDescription("Update to the newest release, or print how for an npm install"),
  Command.withExamples([
    { command: "vespin update", description: "Update in place, or print the command that does" },
  ]),
);
