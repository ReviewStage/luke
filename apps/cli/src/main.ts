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

const services = Layer.mergeAll(
  NodeServices.layer,
  FetchHttpClient.layer,
  CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] }),
);

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
    teardown: (exit) => {
      process.exitCode = Exit.isSuccess(exit) ? Number(exit.value) : CLI_EXIT.REFUSED;
    },
  },
);
