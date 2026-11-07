/**
 * main.ts -- the `vespin` command's process: the command line parsed into one command, run, and ended with the exit code its outcome stands for.
 *
 * Bundled into one ESM file (`pnpm --filter @repo/vespin-cli build`,
 * `dist/vespin.mjs`) that runs on the person's own Node, 20 or later. The
 * command tree is `effect/cli`'s: each command in `commands/` declares its
 * arguments, flags, description, and examples, from which `--help` is drawn
 * at every level, and the flags every command takes (`flags.ts`) are global
 * settings any command reads from its context.
 *
 * Every end is one of `CLI_EXIT`'s codes: a command that failed says why
 * on stderr and ends with its own (`CommandFailed`); a command line
 * `effect/cli` could not parse has had its help and its error printed
 * already, and ends as a usage error; anything else is a failure this build
 * did not expect, said by its kind alone, since its words could carry what
 * a request carried.
 */

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { CLI_EXIT, type CliExit } from "@repo/features/cli-exit";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Console, Effect, Exit, Layer, Stdio } from "effect";
import { CliConfig, CliError, Command, GlobalFlag } from "effect/cli";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { COMMANDS } from "./commands/index.js";
import { VERSION } from "./commands/version.js";
import { GLOBAL_FLAGS } from "./flags.js";
import { CommandFailed } from "./output.js";

/** What each exit code says, as `--help` lists them for a script or a coding agent to branch on. */
const EXIT_CODES_HELP = [
  `${CLI_EXIT.OK} done`,
  `${CLI_EXIT.REFUSED} refused`,
  `${CLI_EXIT.USAGE} usage`,
  `${CLI_EXIT.AUTH} not signed in`,
  `${CLI_EXIT.UNAVAILABLE} unreachable or a server error`,
  `${CLI_EXIT.TURN_FAILED} the agent's turn failed or was stopped`,
  `${CLI_EXIT.TIMED_OUT} timed out waiting`,
].join(", ");

const vespin = Command.make("vespin").pipe(
  Command.withDescription(
    `${PRODUCT_NAME} from your terminal: sign in, work tasks, their descriptions, and agents, call the hosted API, and print JSON for scripts and coding agents. Exit codes: ${EXIT_CODES_HELP}.`,
  ),
  Command.withSubcommands(COMMANDS),
  Command.withGlobalFlags(GLOBAL_FLAGS),
  Command.withExamples([
    { command: "vespin login", description: "Sign in through your browser" },
    { command: "vespin whoami --json", description: "Who is signed in, as JSON" },
    {
      command: 'echo "Fix the login redirect" | vespin task create "Login redirect" --prompt -',
      description: "A task in this folder's repository, and an agent on it",
    },
    { command: "vespin api GET /api/workspaces", description: "Call any hosted procedure" },
  ]),
);

/** The services every command runs on: Node's, `fetch` for the service, and `--help` and `--version` as the only built-in flags. */
const services = Layer.mergeAll(
  NodeServices.layer,
  FetchHttpClient.layer,
  CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] }),
);

/** How a run that did not succeed ends, and what it says on the way out. */
function ended(failure: unknown): Effect.Effect<CliExit> {
  if (failure instanceof CommandFailed)
    return Effect.as(Console.error(failure.message), failure.exit);
  if (CliError.isCliError(failure)) return Effect.succeed(CLI_EXIT.USAGE);
  const kind = failure instanceof Error ? failure.name : typeof failure;
  return Effect.as(
    Console.error(`${PRODUCT_NAME} CLI failed unexpectedly (${kind}).`),
    CLI_EXIT.REFUSED,
  );
}

NodeRuntime.runMain(
  Effect.flatMap(Stdio.Stdio, ({ args }) => args).pipe(
    Effect.flatMap(Command.runWith(vespin, { version: VERSION })),
    Effect.as<CliExit>(CLI_EXIT.OK),
    Effect.catch(ended),
    Effect.provide(services),
  ),
  {
    // Note that the code is set rather than exited with, so a long answer piped to another command is written whole before Node ends.
    teardown: (exit) => {
      process.exitCode = Exit.isSuccess(exit) ? Number(exit.value) : CLI_EXIT.REFUSED;
    },
  },
);
