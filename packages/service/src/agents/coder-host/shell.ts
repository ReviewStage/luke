import { describeWire, emitJsonSchema } from "@luke/wire/effect";
import { Schema } from "effect";
import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { COMMAND_DESCRIPTION } from "../command-description.js";
import {
  exportLines,
  maskSecrets,
  NO_SHELL_ENVIRONMENT,
  type ShellEnvironment,
} from "./workspace-environment.js";

/**
 * shell.ts -- the coding agent's shell: eve's own `bash`, with every command started in the checkout.
 *
 * eve runs each command in a fresh shell at `/workspace`, the sandbox's
 * root, and the agent's checkout stands one directory below it
 * (`bounds.ts`), so a model told where the checkout is opens every command
 * with a `cd` into it, since the last call's `cd` is gone. The shell here
 * starts each command in the checkout instead. Note that the `cd` is a line
 * of its own ahead of the command, which runs whole after it, so a heredoc
 * or a multi-line script reads as the model wrote it; that a checkout that
 * is not there fails the call rather than running the command at the
 * sandbox's root; and that the call's input stays the model's command, so
 * the transcript shows what the model wrote and nothing of this. The input
 * takes the command's description beside it (`command-description.ts`),
 * which eve's own schema refuses as a key it does not know, and the shell
 * hands eve's `bash` the command alone.
 *
 * Where it is handed the session's environment, the workspace's variables
 * and secrets are exported ahead of the `cd`, read afresh for each command
 * (`workspace-environment.ts`), and every secret's value is masked out of
 * the answer before the model reads it.
 */

/** eve's `bash` input as the model is offered it, with the description beside the command. */
const SHELL_INPUT = Schema.Struct({
  command: describeWire(Schema.String, "The shell command to execute."),
  description: COMMAND_DESCRIPTION,
});

/** A path as one single-quoted shell word. */
function quoted(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/** What eve hands a tool as it runs it. */
type ToolContext = Parameters<typeof bash.execute>[1];

/** eve's `bash`, told and run so that every command starts in the directory given, with the session's environment where one is given. */
export function bashStartingIn(
  directory: string,
  environmentOf?: (ctx: ToolContext) => Promise<ShellEnvironment>,
) {
  return defineTool({
    ...bash,
    description: `${bash.description} Every command starts in ${directory}, the repository's checkout, in a fresh shell, so a \`cd\` lasts only for the call it is in.`,
    inputSchema: emitJsonSchema(SHELL_INPUT),
    execute: async (input: typeof SHELL_INPUT.Type, ctx) => {
      const environment =
        environmentOf === undefined ? NO_SHELL_ENVIRONMENT : await environmentOf(ctx);
      const command = `${exportLines(environment)}cd ${quoted(directory)} || exit\n${input.command}`;
      const answered = await bash.execute({ command }, ctx);
      // Note that eve's own bash answers once, so a stream is a change of eve's to meet here rather than pass on unmasked.
      if (Symbol.asyncIterator in answered) throw new Error("eve's bash answered as a stream.");
      return maskSecrets(answered, environment.secrets);
    },
  });
}
