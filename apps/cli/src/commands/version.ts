/**
 * version.ts -- `vespin version`: the version this build of the command is, and how it was installed.
 */

import { Command } from "effect/cli";
import { installKind } from "../install.js";
import { answer } from "../output.js";

/** The command's version, which the build writes in (`pnpm --filter @repo/vespin-cli build`); a development run is 0.0.0. */
export const VERSION = process.env.APP_CLI_VERSION ?? "0.0.0";

export const versionCommand = Command.make("version", {}, () => {
  const install = installKind();
  return answer({
    json: { version: VERSION, install },
    lines: [`${VERSION} (${install} install)`],
    ids: [VERSION],
  });
}).pipe(
  Command.withDescription("Print the version, and how it was installed"),
  Command.withExamples([{ command: "vespin version", description: "Print the version" }]),
);
