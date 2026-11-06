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

const LINK_FOLDER = [".local", "bin"] as const;
const LINK_NAME = "vespin";

const DEFAULT_SHELL = "/bin/zsh";

const ANSWER_WITHIN = {
  INSTALL: Duration.minutes(10),
  COMMAND: Duration.seconds(30),
} as const;

const CROSS = /^✗\s*/u;

const decodeVersion = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

const failed = (reason: string): CliInstallAnswer => ({
  outcome: CLI_INSTALL_OUTCOME.FAILED,
  reason,
});

function lastWords(words: string): string {
  const lines = words
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (lines.at(-1) ?? words).replace(CROSS, "");
}

function holds(printedPath: string, folder: string): boolean {
  const pathLine = printedPath.split("\n").at(-1) ?? "";
  return pathLine.split(":").some((entry) => path.resolve(entry) === folder);
}

function loginShell(): string {
  const named = process.env.SHELL;
  if (named !== undefined && named !== "") return named;
  try {
    return os.userInfo().shell || DEFAULT_SHELL;
  } catch {
    return DEFAULT_SHELL;
  }
}

const layers = Layer.mergeAll(
  Layer.provideMerge(
    NodeChildProcessSpawner.layer,
    Layer.mergeAll(NodeFileSystem.layer, NodePath.layer),
  ),
  FetchHttpClient.layer,
);

export function installCli(serviceBaseUrl: string): Effect.Effect<CliInstallAnswer> {
  const folder = path.join(os.homedir(), ...LINK_FOLDER);
  const link = path.join(folder, LINK_NAME);
  const shell = loginShell();
  const scriptUrl = new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, serviceBaseUrl).href;
  return Effect.gen(function* () {
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
