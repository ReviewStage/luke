/**
 * run-command.ts -- the repository's own run command in an agent's sandbox: the read of `.vespin.json` from the checkout, the command it names, and the start that runs it detached.
 *
 * A repository names the command that serves its app in a `.vespin.json`
 * at its root, `{ "run": "pnpm dev" }`, read from the agent's checkout each
 * time forwarding is turned on; a repository without one has no run
 * command. The command runs in the checkout with every capability dropped
 * (`../sandbox-capabilities.ts`), as a Terminal's shell does, and the text
 * reaches its shell only as a positional argument. What it prints goes to a
 * log in the workspace's state folder, beside the checkout.
 */

import { Option, Schema } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import { SANDBOX_STATE_FOLDER } from "../sandbox-state-folder.js";
import type { CommandAsk, CommandRun } from "../vercel-sandbox-api.js";

/** The file a repository names its run command in, at its root. */
const RUN_CONFIG = `${REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT}/.vespin.json`;

/** Where the run command's output is written. */
const RUN_LOG = `${REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE}/${SANDBOX_STATE_FOLDER}/run.log`;

const RunConfigJson = Schema.fromJsonString(Schema.Struct({ run: Schema.NonEmptyString }));

/** Reads the repository's `.vespin.json`, in the text `runCommandOf` reads. */
export function readRunConfig(): CommandAsk {
  return { command: "cat", args: [RUN_CONFIG] };
}

/** The command the file names; none where there is no file or it names none. */
export function runCommandOf(run: CommandRun): string | undefined {
  if (run.exitCode !== 0) return undefined;
  const config = Schema.decodeUnknownOption(RunConfigJson)(run.stdout);
  return Option.getOrUndefined(Option.map(config, (read) => read.run));
}

/** Runs the command in the checkout without capabilities, its output to the run log. */
export function startRunCommand(command: string): CommandAsk {
  return {
    command: WITHOUT_CAPABILITIES.COMMAND,
    args: [
      ...WITHOUT_CAPABILITIES.ARGS,
      "sh",
      "-c",
      'exec sh -c "$1" >"$2" 2>&1',
      "sh",
      command,
      RUN_LOG,
    ],
    cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  };
}
