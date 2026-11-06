import { CLI_EXIT } from "@repo/features/cli-exit";
import { CLI_INSTALL_MODE } from "@repo/features/cli-release";
import { HOST_WIRE } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Duration, Effect, FileSystem, Stdio, Stream } from "effect";
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

const SCRIPT_PROTOCOL = "https:";

const DOWNLOAD_WITHIN = Duration.seconds(30);

const encoder = new TextEncoder();

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
  return yield* Effect.gen(function* () {
    const response = yield* HttpClient.get(url);
    if (response.status !== 200) return yield* unreachable;
    return yield* response.text;
  }).pipe(
    Effect.timeout(DOWNLOAD_WITHIN),
    Effect.mapError((error) => (error instanceof CommandFailed ? error : unreachable)),
  );
});

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

const linkedVersion = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const real = yield* Effect.orElseSucceed(fs.realPath(curlLink()), () => "");
  const releases = curlReleases();
  return real.startsWith(releases) ? (real.slice(releases.length).split("/")[0] ?? "") : "";
});

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
