/**
 * api.ts -- `vespin api <method> <path>`: any hosted procedure called by its REST route with the member's bearer, and its JSON answer printed.
 *
 * The escape hatch for everything without a command of its own, as `gh api`
 * is. The route must be one the hosted contract declares
 * (`@repo/features/hosted-routes`), so a mistyped path is a usage error
 * rather than a bearer sent somewhere no procedure answers. The call goes
 * through `account-call.ts` like every other, so a lapsed token is renewed
 * once there. The answer is printed as the service wrote it, a refusal's
 * too, and the exit code says which it was.
 */

import { accountCall, callAnswered } from "@repo/features";
import { CLI_EXIT, cliExitOfFault, cliExitOfStatus } from "@repo/features/cli-exit";
import { hostedRouteOf } from "@repo/features/hosted-routes";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { answer, CommandFailed, readInput } from "../output.js";
import { SIGN_IN_HINT, session } from "../session.js";

/** How long a call may take: past a Start, the longest a procedure answers in (`hosted-link.ts`'s `HOSTED_DEADLINE`). */
const API_DEADLINE_MS = 120_000;

/** The body read as JSON, or a usage failure saying it is not. */
function jsonBody(text: string, source: string): Effect.Effect<string, CommandFailed> {
  try {
    JSON.parse(text);
    return Effect.succeed(text);
  } catch {
    return Effect.fail(
      new CommandFailed({ exit: CLI_EXIT.USAGE, message: `${source} is not JSON.` }),
    );
  }
}

/** An answer's body as JSON where it is, else as its text. */
function readable(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const apiCommand = Command.make(
  "api",
  {
    method: Argument.String("method").pipe(
      Argument.withDescription("GET, POST, PUT, PATCH, or DELETE"),
    ),
    path: Argument.String("path").pipe(
      Argument.withDescription("The procedure's route, its query included, such as /api/plans"),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("F"),
      Flag.optional,
      Flag.withDescription("The JSON body, from a file or - for stdin"),
    ),
  },
  ({ method, path, input }) =>
    Effect.gen(function* () {
      const route = hostedRouteOf(method, path);
      if (route === undefined) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: `No ${PRODUCT_NAME} procedure answers ${method.toUpperCase()} ${path}.`,
        });
      }
      const body = Option.isSome(input)
        ? yield* Effect.flatMap(readInput(input.value), (text) => jsonBody(text, input.value))
        : undefined;
      const { origin, credential } = yield* session;
      const sent = yield* accountCall({
        baseUrl: origin,
        credential,
        requestTimeoutMs: API_DEADLINE_MS,
      }).send({ method: route.method, path, body });
      if (!callAnswered(sent)) {
        const exit = cliExitOfFault(sent.fault);
        return yield* new CommandFailed({
          exit,
          message:
            exit === CLI_EXIT.AUTH
              ? `Not signed in. ${SIGN_IN_HINT}`
              : `Could not reach ${origin}.`,
        });
      }
      const text = yield* Effect.promise(() => sent.response.text());
      const found = readable(text);
      yield* answer({ json: found, lines: [JSON.stringify(found, null, 2)] });
      const exit = cliExitOfStatus(sent.response.status);
      if (exit !== CLI_EXIT.OK) {
        return yield* new CommandFailed({
          exit,
          message: `${route.method} ${path} answered ${sent.response.status}.`,
        });
      }
    }),
).pipe(
  Command.withDescription("Call any hosted procedure by its route and print its JSON answer"),
  Command.withExamples([
    { command: "vespin api GET /api/workspaces", description: "List your workspaces" },
    {
      command: 'echo \'{"name":"Research"}\' | vespin api POST /api/workspaces -F -',
      description: "Create a workspace from a body on stdin",
    },
  ]),
);
