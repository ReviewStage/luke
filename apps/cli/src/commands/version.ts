import { Command } from "effect/cli";
import { installKind } from "../install.js";
import { answer } from "../output.js";

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
