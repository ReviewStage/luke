/**
 * version.ts -- `vespin version`: the version this build of the command is.
 */

import { Command } from "effect/cli";
import { answer } from "../output.js";

/** The command's version, which the build writes in (`pnpm --filter @repo/vespin-cli build`); a development run is 0.0.0. */
export const VERSION = process.env.APP_CLI_VERSION ?? "0.0.0";

export const versionCommand = Command.make("version", {}, () =>
  answer({ json: { version: VERSION }, lines: [VERSION], ids: [VERSION] }),
).pipe(
  Command.withDescription("Print the version"),
  Command.withExamples([{ command: "vespin version", description: "Print the version" }]),
);
